from __future__ import annotations

import asyncio
import threading
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import create_engine, desc, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from pulsebox.fingerprint import compute_fingerprint
from pulsebox.models import (
    Base,
    CronMonitorRow,
    ErrorEventRequest,
    IssueEventRow,
    IssueGroupRow,
    IssueGroupSnapshot,
    MonitorRegisterRequest,
    MonitorSnapshot,
)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _ensure_tz(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _row_to_issue_snapshot(row: IssueGroupRow) -> IssueGroupSnapshot:
    first_seen = _ensure_tz(row.first_seen_at)
    last_seen = _ensure_tz(row.last_seen_at)
    last_alerted = _ensure_tz(row.last_alerted_at)
    assert first_seen is not None
    assert last_seen is not None
    return IssueGroupSnapshot(
        fingerprint=row.fingerprint,
        service=row.service,
        exception_type=row.exception_type,
        title=row.title,
        status=row.status,  # type: ignore[arg-type]
        occurrence_count=row.occurrence_count,
        first_seen_at=first_seen,
        last_seen_at=last_seen,
        last_alerted_at=last_alerted,
    )


def _row_to_monitor_snapshot(row: CronMonitorRow) -> MonitorSnapshot:
    last_ping = _ensure_tz(row.last_ping_at)
    next_due = _ensure_tz(row.next_due_at)
    updated = _ensure_tz(row.updated_at)
    assert updated is not None
    return MonitorSnapshot(
        slug=row.slug,
        service=row.service,
        interval_seconds=row.interval_seconds,
        grace_seconds=row.grace_seconds,
        status=row.status,  # type: ignore[arg-type]
        last_ping_at=last_ping,
        next_due_at=next_due,
        consecutive_misses=row.consecutive_misses,
        webhook_url=row.webhook_url,
        updated_at=updated,
    )


class PulseStore:
    """Synchronous Unit-of-Work repository isolated via asyncio.to_thread and threading lock."""

    def __init__(self, database_url: str = "sqlite:///:memory:") -> None:
        self._lock = threading.Lock()
        connect_args: dict[str, Any] = {}
        engine_kwargs: dict[str, Any] = {}

        if database_url.startswith("sqlite"):
            connect_args["check_same_thread"] = False
            if ":memory:" in database_url:
                engine_kwargs["poolclass"] = StaticPool

        if connect_args:
            engine_kwargs["connect_args"] = connect_args

        self.engine = create_engine(database_url, **engine_kwargs)
        Base.metadata.create_all(self.engine)
        self.session_factory = sessionmaker(
            bind=self.engine,
            autoflush=False,
            autocommit=False,
            expire_on_commit=False,
        )

    def _sync_ingest_event(
        self, req: ErrorEventRequest, alert_cooldown_seconds: int = 300
    ) -> tuple[IssueGroupSnapshot, bool]:
        now = _utc_now()
        fp = compute_fingerprint(
            service=req.service,
            exception_type=req.exception_type,
            stacktrace=req.stacktrace,
            custom_fingerprint=req.custom_fingerprint,
        )

        title = (
            f"{req.exception_type}: {req.message.strip()}"[:512]
            if req.message.strip()
            else req.exception_type[:512]
        )

        with self._lock, self.session_factory() as session, session.begin():
            stmt = select(IssueGroupRow).where(IssueGroupRow.fingerprint == fp).with_for_update()
            group = session.scalars(stmt).first()
            should_alert: bool

            if group is None:
                # First time seen: create OPEN issue and trigger alert
                group = IssueGroupRow(
                    fingerprint=fp,
                    service=req.service,
                    exception_type=req.exception_type,
                    title=title,
                    status="OPEN",
                    occurrence_count=1,
                    first_seen_at=now,
                    last_seen_at=now,
                    last_alerted_at=now,
                )
                session.add(group)
                should_alert = True
            elif group.status == "RESOLVED":
                # Previously resolved issue recurred: transition to REGRESSED and alert immediately
                group.status = "REGRESSED"
                group.occurrence_count += 1
                group.last_seen_at = now
                group.last_alerted_at = now
                should_alert = True
            else:
                # Group is OPEN or REGRESSED: increment count and check cooldown window
                group.occurrence_count += 1
                group.last_seen_at = now
                last_alerted = _ensure_tz(group.last_alerted_at)

                if (
                    last_alerted is None
                    or (now - last_alerted).total_seconds() >= alert_cooldown_seconds
                ):
                    group.last_alerted_at = now
                    should_alert = True
                else:
                    should_alert = False

            event = IssueEventRow(
                fingerprint=fp,
                service=req.service,
                environment=req.environment,
                exception_type=req.exception_type,
                message=req.message,
                stacktrace=req.stacktrace,
                created_at=now,
            )
            session.add(event)
            session.flush()

            snapshot = _row_to_issue_snapshot(group)
            return snapshot, should_alert

    async def ingest_event(
        self, req: ErrorEventRequest, alert_cooldown_seconds: int = 300
    ) -> tuple[IssueGroupSnapshot, bool]:
        return await asyncio.to_thread(self._sync_ingest_event, req, alert_cooldown_seconds)

    def _sync_resolve_issue(self, fingerprint: str) -> IssueGroupSnapshot:
        with self._lock, self.session_factory() as session, session.begin():
            stmt = (
                select(IssueGroupRow)
                .where(IssueGroupRow.fingerprint == fingerprint)
                .with_for_update()
            )
            group = session.scalars(stmt).first()
            if group is None:
                raise KeyError(f"Issue group with fingerprint {fingerprint} not found")

            group.status = "RESOLVED"
            session.flush()
            return _row_to_issue_snapshot(group)

    async def resolve_issue(self, fingerprint: str) -> IssueGroupSnapshot:
        return await asyncio.to_thread(self._sync_resolve_issue, fingerprint)

    def _sync_list_issues(
        self, service: str | None = None, status: str | None = None
    ) -> list[IssueGroupSnapshot]:
        with self._lock, self.session_factory() as session:
            stmt = select(IssueGroupRow).order_by(desc(IssueGroupRow.last_seen_at))
            if service:
                stmt = stmt.where(IssueGroupRow.service == service)
            if status:
                stmt = stmt.where(IssueGroupRow.status == status)

            rows = session.scalars(stmt).all()
            return [_row_to_issue_snapshot(r) for r in rows]

    async def list_issues(
        self, service: str | None = None, status: str | None = None
    ) -> list[IssueGroupSnapshot]:
        return await asyncio.to_thread(self._sync_list_issues, service, status)

    def _sync_get_issue(self, fingerprint: str) -> IssueGroupSnapshot | None:
        with self._lock, self.session_factory() as session:
            stmt = select(IssueGroupRow).where(IssueGroupRow.fingerprint == fingerprint)
            row = session.scalars(stmt).first()
            if row is None:
                return None
            return _row_to_issue_snapshot(row)

    async def get_issue(self, fingerprint: str) -> IssueGroupSnapshot | None:
        return await asyncio.to_thread(self._sync_get_issue, fingerprint)

    def _sync_register_monitor(
        self, req: MonitorRegisterRequest, now: datetime | None = None
    ) -> MonitorSnapshot:
        current_time = _utc_now() if now is None else _ensure_tz(now)
        assert current_time is not None
        initial_due = current_time + timedelta(seconds=req.interval_seconds + req.grace_seconds)

        with self._lock, self.session_factory() as session, session.begin():
            stmt = select(CronMonitorRow).where(CronMonitorRow.slug == req.slug).with_for_update()
            row = session.scalars(stmt).first()

            if row is None:
                row = CronMonitorRow(
                    slug=req.slug,
                    service=req.service,
                    interval_seconds=req.interval_seconds,
                    grace_seconds=req.grace_seconds,
                    status="OK",
                    last_ping_at=None,
                    next_due_at=initial_due,
                    consecutive_misses=0,
                    webhook_url=req.webhook_url,
                    updated_at=current_time,
                )
                session.add(row)
            else:
                row.service = req.service
                row.interval_seconds = req.interval_seconds
                row.grace_seconds = req.grace_seconds
                row.webhook_url = req.webhook_url
                row.updated_at = current_time
                if row.next_due_at is None:
                    row.next_due_at = initial_due

            session.flush()
            return _row_to_monitor_snapshot(row)

    async def register_monitor(
        self, req: MonitorRegisterRequest, now: datetime | None = None
    ) -> MonitorSnapshot:
        return await asyncio.to_thread(self._sync_register_monitor, req, now)

    def _sync_record_ping(self, slug: str, now: datetime | None = None) -> MonitorSnapshot:
        current_time = _utc_now() if now is None else _ensure_tz(now)
        assert current_time is not None

        with self._lock, self.session_factory() as session, session.begin():
            stmt = select(CronMonitorRow).where(CronMonitorRow.slug == slug).with_for_update()
            row = session.scalars(stmt).first()
            if row is None:
                raise KeyError(f"Cron monitor with slug {slug} not found")

            next_due = current_time + timedelta(seconds=row.interval_seconds + row.grace_seconds)
            row.status = "OK"
            row.last_ping_at = current_time
            row.next_due_at = next_due
            row.consecutive_misses = 0
            row.updated_at = current_time

            session.flush()
            return _row_to_monitor_snapshot(row)

    async def record_ping(self, slug: str, now: datetime | None = None) -> MonitorSnapshot:
        return await asyncio.to_thread(self._sync_record_ping, slug, now)

    def _sync_evaluate_overdue_monitors(self, now: datetime | None = None) -> list[MonitorSnapshot]:
        current_time = _utc_now() if now is None else _ensure_tz(now)
        assert current_time is not None

        with self._lock, self.session_factory() as session, session.begin():
            stmt = (
                select(CronMonitorRow)
                .where(
                    CronMonitorRow.next_due_at <= current_time,
                    CronMonitorRow.status != "ALERTED",
                )
                .with_for_update()
            )
            rows = session.scalars(stmt).all()
            alerted: list[MonitorSnapshot] = []

            for row in rows:
                row.status = "ALERTED"
                row.consecutive_misses += 1
                row.updated_at = current_time
                alerted.append(_row_to_monitor_snapshot(row))

            session.flush()
            return alerted

    async def evaluate_overdue_monitors(self, now: datetime | None = None) -> list[MonitorSnapshot]:
        return await asyncio.to_thread(self._sync_evaluate_overdue_monitors, now)

    def _sync_get_monitor(self, slug: str) -> MonitorSnapshot | None:
        with self._lock, self.session_factory() as session:
            stmt = select(CronMonitorRow).where(CronMonitorRow.slug == slug)
            row = session.scalars(stmt).first()
            if row is None:
                return None
            return _row_to_monitor_snapshot(row)

    async def get_monitor(self, slug: str) -> MonitorSnapshot | None:
        return await asyncio.to_thread(self._sync_get_monitor, slug)

    def _sync_list_monitors(self) -> list[MonitorSnapshot]:
        with self._lock, self.session_factory() as session:
            stmt = select(CronMonitorRow).order_by(CronMonitorRow.slug.asc())
            rows = session.scalars(stmt).all()
            return [_row_to_monitor_snapshot(r) for r in rows]

    async def list_monitors(self) -> list[MonitorSnapshot]:
        return await asyncio.to_thread(self._sync_list_monitors)
