from __future__ import annotations

import asyncio
import json
import threading
import uuid
from datetime import datetime, timezone
from typing import Any

from pydantic import ValidationError
from sqlalchemy import select

from ingestguard.models import (
    IngestedRecordRow,
    IngestRequest,
    JobSummary,
    QuarantineRow,
    SchemaSpec,
)
from ingestguard.parser import (
    _clean_input_dict,
    build_row_validator,
    compute_payload_hash,
    iter_validated_chunks,
)
from ingestguard.store import IngestStore


class IngestGuardError(Exception):
    """Base exception for IngestGuard domain errors."""


class ReplayValidationError(IngestGuardError):
    """Raised when patched payload fails schema validation during replay."""

    def __init__(self, errors: list[dict[str, Any]]) -> None:
        super().__init__("Replay validation failed")
        self.errors = errors


class QuarantineNotFoundError(IngestGuardError):
    """Raised when quarantine row is not found."""

    def __init__(self, quarantine_id: str) -> None:
        super().__init__(f"Quarantine row '{quarantine_id}' not found")
        self.quarantine_id = quarantine_id


class QuarantineAlreadyReplayedError(IngestGuardError):
    """Raised when attempting to replay an already replayed quarantine row."""

    def __init__(self, quarantine_id: str) -> None:
        super().__init__(f"Quarantine row '{quarantine_id}' has already been replayed")
        self.quarantine_id = quarantine_id


class MetricsCollector:
    """Thread-safe Prometheus metrics collector for ingestion counters."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.inserted_total: int = 0
        self.skipped_total: int = 0
        self.quarantined_total: int = 0
        self.replayed_total: int = 0

    def inc_inserted(self, count: int = 1) -> None:
        with self._lock:
            self.inserted_total += count

    def inc_skipped(self, count: int = 1) -> None:
        with self._lock:
            self.skipped_total += count

    def inc_quarantined(self, count: int = 1) -> None:
        with self._lock:
            self.quarantined_total += count

    def inc_replayed(self, count: int = 1) -> None:
        with self._lock:
            self.replayed_total += count

    def render_prometheus(self) -> str:
        """Render metrics in Prometheus plain text format."""
        with self._lock:
            inserted = self.inserted_total
            skipped = self.skipped_total
            quarantined = self.quarantined_total
            replayed = self.replayed_total

        lines = [
            "# HELP ingestguard_rows_inserted_total Total number of successfully inserted rows.",
            "# TYPE ingestguard_rows_inserted_total counter",
            f"ingestguard_rows_inserted_total {inserted}",
            "# HELP ingestguard_rows_skipped_total Total number of skipped identical rows.",
            "# TYPE ingestguard_rows_skipped_total counter",
            f"ingestguard_rows_skipped_total {skipped}",
            "# HELP ingestguard_rows_quarantined_total Total number of quarantined invalid rows.",
            "# TYPE ingestguard_rows_quarantined_total counter",
            f"ingestguard_rows_quarantined_total {quarantined}",
            "# HELP ingestguard_rows_replayed_total Total number of successfully replayed quarantine rows.",
            "# TYPE ingestguard_rows_replayed_total counter",
            f"ingestguard_rows_replayed_total {replayed}",
        ]
        return "\n".join(lines) + "\n"


class IngestService:
    """Core orchestration service coordinating chunk ingestion and quarantine replay."""

    def __init__(
        self,
        store: IngestStore,
        metrics: MetricsCollector | None = None,
    ) -> None:
        self.store = store
        self.metrics = metrics or MetricsCollector()

    async def ingest_batch(self, req: IngestRequest) -> JobSummary:
        job_id = str(uuid.uuid4())
        await self.store.create_job(
            job_id=job_id,
            dataset=req.dataset,
            format_type=req.format_type,
        )

        total_inserted = 0
        total_updated = 0
        total_skipped = 0
        total_quarantined = 0

        # Stream chunk iterator and apply chunks
        for validated_rows, rejected_rows in iter_validated_chunks(
            content=req.content,
            format_type=req.format_type,
            spec=req.schema_spec,
            chunk_size=req.chunk_size,
        ):
            chunk_result = await self.store.apply_chunk(
                job_id=job_id,
                dataset=req.dataset,
                validated_rows=validated_rows,
                rejected_rows=rejected_rows,
            )
            total_inserted += chunk_result.inserted
            total_updated += chunk_result.updated
            total_skipped += chunk_result.skipped
            total_quarantined += chunk_result.quarantined

            self.metrics.inc_inserted(chunk_result.inserted)
            self.metrics.inc_skipped(chunk_result.skipped)
            self.metrics.inc_quarantined(chunk_result.quarantined)

        final_job = await self.store.finalize_job(
            job_id=job_id,
            inserted=total_inserted,
            updated=total_updated,
            skipped=total_skipped,
            quarantined=total_quarantined,
        )

        return JobSummary(
            job_id=final_job.job_id,
            dataset=final_job.dataset,
            format_type=final_job.format_type,
            total_rows=final_job.total_rows,
            inserted_rows=final_job.inserted_rows,
            updated_rows=final_job.updated_rows,
            skipped_rows=final_job.skipped_rows,
            quarantined_rows=final_job.quarantined_rows,
            status=final_job.status,
            created_at=final_job.created_at.isoformat(),
        )

    def _sync_replay(
        self,
        quarantine_id: str,
        record_key: str,
        payload_hash: str,
        dumped: dict[str, Any],
    ) -> IngestedRecordRow:
        with self.store._lock:
            with self.store.session_factory() as session:
                with session.begin():
                    q_row = session.get(QuarantineRow, quarantine_id)
                    if q_row is None:
                        raise QuarantineNotFoundError(quarantine_id)
                    if q_row.status == "REPLAYED":
                        raise QuarantineAlreadyReplayedError(quarantine_id)

                    dataset = q_row.dataset
                    now = datetime.now(timezone.utc)

                    stmt = select(IngestedRecordRow).where(
                        IngestedRecordRow.dataset == dataset,
                        IngestedRecordRow.record_key == record_key,
                    )
                    if self.store.engine.dialect.name != "sqlite":
                        stmt = stmt.with_for_update()

                    record = session.scalar(stmt)
                    if record is None:
                        record = IngestedRecordRow(
                            dataset=dataset,
                            record_key=record_key,
                            payload_hash=payload_hash,
                            payload_json=json.dumps(
                                dumped, ensure_ascii=False, default=str
                            ),
                            source_job_id=q_row.job_id,
                            updated_at=now,
                        )
                        session.add(record)
                    else:
                        record.payload_hash = payload_hash
                        record.payload_json = json.dumps(
                            dumped, ensure_ascii=False, default=str
                        )
                        record.source_job_id = q_row.job_id
                        record.updated_at = now

                    q_row.status = "REPLAYED"
                    q_row.replayed_at = now

                    self.metrics.inc_replayed(1)
                    return record

    async def replay_quarantine_row(
        self,
        quarantine_id: str,
        patched_payload: dict[str, Any],
        spec: SchemaSpec,
    ) -> IngestedRecordRow:
        validator_cls = build_row_validator(spec)
        try:
            cleaned = _clean_input_dict(patched_payload, spec)
            validated_model = validator_cls.model_validate(cleaned)
            dumped = validated_model.model_dump()
        except ValidationError as err:
            errors = [
                {
                    "loc": [str(loc_item) for loc_item in e["loc"]],
                    "msg": e["msg"],
                    "type": e["type"],
                }
                for e in err.errors()
            ]
            raise ReplayValidationError(errors=errors) from err

        record_key = str(dumped[spec.key_field])
        payload_hash = compute_payload_hash(dumped)

        return await asyncio.to_thread(
            self._sync_replay,
            quarantine_id,
            record_key,
            payload_hash,
            dumped,
        )
