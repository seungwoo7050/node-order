from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from citeguard.db import Base


def utc_now() -> datetime:
    return datetime.now(UTC)


class DocumentSource(Base):
    __tablename__ = "document_sources"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    doc_key: Mapped[str] = mapped_column(String(128), unique=True, nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    source_url: Mapped[str] = mapped_column(String(1024), nullable=False)
    category: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    language: Mapped[str] = mapped_column(String(16), nullable=False, default="ko", index=True)
    source_grade: Mapped[str] = mapped_column(String(8), nullable=False, default="A")
    effective_date: Mapped[str] = mapped_column(String(32), nullable=False, default="2026-01-01")
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now
    )

    chunks: Mapped[list[DocumentChunk]] = relationship(
        "DocumentChunk", back_populates="document", cascade="all, delete-orphan"
    )


class DocumentChunk(Base):
    __tablename__ = "document_chunks"
    __table_args__ = (
        UniqueConstraint("document_id", "chunk_hash", name="uq_doc_chunk_hash"),
        Index("ix_chunk_category_lang", "category", "language"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    chunk_uid: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    qdrant_point_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    document_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("document_sources.id", ondelete="CASCADE"), nullable=False, index=True
    )
    doc_key: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    breadcrumb: Mapped[str] = mapped_column(String(512), nullable=False)
    clause_code: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    raw_content: Mapped[str] = mapped_column(Text, nullable=False)
    indexed_text: Mapped[str] = mapped_column(Text, nullable=False)
    chunk_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    category: Mapped[str] = mapped_column(String(64), nullable=False)
    language: Mapped[str] = mapped_column(String(16), nullable=False, default="ko")
    source_grade: Mapped[str] = mapped_column(String(8), nullable=False, default="A")
    effective_date: Mapped[str] = mapped_column(String(32), nullable=False, default="2026-01-01")
    source_url: Mapped[str] = mapped_column(String(1024), nullable=False)
    tokens_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    vector_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )

    document: Mapped[DocumentSource] = relationship("DocumentSource", back_populates="chunks")


class SyncAuditLog(Base):
    __tablename__ = "sync_audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    doc_key: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    added_chunks: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    skipped_chunks: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    purged_chunks: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    embed_calls: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )


class QueryAuditLog(Base):
    __tablename__ = "query_audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    question: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    grounding_violation: Mapped[str | None] = mapped_column(String(64), nullable=True)
    top_chunk_uid: Mapped[str | None] = mapped_column(String(64), nullable=True)
    rrf_top_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )
