from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from httpx import ASGITransport

from pulsebox.app import create_app
from pulsebox.fingerprint import compute_fingerprint, normalize_stacktrace
from pulsebox.models import ErrorEventRequest, MonitorRegisterRequest
from pulsebox.store import PulseStore
from pulsebox.watchdog import PulseWatchdog


@pytest.mark.asyncio
async def test_fingerprint_normalization_and_dedup() -> None:
    """Verify stacktraces with dynamic addresses and lines merge into the same fingerprint."""
    trace_a = (
        "Traceback (most recent call last):\n"
        '  File "/var/app/billing.py", line 42, in process_payment\n'
        "    handler = <PaymentGateway at 0x7ffee1>\n"
        "ValueError: card token 12345678-1234-1234-1234-123456789abc expired at "
        "2026-11-07T12:00:00Z\n"
    )
    trace_b = (
        "Traceback (most recent call last):\n"
        '  File "/var/app/billing.py", line 188, in process_payment\n'
        "    handler = <PaymentGateway at 0x99aabb>\n"
        "ValueError: card token 87654321-4321-4321-4321-cba987654321 expired at "
        "2026-11-07T14:30:15Z\n"
    )

    norm_a = normalize_stacktrace(trace_a)
    norm_b = normalize_stacktrace(trace_b)
    assert norm_a == norm_b
    assert "<addr>" in norm_a
    assert "line <n>" in norm_a
    assert "<uuid>" in norm_a
    assert "<timestamp>" in norm_a

    fp_a = compute_fingerprint("billing-service", "ValueError", trace_a)
    fp_b = compute_fingerprint("billing-service", "ValueError", trace_b)
    assert fp_a == fp_b
    assert len(fp_a) == 64

    store = PulseStore()
    req_a = ErrorEventRequest(
        service="billing-service",
        exception_type="ValueError",
        message="card expired",
        stacktrace=trace_a,
    )
    req_b = ErrorEventRequest(
        service="billing-service",
        exception_type="ValueError",
        message="card expired",
        stacktrace=trace_b,
    )

    iss_a, alert_a = await store.ingest_event(req_a)
    assert alert_a is True
    assert iss_a.occurrence_count == 1
    assert iss_a.status == "OPEN"

    iss_b, alert_b = await store.ingest_event(req_b)
    assert alert_b is False  # Cooldown suppression
    assert iss_b.occurrence_count == 2
    assert iss_b.fingerprint == iss_a.fingerprint


@pytest.mark.asyncio
async def test_concurrent_ingest_and_alert_cooldown() -> None:
    """Verify 20 concurrent events result in count=20 and exactly 1 alert under thread isolation."""
    store = PulseStore()
    trace = (
        "Traceback (most recent call last):\n"
        '  File "/app/worker.py", line 77, in run\n'
        "    ctx = <WorkerContext at 0x102030>\n"
        "RuntimeError: connection timed out\n"
    )
    req = ErrorEventRequest(
        service="order-worker",
        exception_type="RuntimeError",
        message="connection timed out",
        stacktrace=trace,
    )

    # Ingest 20 events concurrently
    results = await asyncio.gather(
        *(store.ingest_event(req, alert_cooldown_seconds=300) for _ in range(20))
    )

    alert_flags = [alert for _, alert in results]
    assert len(results) == 20
    assert alert_flags.count(True) == 1
    assert alert_flags.count(False) == 19

    # Check store state
    fp = compute_fingerprint("order-worker", "RuntimeError", trace)
    issue = await store.get_issue(fp)
    assert issue is not None
    assert issue.occurrence_count == 20
    assert issue.status == "OPEN"


@pytest.mark.asyncio
async def test_resolved_to_regressed_state_transition() -> None:
    """Verify that a resolved issue transitions to REGRESSED and alerts immediately."""
    store = PulseStore()
    req = ErrorEventRequest(
        service="auth-service",
        exception_type="KeyError",
        message="jwt kid not found",
        stacktrace='KeyError: "kid"\n  File "jwt.py", line 12\n',
    )

    iss1, alert1 = await store.ingest_event(req)
    assert iss1.status == "OPEN"
    assert alert1 is True

    # Resolve issue
    resolved = await store.resolve_issue(iss1.fingerprint)
    assert resolved.status == "RESOLVED"

    # Ingest again: should transition to REGRESSED and trigger immediate alert
    iss2, alert2 = await store.ingest_event(req, alert_cooldown_seconds=3600)
    assert iss2.status == "REGRESSED"
    assert alert2 is True
    assert iss2.occurrence_count == 2


@pytest.mark.asyncio
async def test_cron_monitor_overdue_and_ping_recovery() -> None:
    """Verify overdue cron monitor transitions to ALERTED once, and recovers to OK on ping."""
    store = PulseStore()
    now = datetime(2026, 11, 7, 10, 0, 0, tzinfo=timezone.utc)

    # Register monitor with 10s interval + 5s grace (due at 10:00:15)
    reg = MonitorRegisterRequest(
        slug="daily-settlement",
        service="settlement-worker",
        interval_seconds=10,
        grace_seconds=5,
    )
    mon = await store.register_monitor(reg, now=now)
    assert mon.status == "OK"

    # Evaluate at 10:00:10 (within grace window): no alert
    overdue_early = await store.evaluate_overdue_monitors(now=now + timedelta(seconds=10))
    assert len(overdue_early) == 0

    # Evaluate at 10:00:16 (past grace window): transitions to ALERTED exactly once
    overdue = await store.evaluate_overdue_monitors(now=now + timedelta(seconds=16))
    assert len(overdue) == 1
    assert overdue[0].slug == "daily-settlement"
    assert overdue[0].status == "ALERTED"
    assert overdue[0].consecutive_misses == 1

    # Evaluate again at 10:00:20: already ALERTED, should not trigger again
    overdue_again = await store.evaluate_overdue_monitors(now=now + timedelta(seconds=20))
    assert len(overdue_again) == 0

    # Record ping: status recovers to OK and consecutive_misses resets to 0
    pinged = await store.record_ping(slug="daily-settlement", now=now + timedelta(seconds=25))
    assert pinged.status == "OK"
    assert pinged.consecutive_misses == 0
    assert pinged.next_due_at == now + timedelta(seconds=40)


@pytest.mark.asyncio
async def test_fastapi_e2e_endpoints() -> None:
    """Verify complete HTTP API surface including health, events, issues, monitors, and metrics."""
    store = PulseStore()
    watchdog = PulseWatchdog(store=store)
    app = create_app(store=store, watchdog=watchdog, enable_background_watchdog=False)

    transport = ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        # 1. Health check
        res = await client.get("/healthz")
        assert res.status_code == 200
        assert res.json() == {"status": "ok"}

        # 2. Ingest error event
        event_payload = {
            "service": "checkout-api",
            "exception_type": "ConnectionRefusedError",
            "message": "database port 5432 unreachable",
            "stacktrace": 'ConnectionRefusedError: [Errno 111]\n  File "db.py", line 10 at 0xfa11',
            "environment": "production",
        }
        res = await client.post("/v1/events", json=event_payload)
        assert res.status_code == 201
        data = res.json()
        assert data["alerted"] is True
        fp = data["issue"]["fingerprint"]
        assert len(fp) == 64

        # 3. List issues
        res = await client.get("/v1/issues")
        assert res.status_code == 200
        issues = res.json()
        assert len(issues) == 1
        assert issues[0]["fingerprint"] == fp

        # 4. Resolve issue
        res = await client.post(f"/v1/issues/{fp}/resolve")
        assert res.status_code == 200
        assert res.json()["status"] == "RESOLVED"

        # 5. Register cron monitor
        mon_payload = {
            "slug": "db-backup-cron",
            "service": "infra-backup",
            "interval_seconds": 3600,
            "grace_seconds": 300,
        }
        res = await client.post("/v1/monitors", json=mon_payload)
        assert res.status_code == 201
        assert res.json()["slug"] == "db-backup-cron"

        # 6. List monitors
        res = await client.get("/v1/monitors")
        assert res.status_code == 200
        monitors = res.json()
        assert len(monitors) == 1
        assert monitors[0]["slug"] == "db-backup-cron"

        # 7. Record check-in ping
        res = await client.post("/v1/monitors/db-backup-cron/ping")
        assert res.status_code == 200
        assert res.json()["status"] == "OK"

        # 8. Trigger manual scan
        res = await client.post("/v1/watchdog/scan")
        assert res.status_code == 200
        assert "alerted_monitors" in res.json()

        # 9. Scrape Prometheus metrics
        res = await client.get("/metrics")
        assert res.status_code == 200
        assert "pulsebox_events_ingested_total 1" in res.text
        assert "pulsebox_cron_alerts_total 0" in res.text
