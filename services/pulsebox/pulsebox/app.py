from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from typing import Any, AsyncGenerator

from fastapi import FastAPI, HTTPException, Query, Response, status
from fastapi.responses import PlainTextResponse

from pulsebox.models import (
    ErrorEventRequest,
    IssueGroupSnapshot,
    MonitorRegisterRequest,
    MonitorSnapshot,
)
from pulsebox.store import PulseStore
from pulsebox.watchdog import PulseWatchdog


def create_app(
    store: PulseStore | None = None,
    watchdog: PulseWatchdog | None = None,
    enable_background_watchdog: bool = False,
    watchdog_interval: float = 1.0,
) -> FastAPI:
    """Create and configure the FastAPI application instance."""
    app_store = store or PulseStore()
    app_watchdog = watchdog or PulseWatchdog(store=app_store)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
        app.state.store = app_store
        app.state.watchdog = app_watchdog
        stop_event = asyncio.Event()
        background_task: asyncio.Task[None] | None = None

        if enable_background_watchdog:
            background_task = asyncio.create_task(
                app_watchdog.run_loop(interval_seconds=watchdog_interval, stop_event=stop_event)
            )

        try:
            yield
        finally:
            stop_event.set()
            if background_task is not None:
                background_task.cancel()
                try:
                    await background_task
                except (asyncio.CancelledError, Exception):
                    pass

    app = FastAPI(
        title="pulsebox",
        description="Lightweight error fingerprinting and cron dead man's switch daemon",
        version="0.1.0",
        lifespan=lifespan,
    )
    app.state.store = app_store
    app.state.watchdog = app_watchdog

    @app.get("/healthz", tags=["Ops"])
    async def healthz() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/metrics", response_class=PlainTextResponse, tags=["Ops"])
    async def metrics() -> Response:
        body = app_watchdog.format_metrics()
        return PlainTextResponse(
            content=body, media_type="text/plain; version=0.0.4; charset=utf-8"
        )

    @app.post(
        "/v1/events",
        status_code=status.HTTP_201_CREATED,
        tags=["Events"],
    )
    async def ingest_event(req: ErrorEventRequest) -> dict[str, Any]:
        snapshot, should_alert = await app_store.ingest_event(req)
        app_watchdog.record_event_ingested()
        if snapshot.status == "REGRESSED":
            app_watchdog.record_issue_regressed()

        if should_alert:
            await app_watchdog.notify_issue(snapshot, req)

        return {"issue": snapshot, "alerted": should_alert}

    @app.get("/v1/issues", response_model=list[IssueGroupSnapshot], tags=["Issues"])
    async def list_issues(
        service: str | None = Query(default=None),
        status: str | None = Query(default=None),
    ) -> list[IssueGroupSnapshot]:
        return await app_store.list_issues(service=service, status=status)

    @app.post(
        "/v1/issues/{fingerprint}/resolve",
        response_model=IssueGroupSnapshot,
        tags=["Issues"],
    )
    async def resolve_issue(fingerprint: str) -> IssueGroupSnapshot:
        try:
            return await app_store.resolve_issue(fingerprint)
        except KeyError as err:
            raise HTTPException(status_code=404, detail=str(err)) from err

    @app.post(
        "/v1/monitors",
        response_model=MonitorSnapshot,
        status_code=status.HTTP_201_CREATED,
        tags=["Monitors"],
    )
    async def register_monitor(req: MonitorRegisterRequest) -> MonitorSnapshot:
        return await app_store.register_monitor(req)

    @app.get("/v1/monitors", response_model=list[MonitorSnapshot], tags=["Monitors"])
    async def list_monitors() -> list[MonitorSnapshot]:
        return await app_store.list_monitors()

    @app.post(
        "/v1/monitors/{slug}/ping",
        response_model=MonitorSnapshot,
        tags=["Monitors"],
    )
    async def record_ping(slug: str) -> MonitorSnapshot:
        try:
            return await app_store.record_ping(slug)
        except KeyError as err:
            raise HTTPException(status_code=404, detail=str(err)) from err

    @app.post("/v1/watchdog/scan", tags=["Watchdog"])
    async def trigger_scan() -> dict[str, list[MonitorSnapshot]]:
        alerted = await app_watchdog.scan_monitors()
        return {"alerted_monitors": alerted}

    return app
