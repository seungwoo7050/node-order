"""SQLAlchemy 2.0 persistence layer with thread isolation and debounced state transitions."""

from __future__ import annotations

import asyncio
import threading
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from driftwatch.models import (
    AlertRecord,
    Base,
    CheckSnapshotRow,
    DriftAlertRow,
    TargetCreateRequest,
    TargetSnapshot,
    WatchTargetRow,
)


def _to_snapshot(row: WatchTargetRow) -> TargetSnapshot:
    """Map ORM row to immutable TargetSnapshot Pydantic model."""
    last_checked = row.last_checked_at
    if last_checked is not None and last_checked.tzinfo is None:
        last_checked = last_checked.replace(tzinfo=timezone.utc)

    created = row.created_at
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)

    return TargetSnapshot(
        target_id=row.target_id,
        name=row.name,
        url=row.url,
        extractor_type=row.extractor_type,
        selector=row.selector,
        expected_type=row.expected_type,
        expected_value=row.expected_value,
        min_value=row.min_value,
        max_value=row.max_value,
        failure_threshold=row.failure_threshold,
        interval_seconds=row.interval_seconds,
        webhook_url=row.webhook_url,
        last_value=row.last_value,
        consecutive_failures=row.consecutive_failures,
        status=row.status,
        last_checked_at=last_checked,
        created_at=created,
    )


def _to_alert_record(row: DriftAlertRow) -> AlertRecord:
    """Map ORM alert row to immutable AlertRecord Pydantic model."""
    created = row.created_at
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)

    return AlertRecord(
        alert_id=row.alert_id,
        target_id=row.target_id,
        alert_type=row.alert_type,
        previous_value=row.previous_value,
        current_value=row.current_value,
        message=row.message,
        webhook_delivered=row.webhook_delivered,
        created_at=created,
    )


class DriftStore:
    """Storage engine managing targets, check snapshots, and debounced alert records."""

    def __init__(self, db_url: str = "sqlite:///:memory:") -> None:
        self.db_url = db_url
        engine_kwargs: dict[str, Any] = {}
        if ":memory:" in db_url or "sqlite" in db_url:
            engine_kwargs["connect_args"] = {"check_same_thread": False}
        if ":memory:" in db_url:
            engine_kwargs["poolclass"] = StaticPool

        self._engine = create_engine(db_url, **engine_kwargs)
        self._session_factory = sessionmaker(
            bind=self._engine,
            autoflush=False,
            expire_on_commit=False,
        )
        self._lock = threading.Lock()
        self.create_tables()

    def create_tables(self) -> None:
        """Create all tables defined in metadata."""
        with self._lock:
            Base.metadata.create_all(self._engine)

    def _sync_upsert_target(self, req: TargetCreateRequest) -> TargetSnapshot:
        with self._lock, self._session_factory() as session:
            target = session.get(WatchTargetRow, req.target_id)
            if target is None:
                target = WatchTargetRow(
                    target_id=req.target_id,
                    name=req.name,
                    url=req.url,
                    extractor_type=req.extractor_type,
                    selector=req.selector,
                    expected_type=req.expected_type,
                    expected_value=req.expected_value,
                    min_value=req.min_value,
                    max_value=req.max_value,
                    failure_threshold=req.failure_threshold,
                    interval_seconds=req.interval_seconds,
                    webhook_url=req.webhook_url,
                    last_value=None,
                    consecutive_failures=0,
                    status="HEALTHY",
                    last_checked_at=None,
                    created_at=datetime.now(timezone.utc),
                )
                session.add(target)
            else:
                target.name = req.name
                target.url = req.url
                target.extractor_type = req.extractor_type
                target.selector = req.selector
                target.expected_type = req.expected_type
                target.expected_value = req.expected_value
                target.min_value = req.min_value
                target.max_value = req.max_value
                target.failure_threshold = req.failure_threshold
                target.interval_seconds = req.interval_seconds
                target.webhook_url = req.webhook_url

            session.commit()
            return _to_snapshot(target)

    async def upsert_target(self, req: TargetCreateRequest) -> TargetSnapshot:
        """Insert or update target in an isolated thread."""
        return await asyncio.to_thread(self._sync_upsert_target, req)

    def _sync_get_target(self, target_id: str) -> TargetSnapshot | None:
        with self._lock, self._session_factory() as session:
            target = session.get(WatchTargetRow, target_id)
            if target is None:
                return None
            return _to_snapshot(target)

    async def get_target(self, target_id: str) -> TargetSnapshot | None:
        """Retrieve target snapshot by id in an isolated thread."""
        return await asyncio.to_thread(self._sync_get_target, target_id)

    def _sync_list_targets(self) -> list[TargetSnapshot]:
        with self._lock, self._session_factory() as session:
            rows = session.scalars(
                select(WatchTargetRow).order_by(WatchTargetRow.created_at.asc())
            ).all()
            return [_to_snapshot(r) for r in rows]

    async def list_targets(self) -> list[TargetSnapshot]:
        """List all registered targets in an isolated thread."""
        return await asyncio.to_thread(self._sync_list_targets)

    def _sync_list_alerts(self, target_id: str | None, limit: int) -> list[AlertRecord]:
        with self._lock, self._session_factory() as session:
            stmt = select(DriftAlertRow).order_by(DriftAlertRow.created_at.desc()).limit(limit)
            if target_id is not None:
                stmt = stmt.where(DriftAlertRow.target_id == target_id)
            rows = session.scalars(stmt).all()
            return [_to_alert_record(r) for r in rows]

    async def list_alerts(self, target_id: str | None = None, limit: int = 100) -> list[AlertRecord]:
        """List recent alerts, optionally filtered by target."""
        return await asyncio.to_thread(self._sync_list_alerts, target_id, limit)

    def _sync_mark_alert_delivered(self, alert_id: int) -> bool:
        with self._lock, self._session_factory() as session:
            alert = session.get(DriftAlertRow, alert_id)
            if alert is None:
                return False
            alert.webhook_delivered = True
            session.commit()
            return True

    async def mark_alert_delivered(self, alert_id: int) -> bool:
        """Mark an alert record as delivered via webhook."""
        return await asyncio.to_thread(self._sync_mark_alert_delivered, alert_id)

    def _sync_record_check_success(
        self,
        target_id: str,
        normalized_value: str,
        rule_violation_msg: str | None,
    ) -> tuple[TargetSnapshot, AlertRecord | None]:
        with self._lock, self._session_factory() as session:
            target = session.get(WatchTargetRow, target_id)
            if target is None:
                raise ValueError(f"Target '{target_id}' not found")

            now = datetime.now(timezone.utc)
            target.last_checked_at = now
            target.consecutive_failures = 0
            alert_created: DriftAlertRow | None = None
            prev_value = target.last_value

            if rule_violation_msg is not None:
                target.status = "DRIFTED"
                target.last_value = normalized_value
                alert_created = DriftAlertRow(
                    target_id=target_id,
                    alert_type="RULE_VIOLATION",
                    previous_value=prev_value,
                    current_value=normalized_value,
                    message=rule_violation_msg,
                    webhook_delivered=False,
                    created_at=now,
                )
                session.add(alert_created)
            elif prev_value is not None and prev_value != normalized_value:
                target.status = "DRIFTED"
                target.last_value = normalized_value
                alert_created = DriftAlertRow(
                    target_id=target_id,
                    alert_type="VALUE_DRIFT",
                    previous_value=prev_value,
                    current_value=normalized_value,
                    message=f"Value shifted from '{prev_value}' to '{normalized_value}'",
                    webhook_delivered=False,
                    created_at=now,
                )
                session.add(alert_created)
            else:
                target.status = "HEALTHY"
                target.last_value = normalized_value

            snapshot = CheckSnapshotRow(
                target_id=target_id,
                extracted_value=normalized_value,
                status=target.status,
                error_detail=rule_violation_msg,
                checked_at=now,
            )
            session.add(snapshot)
            session.commit()

            alert_record = _to_alert_record(alert_created) if alert_created else None
            return _to_snapshot(target), alert_record

    async def record_check_success(
        self,
        target_id: str,
        normalized_value: str,
        rule_violation_msg: str | None,
    ) -> tuple[TargetSnapshot, AlertRecord | None]:
        """Record successful check, evaluating diff and resetting consecutive failures."""
        return await asyncio.to_thread(
            self._sync_record_check_success,
            target_id,
            normalized_value,
            rule_violation_msg,
        )

    def _sync_record_check_failure(
        self,
        target_id: str,
        error_detail: str,
    ) -> tuple[TargetSnapshot, AlertRecord | None]:
        with self._lock, self._session_factory() as session:
            target = session.get(WatchTargetRow, target_id)
            if target is None:
                raise ValueError(f"Target '{target_id}' not found")

            now = datetime.now(timezone.utc)
            target.last_checked_at = now
            target.consecutive_failures += 1
            alert_created: DriftAlertRow | None = None

            if target.consecutive_failures < target.failure_threshold:
                target.status = "DEGRADED"
            elif target.consecutive_failures == target.failure_threshold:
                target.status = "FAILING"
                alert_created = DriftAlertRow(
                    target_id=target_id,
                    alert_type="CONSECUTIVE_FAILURES",
                    previous_value=target.last_value,
                    current_value=None,
                    message=(
                        f"Consecutive check failures reached debounce threshold "
                        f"({target.failure_threshold}): {error_detail}"
                    ),
                    webhook_delivered=False,
                    created_at=now,
                )
                session.add(alert_created)
            else:
                target.status = "FAILING"

            snapshot = CheckSnapshotRow(
                target_id=target_id,
                extracted_value=None,
                status=target.status,
                error_detail=error_detail,
                checked_at=now,
            )
            session.add(snapshot)
            session.commit()

            alert_record = _to_alert_record(alert_created) if alert_created else None
            return _to_snapshot(target), alert_record

    async def record_check_failure(
        self,
        target_id: str,
        error_detail: str,
    ) -> tuple[TargetSnapshot, AlertRecord | None]:
        """Record check failure, applying N-threshold debounce before emitting alert."""
        return await asyncio.to_thread(
            self._sync_record_check_failure,
            target_id,
            error_detail,
        )
