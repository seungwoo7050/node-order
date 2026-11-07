from __future__ import annotations

import asyncio
import json
import threading
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Sequence

from sqlalchemy import Engine, create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from ingestguard.models import (
    Base,
    IngestedRecordRow,
    IngestJobRow,
    QuarantineRow,
)
from ingestguard.parser import RejectedRow, ValidatedRow


@dataclass(frozen=True)
class ChunkApplyResult:
    inserted: int
    updated: int
    skipped: int
    quarantined: int


def create_db_engine(db_url: str = "sqlite:///:memory:") -> Engine:
    """Create a configured SQLAlchemy engine supporting synchronous operations and multi-threading."""
    if db_url in (":memory:", "sqlite:///:memory:"):
        return create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
            echo=False,
        )
    if db_url.startswith("sqlite"):
        return create_engine(
            db_url,
            connect_args={"check_same_thread": False},
            echo=False,
        )
    return create_engine(db_url, echo=False)


class IngestStore:
    """Synchronous Unit-of-Work store with thread-safe isolation for async event loops."""

    def __init__(self, engine: Engine | None = None, db_url: str = "sqlite:///:memory:") -> None:
        self.engine: Engine = engine or create_db_engine(db_url)
        self.session_factory: sessionmaker[Session] = sessionmaker(
            bind=self.engine,
            expire_on_commit=False,
        )
        self._lock = threading.Lock()

    def init_db(self) -> None:
        """Create all tables if they do not exist."""
        with self._lock:
            Base.metadata.create_all(bind=self.engine)

    def create_job_sync(self, job_id: str, dataset: str, format_type: str) -> IngestJobRow:
        with self._lock:
            with self.session_factory() as session:
                with session.begin():
                    job = IngestJobRow(
                        job_id=job_id,
                        dataset=dataset,
                        format_type=format_type,
                        total_rows=0,
                        inserted_rows=0,
                        updated_rows=0,
                        skipped_rows=0,
                        quarantined_rows=0,
                        status="COMPLETED",
                        created_at=datetime.now(timezone.utc),
                    )
                    session.add(job)
                return job

    async def create_job(self, job_id: str, dataset: str, format_type: str) -> IngestJobRow:
        return await asyncio.to_thread(self.create_job_sync, job_id, dataset, format_type)

    def apply_chunk_sync(
        self,
        job_id: str,
        dataset: str,
        validated_rows: list[ValidatedRow],
        rejected_rows: list[RejectedRow],
    ) -> ChunkApplyResult:
        with self._lock:
            with self.session_factory() as session:
                with session.begin():
                    # 1. Quarantine rejected rows
                    for r in rejected_rows:
                        q_row = QuarantineRow(
                            quarantine_id=str(uuid.uuid4()),
                            job_id=job_id,
                            dataset=dataset,
                            row_number=r.row_number,
                            raw_payload_json=json.dumps(
                                r.raw_payload, ensure_ascii=False, default=str
                            ),
                            error_details_json=json.dumps(r.errors, ensure_ascii=False),
                            status="PENDING",
                            created_at=datetime.now(timezone.utc),
                            replayed_at=None,
                        )
                        session.add(q_row)

                    # 2. Idempotent Upsert for validated rows
                    inserted = 0
                    updated = 0
                    skipped = 0

                    if validated_rows:
                        keys = [v.record_key for v in validated_rows]
                        stmt = select(IngestedRecordRow).where(
                            IngestedRecordRow.dataset == dataset,
                            IngestedRecordRow.record_key.in_(keys),
                        )
                        if self.engine.dialect.name != "sqlite":
                            stmt = stmt.with_for_update()

                        existing_records = {row.record_key: row for row in session.scalars(stmt)}
                        now = datetime.now(timezone.utc)

                        for v in validated_rows:
                            existing = existing_records.get(v.record_key)
                            if existing is None:
                                new_record = IngestedRecordRow(
                                    dataset=dataset,
                                    record_key=v.record_key,
                                    payload_hash=v.payload_hash,
                                    payload_json=json.dumps(
                                        v.payload, ensure_ascii=False, default=str
                                    ),
                                    source_job_id=job_id,
                                    updated_at=now,
                                )
                                session.add(new_record)
                                existing_records[v.record_key] = new_record
                                inserted += 1
                            else:
                                if existing.payload_hash == v.payload_hash:
                                    skipped += 1
                                else:
                                    existing.payload_hash = v.payload_hash
                                    existing.payload_json = json.dumps(
                                        v.payload, ensure_ascii=False, default=str
                                    )
                                    existing.source_job_id = job_id
                                    existing.updated_at = now
                                    updated += 1

                    quarantined = len(rejected_rows)
                    return ChunkApplyResult(
                        inserted=inserted,
                        updated=updated,
                        skipped=skipped,
                        quarantined=quarantined,
                    )

    async def apply_chunk(
        self,
        job_id: str,
        dataset: str,
        validated_rows: list[ValidatedRow],
        rejected_rows: list[RejectedRow],
    ) -> ChunkApplyResult:
        return await asyncio.to_thread(
            self.apply_chunk_sync, job_id, dataset, validated_rows, rejected_rows
        )

    def finalize_job_sync(
        self,
        job_id: str,
        inserted: int,
        updated: int,
        skipped: int,
        quarantined: int,
    ) -> IngestJobRow:
        with self._lock:
            with self.session_factory() as session:
                with session.begin():
                    job = session.get(IngestJobRow, job_id)
                    if job is None:
                        raise ValueError(f"Job not found: {job_id}")
                    job.total_rows = inserted + updated + skipped + quarantined
                    job.inserted_rows = inserted
                    job.updated_rows = updated
                    job.skipped_rows = skipped
                    job.quarantined_rows = quarantined
                    job.status = "PARTIAL_QUARANTINE" if quarantined > 0 else "COMPLETED"
                return job

    async def finalize_job(
        self,
        job_id: str,
        inserted: int,
        updated: int,
        skipped: int,
        quarantined: int,
    ) -> IngestJobRow:
        return await asyncio.to_thread(
            self.finalize_job_sync, job_id, inserted, updated, skipped, quarantined
        )

    def get_job_sync(self, job_id: str) -> IngestJobRow | None:
        with self._lock:
            with self.session_factory() as session:
                return session.get(IngestJobRow, job_id)

    async def get_job(self, job_id: str) -> IngestJobRow | None:
        return await asyncio.to_thread(self.get_job_sync, job_id)

    def get_quarantine_rows_sync(self, job_id: str) -> list[QuarantineRow]:
        with self._lock:
            with self.session_factory() as session:
                stmt = (
                    select(QuarantineRow)
                    .where(QuarantineRow.job_id == job_id)
                    .order_by(QuarantineRow.row_number.asc())
                )
                return list(session.scalars(stmt))

    async def get_quarantine_rows(self, job_id: str) -> list[QuarantineRow]:
        return await asyncio.to_thread(self.get_quarantine_rows_sync, job_id)

    def get_quarantine_row_sync(self, quarantine_id: str) -> QuarantineRow | None:
        with self._lock:
            with self.session_factory() as session:
                return session.get(QuarantineRow, quarantine_id)

    async def get_quarantine_row(self, quarantine_id: str) -> QuarantineRow | None:
        return await asyncio.to_thread(self.get_quarantine_row_sync, quarantine_id)

    def get_records_sync(
        self, dataset: str, limit: int = 100, offset: int = 0
    ) -> Sequence[IngestedRecordRow]:
        with self._lock:
            with self.session_factory() as session:
                stmt = (
                    select(IngestedRecordRow)
                    .where(IngestedRecordRow.dataset == dataset)
                    .order_by(IngestedRecordRow.id.asc())
                    .limit(limit)
                    .offset(offset)
                )
                return list(session.scalars(stmt))

    async def get_records(
        self, dataset: str, limit: int = 100, offset: int = 0
    ) -> Sequence[IngestedRecordRow]:
        return await asyncio.to_thread(self.get_records_sync, dataset, limit, offset)
