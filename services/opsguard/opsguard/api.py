from __future__ import annotations

import os
from contextlib import asynccontextmanager
from typing import Any, AsyncGenerator

import aiosqlite
from fastapi import Depends, FastAPI, Response, status
from prometheus_client import REGISTRY, Counter, generate_latest
from pydantic import BaseModel, Field
from sqlalchemy import create_engine

from opsguard.k8s_guard import evaluate_k8s_manifests
from opsguard.migration_guard import evaluate_sql_migration, verify_backup_restore_drill
from opsguard.models import AuditRecord, Base, PolicyReport
from opsguard.terraform_guard import detect_terraform_drift, evaluate_terraform_plan


def _get_or_create_counter(name: str, documentation: str, labelnames: list[str]) -> Counter:
    existing = REGISTRY._names_to_collectors.get(name)
    if isinstance(existing, Counter):
        return existing
    return Counter(name, documentation, labelnames)


OPSGUARD_CHECKS: Counter = _get_or_create_counter(
    "opsguard_checks_total",
    "Total policy verification checks performed",
    ["target_type", "status"],
)

OPSGUARD_VIOLATIONS: Counter = _get_or_create_counter(
    "opsguard_violations_total",
    "Total policy violations discovered",
    ["rule_id", "severity"],
)


def get_db_path() -> str:
    return os.getenv("OPSGUARD_DB_PATH", "opsguard.db")


class AuditSession:
    """Async database session managing AuditRecord persistence via aiosqlite."""

    def __init__(self, conn: aiosqlite.Connection) -> None:
        self.conn = conn
        self._pending: list[AuditRecord] = []

    def add(self, record: AuditRecord) -> None:
        self._pending.append(record)

    async def commit(self) -> None:
        for rec in self._pending:
            await self.conn.execute(
                """
                INSERT INTO audit_records (
                    target_type, passed, error_count, warning_count, violations_json, drifts_json, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    rec.target_type,
                    rec.passed,
                    rec.error_count,
                    rec.warning_count,
                    rec.violations_json,
                    rec.drifts_json,
                    rec.created_at.isoformat(),
                ),
            )
        await self.conn.commit()
        self._pending.clear()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    db_path = get_db_path()
    sync_engine = create_engine(f"sqlite:///{db_path}")
    Base.metadata.create_all(sync_engine)
    sync_engine.dispose()
    yield


app = FastAPI(
    title="OpsGuard API",
    description="Declarative infrastructure policy & database migration verification gate",
    version="0.1.0",
    lifespan=lifespan,
)


async def get_db() -> AsyncGenerator[AuditSession, None]:
    db_path = get_db_path()
    async with aiosqlite.connect(db_path) as conn:
        yield AuditSession(conn)


async def persist_and_record_metrics(
    report: PolicyReport,
    session: AuditSession,
) -> None:
    audit = AuditRecord.from_report(report)
    session.add(audit)
    await session.commit()

    check_status = "passed" if report.passed else "failed"
    OPSGUARD_CHECKS.labels(target_type=report.target_type, status=check_status).inc()

    for v in report.violations:
        OPSGUARD_VIOLATIONS.labels(rule_id=v.rule_id, severity=v.severity.value).inc()


# Request Schemas
class TerraformVerifyRequest(BaseModel):
    plan: dict[str, Any] | None = None
    desired: dict[str, dict[str, Any]] | None = None
    actual: dict[str, dict[str, Any]] | None = None
    allowed_instance_types: list[str] | None = None


class K8sVerifyRequest(BaseModel):
    manifest_yaml: str


class MigrationVerifyRequest(BaseModel):
    sql_text: str
    allow_contract: bool = False


class RestoreVerifyRequest(BaseModel):
    dump_sql: str
    expected_sha256: str
    required_tables: list[str] = Field(default_factory=list)


# Endpoints
@app.get("/healthz", status_code=status.HTTP_200_OK)
async def healthz() -> dict[str, str]:
    return {"status": "ok", "service": "opsguard"}


@app.get("/metrics")
async def metrics() -> Response:
    return Response(
        content=generate_latest(),
        media_type="text/plain; version=0.0.4; charset=utf-8",
    )


@app.post("/v1/verify/terraform", response_model=PolicyReport)
async def verify_terraform(
    req: TerraformVerifyRequest,
    session: AuditSession = Depends(get_db),
) -> PolicyReport:
    if req.desired is not None and req.actual is not None:
        report = detect_terraform_drift(req.desired, req.actual)
    elif req.plan is not None:
        allowed = (
            set(req.allowed_instance_types)
            if req.allowed_instance_types is not None
            else None
        )
        report = evaluate_terraform_plan(req.plan, allowed_instance_types=allowed)
    else:
        report = evaluate_terraform_plan({})

    await persist_and_record_metrics(report, session)
    return report


@app.post("/v1/verify/k8s", response_model=PolicyReport)
async def verify_k8s(
    req: K8sVerifyRequest,
    session: AuditSession = Depends(get_db),
) -> PolicyReport:
    report = evaluate_k8s_manifests(req.manifest_yaml)
    await persist_and_record_metrics(report, session)
    return report


@app.post("/v1/verify/migration", response_model=PolicyReport)
async def verify_migration(
    req: MigrationVerifyRequest,
    session: AuditSession = Depends(get_db),
) -> PolicyReport:
    report = evaluate_sql_migration(req.sql_text, allow_contract=req.allow_contract)
    await persist_and_record_metrics(report, session)
    return report


@app.post("/v1/verify/restore", response_model=PolicyReport)
async def verify_restore(
    req: RestoreVerifyRequest,
    session: AuditSession = Depends(get_db),
) -> PolicyReport:
    report = verify_backup_restore_drill(
        dump_sql=req.dump_sql,
        expected_sha256=req.expected_sha256,
        required_tables=req.required_tables,
    )
    await persist_and_record_metrics(report, session)
    return report
