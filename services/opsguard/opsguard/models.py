from __future__ import annotations

import json
from datetime import datetime, timezone
from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import Boolean, DateTime, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Severity(str, Enum):
    ERROR = "ERROR"
    WARNING = "WARNING"


class Violation(BaseModel):
    model_config = ConfigDict(frozen=True)

    rule_id: str
    severity: Severity
    resource: str
    message: str
    remediation: str


class DriftItem(BaseModel):
    model_config = ConfigDict(frozen=True)

    resource_address: str
    attribute: str
    expected: Any
    actual: Any


class PolicyReport(BaseModel):
    model_config = ConfigDict(extra="ignore")

    target_type: str
    passed: bool
    error_count: int
    warning_count: int
    violations: list[Violation] = Field(default_factory=list)
    drifts: list[DriftItem] = Field(default_factory=list)
    checked_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @classmethod
    def create(
        cls,
        target_type: str,
        violations: list[Violation],
        drifts: list[DriftItem] | None = None,
        **extra: Any,
    ) -> PolicyReport:
        drifts = drifts or []
        error_count = sum(1 for v in violations if v.severity == Severity.ERROR)
        warning_count = sum(1 for v in violations if v.severity == Severity.WARNING)
        passed = error_count == 0
        return cls(
            target_type=target_type,
            passed=passed,
            error_count=error_count,
            warning_count=warning_count,
            violations=violations,
            drifts=drifts,
            **extra,
        )


class MigrationReport(PolicyReport):
    sql_statements_count: int = 0
    contract_allowed: bool = False


class RestoreDrillReport(PolicyReport):
    expected_sha256: str = ""
    actual_sha256: str = ""
    tables_checked: list[str] = Field(default_factory=list)
    row_counts: dict[str, int] = Field(default_factory=dict)


class Base(DeclarativeBase):
    pass


class AuditRecord(Base):
    __tablename__ = "audit_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    target_type: Mapped[str] = mapped_column(String(64), nullable=False)
    passed: Mapped[bool] = mapped_column(Boolean, nullable=False)
    error_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    warning_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    violations_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    drifts_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    @classmethod
    def from_report(cls, report: PolicyReport) -> AuditRecord:
        violations_data = [v.model_dump(mode="json") for v in report.violations]
        drifts_data = [d.model_dump(mode="json") for d in report.drifts]
        return cls(
            target_type=report.target_type,
            passed=report.passed,
            error_count=report.error_count,
            warning_count=report.warning_count,
            violations_json=json.dumps(violations_data, ensure_ascii=False),
            drifts_json=json.dumps(drifts_data, ensure_ascii=False),
            created_at=report.checked_at,
        )
