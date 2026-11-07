"""Comprehensive unit, concurrency, and E2E integration tests for driftwatch."""

from __future__ import annotations

import asyncio
from typing import Any

import httpx
import pytest
from httpx import ASGITransport

from driftwatch.app import create_app
from driftwatch.extractor import (
    HttpFetcher,
    extract_value,
    validate_extracted_value,
)
from driftwatch.models import TargetCreateRequest
from driftwatch.runner import DriftRunner
from driftwatch.store import DriftStore


# ---------------------------------------------------------------------------
# 1. JSON Path and Regex Word Boundary Extractor Tests
# ---------------------------------------------------------------------------
def test_json_path_extraction() -> None:
    payload = """
    {
        "status": "ok",
        "data": {
            "fare": {
                "adult": 1500,
                "child": 700
            },
            "routes": [
                {"id": "line-1", "active": true, "intervals": [10, 15]},
                {"id": "line-2", "active": false, "intervals": [20, 25]}
            ]
        }
    }
    """
    assert extract_value(payload, "json_path", "data.fare.adult") == "1500"
    assert extract_value(payload, "json_path", "data.routes.0.id") == "line-1"
    assert extract_value(payload, "json_path", "data.routes.1.intervals.0") == "20"

    with pytest.raises(ValueError, match="Key 'unknown' not found"):
        extract_value(payload, "json_path", "data.fare.unknown")

    with pytest.raises(ValueError, match="List index 5 out of range"):
        extract_value(payload, "json_path", "data.routes.5.id")


def test_regex_numeric_word_boundary_extraction() -> None:
    # False positive test: pattern matches 15 only if not part of a larger number
    safe_pattern = r"(?<!\d)15(?!\d)"

    # When body contains 1500, it should NOT match 15
    with pytest.raises(ValueError, match="did not match"):
        extract_value("Total cost is 1500 KRW", "regex", safe_pattern)

    # When body contains isolated 15, it matches exactly
    assert extract_value("Total interval is 15 minutes", "regex", safe_pattern) == "15"

    # Capture group extraction with boundary protection
    capture_pattern = r"fare:\s*(?<!\d)(\d+)(?!\d)"
    extracted = extract_value("Notice: current fare: 4100 KRW only", "regex", capture_pattern)
    assert extracted == "4100"


def test_validate_extracted_value() -> None:
    # int validation and range bounds
    val, err = validate_extracted_value("4100", "int", expected_value="4100", min_value=1000, max_value=5000)
    assert val == "4100"
    assert err is None

    # violation: out of range
    val, err = validate_extracted_value("5500", "int", expected_value=None, min_value=1000, max_value=5000)
    assert val == "5500"
    assert err is not None
    assert "exceeds maximum allowed 5000" in err

    # violation: expected mismatch
    val, err = validate_extracted_value("4500", "int", expected_value="4100", min_value=None, max_value=None)
    assert val == "4500"
    assert err is not None
    assert "Expected value 4100, got 4500" in err

    # float validation
    val, err = validate_extracted_value("1350.5", "float", expected_value="1350.5", min_value=1000.0, max_value=2000.0)
    assert val == "1350.5"
    assert err is None


# ---------------------------------------------------------------------------
# 2. Value Drift Detection Test (4100 -> 4500)
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_value_drift_detection() -> None:
    store = DriftStore()

    target_req = TargetCreateRequest(
        target_id="seoul-subway-fare",
        name="Seoul Subway Base Fare",
        url="https://api.example.com/fare",
        extractor_type="json_path",
        selector="fare.adult",
        expected_type="int",
        expected_value="4100",
        failure_threshold=3,
        interval_seconds=60,
    )
    await store.upsert_target(target_req)

    # First check: returns 4100
    snap1, alert1 = await store.record_check_success("seoul-subway-fare", "4100", None)
    assert snap1.status == "HEALTHY"
    assert snap1.last_value == "4100"
    assert alert1 is None

    # Second check: fact drifted to 4500
    snap2, alert2 = await store.record_check_success("seoul-subway-fare", "4500", None)
    assert snap2.status == "DRIFTED"
    assert snap2.last_value == "4500"
    assert alert2 is not None
    assert alert2.alert_type == "VALUE_DRIFT"
    assert alert2.previous_value == "4100"
    assert alert2.current_value == "4500"

    alerts = await store.list_alerts(target_id="seoul-subway-fare")
    assert len(alerts) == 1
    assert alerts[0].alert_type == "VALUE_DRIFT"


# ---------------------------------------------------------------------------
# 3. Consecutive Failures Debounce Test (DEGRADED -> FAILING -> Reset)
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_consecutive_failures_debounce_and_recovery() -> None:
    store = DriftStore()
    target_req = TargetCreateRequest(
        target_id="api-exchange-rate",
        name="Exchange Rate API",
        url="https://api.example.com/rate",
        extractor_type="json_path",
        selector="rate.usd",
        expected_type="float",
        failure_threshold=3,
        interval_seconds=60,
    )
    await store.upsert_target(target_req)

    # Initial success to set baseline
    await store.record_check_success("api-exchange-rate", "1380.5", None)

    # Failure 1: DEGRADED, no alert (transient glitch debounce)
    s1, a1 = await store.record_check_failure("api-exchange-rate", "HTTP 503 Service Unavailable")
    assert s1.status == "DEGRADED"
    assert s1.consecutive_failures == 1
    assert a1 is None

    # Failure 2: DEGRADED, no alert
    s2, a2 = await store.record_check_failure("api-exchange-rate", "HTTP 503 Service Unavailable")
    assert s2.status == "DEGRADED"
    assert s2.consecutive_failures == 2
    assert a2 is None

    # Failure 3: Reached failure_threshold (3) -> FAILING, Alert generated!
    s3, a3 = await store.record_check_failure("api-exchange-rate", "HTTP 503 Service Unavailable")
    assert s3.status == "FAILING"
    assert s3.consecutive_failures == 3
    assert a3 is not None
    assert a3.alert_type == "CONSECUTIVE_FAILURES"
    assert "threshold (3)" in a3.message

    # Failure 4: Still FAILING, but debounce prevents duplicate alert
    s4, a4 = await store.record_check_failure("api-exchange-rate", "HTTP 503 Service Unavailable")
    assert s4.status == "FAILING"
    assert s4.consecutive_failures == 4
    assert a4 is None

    all_alerts = await store.list_alerts("api-exchange-rate")
    assert len(all_alerts) == 1

    # Recovery: Successful check resets consecutive_failures to 0 and status to HEALTHY
    s5, a5 = await store.record_check_success("api-exchange-rate", "1380.5", None)
    assert s5.status == "HEALTHY"
    assert s5.consecutive_failures == 0
    assert a5 is None


# ---------------------------------------------------------------------------
# 4. Concurrency Limit and Webhook Delivery Test
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_concurrency_semaphore_and_webhook_dispatch() -> None:
    store = DriftStore()
    active_requests = 0
    max_active_observed = 0
    lock = asyncio.Lock()

    # Custom mock transport to simulate network delay and monitor concurrency
    class ConcurrencyTransport(httpx.AsyncBaseTransport):
        async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
            nonlocal active_requests, max_active_observed
            async with lock:
                active_requests += 1
                if active_requests > max_active_observed:
                    max_active_observed = active_requests

            await asyncio.sleep(0.02)

            async with lock:
                active_requests -= 1

            return httpx.Response(
                status_code=200,
                json={"fare": {"adult": 2000}},
                request=request,
            )

    # Custom mock transport for webhook receiver
    webhook_delivered_ids: list[str] = []

    class WebhookTransport(httpx.AsyncBaseTransport):
        async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
            body: Any = httpx.Response(status_code=200, content=request.content).json()
            webhook_delivered_ids.append(body["target_id"])
            return httpx.Response(status_code=200, json={"ok": True}, request=request)

    fetcher = HttpFetcher(transport=ConcurrencyTransport())
    webhook_client = httpx.AsyncClient(transport=WebhookTransport())

    runner = DriftRunner(
        store=store,
        fetcher=fetcher,
        max_concurrency=4,  # Concurrency limit = 4
        webhook_client=webhook_client,
    )

    # Seed 20 targets
    for i in range(20):
        await store.upsert_target(
            TargetCreateRequest(
                target_id=f"target-{i:02d}",
                name=f"Target {i}",
                url=f"https://api.example.com/item/{i}",
                extractor_type="json_path",
                selector="fare.adult",
                expected_type="int",
                expected_value="1500",  # Returns 2000, so each will trigger VALUE_DRIFT / RULE_VIOLATION
                interval_seconds=1,
                webhook_url="https://hooks.slack.com/services/test/webhook",
            )
        )

    # Execute check on all 20 due targets
    results = await runner.check_due_targets()
    assert len(results) == 20
    assert max_active_observed <= 4
    assert max_active_observed > 1

    # Verify that webhooks were dispatched
    assert len(webhook_delivered_ids) == 20
    delivered_alerts = await store.list_alerts(limit=50)
    for alert in delivered_alerts:
        assert alert.webhook_delivered is True

    await webhook_client.aclose()


# ---------------------------------------------------------------------------
# 5. FastAPI ASGITransport E2E Integration Test
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_fastapi_e2e_endpoints() -> None:
    store = DriftStore()

    class MockTransport(httpx.AsyncBaseTransport):
        async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
            if "status" in str(request.url):
                return httpx.Response(status_code=200, json={"server": {"version": "v1.2.3"}}, request=request)
            return httpx.Response(status_code=404, request=request)

    fetcher = HttpFetcher(transport=MockTransport())
    runner = DriftRunner(store=store, fetcher=fetcher)
    app = create_app(store=store, runner=runner, poll_interval=0.0)

    transport = ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        # 1. Healthz
        res = await client.get("/healthz")
        assert res.status_code == 200
        assert res.json() == {"status": "ok", "targets_count": 0}

        # 2. Register Target
        payload = {
            "target_id": "api-version-check",
            "name": "Service Version Check",
            "url": "http://internal/status",
            "extractor_type": "json_path",
            "selector": "server.version",
            "expected_type": "str",
            "expected_value": "v1.2.3",
            "failure_threshold": 2,
            "interval_seconds": 30,
        }
        res = await client.post("/v1/targets", json=payload)
        assert res.status_code == 201
        data = res.json()
        assert data["target_id"] == "api-version-check"
        assert data["status"] == "HEALTHY"

        # 3. List Targets
        res = await client.get("/v1/targets")
        assert res.status_code == 200
        assert len(res.json()) == 1

        # 4. Get Target
        res = await client.get("/v1/targets/api-version-check")
        assert res.status_code == 200
        assert res.json()["name"] == "Service Version Check"

        # 5. Check Single Target
        res = await client.post("/v1/targets/api-version-check/check")
        assert res.status_code == 200
        check_res = res.json()
        assert check_res["status"] == "HEALTHY"
        assert check_res["extracted_value"] == "v1.2.3"
        assert check_res["drift_detected"] is False

        # 6. Check All
        res = await client.post("/v1/check-all")
        assert res.status_code == 200

        # 7. Metrics
        res = await client.get("/metrics")
        assert res.status_code == 200
        text = res.text
        assert "driftwatch_checks_total" in text
        assert "driftwatch_drifts_total" in text
        assert "driftwatch_failures_total" in text
