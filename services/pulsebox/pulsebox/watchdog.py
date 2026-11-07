from __future__ import annotations

import asyncio
from typing import Any

import httpx

from pulsebox.models import ErrorEventRequest, IssueGroupSnapshot, MonitorSnapshot
from pulsebox.store import PulseStore


class PulseWatchdog:
    """Dead man's switch watchdog and asynchronous alert dispatcher."""

    def __init__(
        self,
        store: PulseStore,
        default_webhook_url: str | None = None,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self.store = store
        self.default_webhook_url = default_webhook_url
        self._custom_client = http_client
        self._events_ingested = 0
        self._issues_regressed = 0
        self._cron_alerts = 0

    def record_event_ingested(self) -> None:
        self._events_ingested += 1

    def record_issue_regressed(self) -> None:
        self._issues_regressed += 1

    def record_cron_alert(self, count: int = 1) -> None:
        self._cron_alerts += count

    def format_metrics(self) -> str:
        """Render Prometheus exposition text format for core operational metrics."""
        lines = [
            "# HELP pulsebox_events_ingested_total Total number of error events ingested",
            "# TYPE pulsebox_events_ingested_total counter",
            f"pulsebox_events_ingested_total {self._events_ingested}",
            "# HELP pulsebox_issues_regressed_total Total number of resolved issues that regressed",
            "# TYPE pulsebox_issues_regressed_total counter",
            f"pulsebox_issues_regressed_total {self._issues_regressed}",
            (
                "# HELP pulsebox_cron_alerts_total "
                "Total number of cron monitors alerted due to missed check-ins"
            ),
            "# TYPE pulsebox_cron_alerts_total counter",
            f"pulsebox_cron_alerts_total {self._cron_alerts}",
        ]
        return "\n".join(lines) + "\n"

    async def send_webhook(self, url: str, payload: dict[str, Any]) -> bool:
        """Deliver JSON webhook alert payload with timeout and error suppression."""
        if not url:
            return False
        try:
            if self._custom_client is not None:
                resp = await self._custom_client.post(url, json=payload, timeout=5.0)
                return resp.is_success
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.post(url, json=payload)
                return resp.is_success
        except Exception:
            return False

    async def notify_issue(
        self,
        issue: IssueGroupSnapshot,
        event: ErrorEventRequest,
        webhook_url: str | None = None,
    ) -> bool:
        """Dispatch error issue alert webhook to specific or default webhook URL."""
        target_url = webhook_url or self.default_webhook_url
        if not target_url:
            return False

        payload: dict[str, Any] = {
            "event_type": "issue_alert",
            "fingerprint": issue.fingerprint,
            "service": issue.service,
            "exception_type": issue.exception_type,
            "title": issue.title,
            "status": issue.status,
            "occurrence_count": issue.occurrence_count,
            "message": event.message,
            "last_seen_at": issue.last_seen_at.isoformat(),
        }
        return await self.send_webhook(target_url, payload)

    async def scan_monitors(self, default_webhook_url: str | None = None) -> list[MonitorSnapshot]:
        """Scan overdue dead man's switch monitors and send missed check-in alerts."""
        overdue = await self.store.evaluate_overdue_monitors()
        if not overdue:
            return []

        self.record_cron_alert(len(overdue))
        target_default = default_webhook_url or self.default_webhook_url

        for monitor in overdue:
            target_url = monitor.webhook_url or target_default
            if target_url:
                payload: dict[str, Any] = {
                    "event_type": "cron_missed",
                    "slug": monitor.slug,
                    "service": monitor.service,
                    "consecutive_misses": monitor.consecutive_misses,
                    "status": monitor.status,
                    "next_due_at": monitor.next_due_at.isoformat() if monitor.next_due_at else None,
                }
                await self.send_webhook(target_url, payload)

        return overdue

    async def run_loop(
        self, interval_seconds: float = 1.0, stop_event: asyncio.Event | None = None
    ) -> None:
        """Periodic background evaluation loop with clean stop signal handling."""
        while True:
            if stop_event is not None and stop_event.is_set():
                break
            try:
                await self.scan_monitors()
            except Exception:
                pass

            try:
                if stop_event is not None:
                    await asyncio.wait_for(stop_event.wait(), timeout=interval_seconds)
                    break
                await asyncio.sleep(interval_seconds)
            except asyncio.TimeoutError:
                continue
            except asyncio.CancelledError:
                break
