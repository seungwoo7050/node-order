from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import DateTime, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class IngestJobRow(Base):
    __tablename__ = "ingest_jobs"

    job_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    dataset: Mapped[str] = mapped_column(String(128), index=True, nullable=False)
    format_type: Mapped[str] = mapped_column(String(16), nullable=False)  # csv | jsonl
    total_rows: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    inserted_rows: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    updated_rows: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    skipped_rows: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    quarantined_rows: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    status: Mapped[str] = mapped_column(
        String(32), default="COMPLETED", nullable=False
    )  # COMPLETED | PARTIAL_QUARANTINE
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )


class IngestedRecordRow(Base):
    __tablename__ = "ingested_records"
    __table_args__ = (
        UniqueConstraint("dataset", "record_key", name="uq_dataset_record_key"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    dataset: Mapped[str] = mapped_column(String(128), index=True, nullable=False)
    record_key: Mapped[str] = mapped_column(String(256), index=True, nullable=False)
    payload_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    payload_json: Mapped[str] = mapped_column(Text, nullable=False)
    source_job_id: Mapped[str] = mapped_column(String(64), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )


class QuarantineRow(Base):
    __tablename__ = "quarantine_rows"

    quarantine_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    job_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    dataset: Mapped[str] = mapped_column(String(128), index=True, nullable=False)
    row_number: Mapped[int] = mapped_column(Integer, nullable=False)
    raw_payload_json: Mapped[str] = mapped_column(Text, nullable=False)
    error_details_json: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(
        String(32), default="PENDING", nullable=False
    )  # PENDING | REPLAYED
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    replayed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, default=None
    )


class ColumnRule(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    type: Literal["int", "float", "str", "bool"]
    required: bool = True
    ge: float | None = None
    le: float | None = None
    min_length: int | None = None
    max_length: int | None = None


class SchemaSpec(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    key_field: str
    fields: dict[str, ColumnRule]

    @field_validator("fields")
    @classmethod
    def validate_fields_non_empty(cls, v: dict[str, ColumnRule]) -> dict[str, ColumnRule]:
        if not v:
            raise ValueError("SchemaSpec fields must not be empty")
        return v

    @model_validator(mode="after")
    def validate_key_field_exists(self) -> SchemaSpec:
        if self.key_field not in self.fields:
            raise ValueError(f"key_field '{self.key_field}' must be defined in fields")
        rule = self.fields[self.key_field]
        if not rule.required:
            raise ValueError(f"key_field '{self.key_field}' must be marked as required")
        return self


class IngestRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    dataset: str
    format_type: Literal["csv", "jsonl"]
    schema_spec: SchemaSpec
    content: str
    chunk_size: int = Field(default=200, ge=1, le=10000)


class JobSummary(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    job_id: str
    dataset: str
    format_type: str
    total_rows: int
    inserted_rows: int
    updated_rows: int
    skipped_rows: int
    quarantined_rows: int
    status: str
    created_at: str


class QuarantineItem(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    quarantine_id: str
    job_id: str
    dataset: str
    row_number: int
    raw_payload: dict[str, Any]
    error_details: list[dict[str, Any]]
    status: str
    created_at: str
    replayed_at: str | None = None


class ReplayRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    patched_payload: dict[str, Any]
    schema_spec: SchemaSpec
