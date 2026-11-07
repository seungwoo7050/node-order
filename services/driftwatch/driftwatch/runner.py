"""Async runner controlling concurrency, debounce checking, webhooks, and metrics."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any

import httpx

from driftwatch.extractor import HttpFetcher, extract_value, validate_extracted_value
from driftwatch.models import AlertRecord, CheckResult
from driftwatch.store import DriftStore

logger = logging.getLogger(__name__)


class MetricsTracker:
    """Thread-safe Prometheus metrics in-memory counter tracker."""

    def __init__(self) -> None:
        self.checks_total: int = 0
        self.drifts_total: int = 0
        self.failures_total: int = 0

    def inc_checks(self) -> None:
        self.checks_total += 1

    def inc_drifts(self) -> None:
        self.drifts_total += 1

    def inc_failures(self) -> None:
        self.failures_total += 1

    def render_prometheus(self) -> str:
        """Render metrics in standard Prometheus exposition format."""
        lines = [
            "# HELP driftwatch_checks_total Total number of target checks executed",
            "# TYPE driftwatch_checks_total counter",
            f"driftwatch_checks_total {self.checks_total}",
            "# HELP driftwatch_drifts_total Total number of detected fact drifts and violations",
            "# TYPE driftwatch_drifts_total counter",
            f"driftwatch_drifts_total {self.drifts_total}",
            "# HELP driftwatch_failures_total Total number of fetch and extraction failures",
            "# TYPE driftwatch_failures_total counter",
            f"driftwatch_failures_total {self.failures_total}",
        ]
        return "\n".join(lines) + "\n"


class DriftRunner:
    """Periodic target collector with semaphore-based concurrency control."""

    def __init__(
        self,
        store: DriftStore,
        fetcher: HttpFetcher | None = None,
        max_concurrency: int = 10,
        webhook_client: httpx.AsyncClient | None = None,
    ) -> None:
        self.store = store
        self.fetcher = fetcher or HttpFetcher()
        self.semaphore = asyncio.Semaphore(max_concurrency)
        self.max_concurrency = max_concurrency
        self.webhook_client = webhook_client
        self.metrics = MetricsTracker()

    async def _post_webhook(self, webhook_url: str, alert: AlertRecord) -> None:
        """Deliver JSON alert webhook and shield delivery state update."""
        payload: dict[str, Any] = {
            "alert_id": alert.alert_id,
            "target_id": alert.target_id,
            "alert_type": alert.alert_type,
            "previous_value": alert.previous_value,
            "current_value": alert.current_value,
            "message": alert.message,
            "created_at": alert.created_at.isoformat(),
            "text": f"[{alert.alert_type}] Target '{alert.target_id}': {alert.message}",
        }

        try:
            if self.webhook_client is not None:
                resp = await self.webhook_client.post(webhook_url, json=payload, timeout=10.0)
                resp.raise_for_status()
            else:
                async with httpx.AsyncClient(timeout=10.0) as client:
                    resp = await client.post(webhook_url, json=payload)
                    resp.raise_for_status()

            await asyncio.shield(self.store.mark_alert_delivered(alert.alert_id))
        except Exception as exc:
            logger.warning("Failed to deliver webhook for alert %s: %s", alert.alert_id, exc)

    async def check_target(self, target_id: str) -> CheckResult:
        """Run single check on target with semaphore concurrency guard."""
        async with self.semaphore:
            target = await self.store.get_target(target_id)
            if target is None:
                raise ValueError(f"Target '{target_id}' not found")

            self.metrics.inc_checks()

            try:
                raw_body = await self.fetcher.fetch(target.url)
            except Exception as exc:
                self.metrics.inc_failures()
                err_msg = f"Fetch failed: {exc}"
                snapshot, alert = await self.store.record_check_failure(target_id, err_msg)
                if alert and target.webhook_url:
                    await self._post_webhook(target.webhook_url, alert)

                return CheckResult(
                    target_id=target_id,
                    status=snapshot.status,
                    extracted_value=None,
                    drift_detected=False,
                    alert_created=alert is not None,
                    alert_type=alert.alert_type if alert else None,
                    error_detail=err_msg,
                    checked_at=snapshot.last_checked_at or datetime.now(timezone.utc),
                )

            try:
                extracted = extract_value(raw_body, target.extractor_type, target.selector)
            except Exception as exc:
                self.metrics.inc_failures()
                err_msg = f"Extraction failed: {exc}"
                snapshot, alert = await self.store.record_check_failure(target_id, err_msg)
                if alert and target.webhook_url:
                    await self._post_webhook(target.webhook_url, alert)

                return CheckResult(
                    target_id=target_id,
                    status=snapshot.status,
                    extracted_value=None,
                    drift_detected=False,
                    alert_created=alert is not None,
                    alert_type=alert.alert_type if alert else None,
                    error_detail=err_msg,
                    checked_at=snapshot.last_checked_at or datetime.now(timezone.utc),
                )

            norm_val, violation_msg = validate_extracted_value(
                extracted,
                target.expected_type,
                target.expected_value,
                target.min_value,
                target.max_value,
            )

            snapshot, alert = await self.store.record_check_success(
                target_id,
                norm_val,
                violation_msg,
            )

            if alert:
                if alert.alert_type in ("VALUE_DRIFT", "RULE_VIOLATION"):
                    self.metrics.inc_drifts()
                if target.webhook_url:
                    await self._post_webhook(target.webhook_url, alert)

            return CheckResult(
                target_id=target_id,
                status=snapshot.status,
                extracted_value=norm_val,
                drift_detected=(snapshot.status == "DRIFTED"),
                alert_created=alert is not None,
                alert_type=alert.alert_type if alert else None,
                error_detail=violation_msg,
                checked_at=snapshot.last_checked_at or datetime.now(timezone.utc),
            )

    async def check_due_targets(self) -> list[CheckResult]:
        """Collect all targets due for periodic evaluation and run concurrently."""
        all_targets = await self.store.list_targets()
        now = datetime.now(timezone.utc)
        due_targets: list[str] = []

        for t in all_targets:
            if t.last_checked_at is None:
                due_targets.append(t.target_id)
            else:
                last_checked = t.last_checked_at
                if last_checked.tzinfo is None:
                    last_checked = last_checked.replace(tzinfo=timezone.utc)
                elapsed = (now - last_checked).total_seconds()
                if elapsed >= t.interval_seconds:
                    due_targets.append(t.target_id)

        if not due_targets:
            return []

        tasks = [self.check_target(tid) for tid in due_targets]
        results = await asyncio.gather(*tasks)
        return list(results)
