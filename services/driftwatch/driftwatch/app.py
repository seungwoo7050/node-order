"""FastAPI application entrypoint, route handlers, and lifespan manager."""

from __future__ import annotations

import asyncio
import contextlib
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI, HTTPException, Query, Response, status
from pydantic import BaseModel

from driftwatch.models import (
    AlertRecord,
    CheckResult,
    TargetCreateRequest,
    TargetSnapshot,
)
from driftwatch.runner import DriftRunner
from driftwatch.store import DriftStore


class HealthResponse(BaseModel):
    status: str
    targets_count: int


def create_app(
    store: DriftStore | None = None,
    runner: DriftRunner | None = None,
    poll_interval: float = 0.0,
) -> FastAPI:
    """Create and configure FastAPI instance with lifecycle poller."""
    app_store = store or DriftStore()
    app_runner = runner or DriftRunner(store=app_store)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.store = app_store
        app.state.runner = app_runner

        poller_task: asyncio.Task[None] | None = None
        if poll_interval > 0:
            async def _poll_loop() -> None:
                while True:
                    try:
                        await app_runner.check_due_targets()
                    except asyncio.CancelledError:
                        break
                    except Exception:
                        pass
                    await asyncio.sleep(poll_interval)

            poller_task = asyncio.create_task(_poll_loop())

        yield

        if poller_task is not None:
            poller_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await poller_task

    app = FastAPI(
        title="driftwatch",
        version="0.1.0",
        description="Fact drift detector and debounce alert engine",
        lifespan=lifespan,
    )
    app.state.store = app_store
    app.state.runner = app_runner

    @app.post(
        "/v1/targets",
        response_model=TargetSnapshot,
        status_code=status.HTTP_201_CREATED,
    )
    async def create_target(req: TargetCreateRequest) -> TargetSnapshot:
        """Register or update a monitored target."""
        current_store: DriftStore = app.state.store
        return await current_store.upsert_target(req)

    @app.get("/v1/targets", response_model=list[TargetSnapshot])
    async def list_targets() -> list[TargetSnapshot]:
        """List all registered monitored targets."""
        current_store: DriftStore = app.state.store
        return await current_store.list_targets()

    @app.get("/v1/targets/{target_id}", response_model=TargetSnapshot)
    async def get_target(target_id: str) -> TargetSnapshot:
        """Get target status and configuration by id."""
        current_store: DriftStore = app.state.store
        target = await current_store.get_target(target_id)
        if target is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Target '{target_id}' not found",
            )
        return target

    @app.post("/v1/targets/{target_id}/check", response_model=CheckResult)
    async def check_single_target(target_id: str) -> CheckResult:
        """Trigger an on-demand check for a specific target."""
        current_store: DriftStore = app.state.store
        current_runner: DriftRunner = app.state.runner
        target = await current_store.get_target(target_id)
        if target is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Target '{target_id}' not found",
            )
        return await current_runner.check_target(target_id)

    @app.post("/v1/check-all", response_model=list[CheckResult])
    async def check_all_targets() -> list[CheckResult]:
        """Check all targets due for collection concurrently."""
        current_runner: DriftRunner = app.state.runner
        return await current_runner.check_due_targets()

    @app.get("/v1/alerts", response_model=list[AlertRecord])
    async def list_alerts(
        target_id: str | None = Query(default=None),
        limit: int = Query(default=100, ge=1, le=1000),
    ) -> list[AlertRecord]:
        """Query alert history with optional target filtering."""
        current_store: DriftStore = app.state.store
        return await current_store.list_alerts(target_id=target_id, limit=limit)

    @app.get("/healthz", response_model=HealthResponse)
    async def health_check() -> HealthResponse:
        """Liveness probe reporting registered target count."""
        current_store: DriftStore = app.state.store
        targets = await current_store.list_targets()
        return HealthResponse(status="ok", targets_count=len(targets))

    @app.get("/metrics")
    async def prometheus_metrics() -> Response:
        """Expose Prometheus metrics text stream."""
        current_runner: DriftRunner = app.state.runner
        rendered = current_runner.metrics.render_prometheus()
        return Response(content=rendered, media_type="text/plain; version=0.0.4")

    return app
