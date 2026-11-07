"""Data models and schemas for driftwatch fact tracking and alert engine."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, field_validator, model_validator
from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    """Base class for all SQLAlchemy ORM models."""


class WatchTargetRow(Base):
    """Monitored endpoint target metadata, extraction rules, and status."""

    __tablename__ = "watch_targets"

    target_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    url: Mapped[str] = mapped_column(String(2048), nullable=False)
    extractor_type: Mapped[str] = mapped_column(String(32), nullable=False)
    selector: Mapped[str] = mapped_column(String(1024), nullable=False)
    expected_type: Mapped[str] = mapped_column(String(16), nullable=False)
    expected_value: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    min_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    max_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    failure_threshold: Mapped[int] = mapped_column(Integer, nullable=False, default=3)
    interval_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=60)
    webhook_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    last_value: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    consecutive_failures: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="HEALTHY")
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )


class CheckSnapshotRow(Base):
    """Historical execution snapshot for target checks."""

    __tablename__ = "check_snapshots"

    snapshot_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    target_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("watch_targets.target_id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    extracted_value: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    error_detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    checked_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )


class DriftAlertRow(Base):
    """Drift alert events triggered upon value shift, rule violation, or consecutive failures."""

    __tablename__ = "drift_alerts"

    alert_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    target_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("watch_targets.target_id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    alert_type: Mapped[str] = mapped_column(String(32), nullable=False)
    previous_value: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    current_value: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    webhook_delivered: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )


class TargetCreateRequest(BaseModel):
    """Request payload to create or update a monitored target."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    target_id: str
    name: str
    url: str
    extractor_type: Literal["json_path", "regex"]
    selector: str
    expected_type: Literal["int", "float", "str"]
    expected_value: str | None = None
    min_value: float | None = None
    max_value: float | None = None
    failure_threshold: int = 3
    interval_seconds: int = 60
    webhook_url: str | None = None

    @field_validator("target_id")
    @classmethod
    def validate_target_id(cls, v: str) -> str:
        trimmed = v.strip()
        if not trimmed:
            raise ValueError("target_id cannot be empty")
        if not re.match(r"^[a-zA-Z0-9_\-]+$", trimmed):
            raise ValueError("target_id must only contain alphanumeric, underscore, or hyphen characters")
        if len(trimmed) > 64:
            raise ValueError("target_id cannot exceed 64 characters")
        return trimmed

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        trimmed = v.strip()
        if not trimmed:
            raise ValueError("name cannot be empty")
        return trimmed

    @field_validator("url")
    @classmethod
    def validate_url(cls, v: str) -> str:
        trimmed = v.strip()
        if not (trimmed.startswith("http://") or trimmed.startswith("https://")):
            raise ValueError("url must start with http:// or https://")
        return trimmed

    @field_validator("webhook_url")
    @classmethod
    def validate_webhook_url(cls, v: str | None) -> str | None:
        if v is None:
            return None
        trimmed = v.strip()
        if not trimmed:
            return None
        if not (trimmed.startswith("http://") or trimmed.startswith("https://")):
            raise ValueError("webhook_url must start with http:// or https://")
        return trimmed

    @field_validator("failure_threshold")
    @classmethod
    def validate_failure_threshold(cls, v: int) -> int:
        if v < 1 or v > 100:
            raise ValueError("failure_threshold must be between 1 and 100")
        return v

    @field_validator("interval_seconds")
    @classmethod
    def validate_interval_seconds(cls, v: int) -> int:
        if v < 1 or v > 86400:
            raise ValueError("interval_seconds must be between 1 and 86400")
        return v

    @model_validator(mode="after")
    def validate_business_rules(self) -> TargetCreateRequest:
        if self.min_value is not None and self.max_value is not None:
            if self.min_value > self.max_value:
                raise ValueError("min_value cannot be greater than max_value")

        if self.extractor_type == "regex":
            try:
                re.compile(self.selector)
            except re.error as e:
                raise ValueError(f"Invalid regex selector pattern: {e}") from e

        if self.expected_value is not None:
            if self.expected_type == "int":
                try:
                    int(self.expected_value)
                except ValueError as e:
                    raise ValueError(f"expected_value '{self.expected_value}' cannot be parsed as int") from e
            elif self.expected_type == "float":
                try:
                    float(self.expected_value)
                except ValueError as e:
                    raise ValueError(f"expected_value '{self.expected_value}' cannot be parsed as float") from e

        return self


class TargetSnapshot(BaseModel):
    """Snapshot response model representing current target state."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    target_id: str
    name: str
    url: str
    extractor_type: str
    selector: str
    expected_type: str
    expected_value: str | None
    min_value: float | None
    max_value: float | None
    failure_threshold: int
    interval_seconds: int
    webhook_url: str | None
    last_value: str | None
    consecutive_failures: int
    status: str
    last_checked_at: datetime | None
    created_at: datetime


class CheckResult(BaseModel):
    """Result of a single check run against a target."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    target_id: str
    status: str
    extracted_value: str | None = None
    drift_detected: bool = False
    alert_created: bool = False
    alert_type: str | None = None
    error_detail: str | None = None
    checked_at: datetime


class AlertRecord(BaseModel):
    """Drift or failure alert record for API responses."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    alert_id: int
    target_id: str
    alert_type: str
    previous_value: str | None
    current_value: str | None
    message: str
    webhook_delivered: bool
    created_at: datetime
