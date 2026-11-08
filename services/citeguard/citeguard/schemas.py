from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

SourceGrade = Literal["A", "B", "C"]
GroundingStatus = Literal[
    "GROUNDED",
    "FALLBACK_EXTRACTIVE",
    "ABSTAINED",
]
ViolationType = Literal[
    "NONE",
    "EMPTY_CITATIONS",
    "UNKNOWN_CHUNK_ID",
    "UNVERIFIED_QUOTE_SPAN",
    "NUMERIC_HALLUCINATION",
    "INSUFFICIENT_CONTEXT",
]


class DocumentSyncRequest(BaseModel):
    doc_key: str = Field(..., min_length=2, max_length=128)
    title: str = Field(..., min_length=2, max_length=255)
    source_url: str = Field(default="https://official.example.org/policy")
    category: str = Field(default="commerce_policy", min_length=2, max_length=64)
    language: str = Field(default="ko", min_length=2, max_length=16)
    source_grade: SourceGrade = "A"
    effective_date: str = Field(default="2026-01-01")
    content: str | None = Field(
        default=None,
        description="Raw Markdown or HTML content. If omitted, fetched live from source_url.",
    )
    max_chunk_chars: int = Field(default=480, ge=120, le=2000)


class DocumentSyncResponse(BaseModel):
    doc_key: str
    version: int
    total_chunks: int
    added_chunks: int
    skipped_chunks: int
    purged_chunks: int
    embed_api_calls: int
    qdrant_upserted: int
    qdrant_deleted: int


class MetadataFilter(BaseModel):
    category: str | None = None
    language: str | None = None
    doc_key: str | None = None
    min_source_grade: SourceGrade | None = None
    effective_after: str | None = None


class SearchRequest(BaseModel):
    query: str = Field(..., min_length=2)
    top_k: int = Field(default=4, ge=1, le=20)
    rrf_k: int = Field(default=60, ge=1, le=200)
    mode: Literal["hybrid", "dense_only", "bm25_only"] = "hybrid"
    filters: MetadataFilter = Field(default_factory=MetadataFilter)


class RetrievedChunkItem(BaseModel):
    chunk_uid: str
    doc_key: str
    breadcrumb: str
    clause_code: str | None = None
    raw_content: str
    source_url: str
    source_grade: SourceGrade
    effective_date: str
    dense_rank: int | None = None
    dense_score: float = 0.0
    bm25_rank: int | None = None
    bm25_score: float = 0.0
    rrf_score: float = 0.0


class SearchResponse(BaseModel):
    query: str
    mode: str
    results: list[RetrievedChunkItem]


class CitationItem(BaseModel):
    chunk_uid: str
    breadcrumb: str
    quote: str
    source_url: str
    source_grade: SourceGrade
    effective_date: str


class LLMRawCitation(BaseModel):
    chunk_uid: str
    quote: str


class LLMRawOutput(BaseModel):
    answer: str
    abstained: bool = False
    citations: list[LLMRawCitation] = Field(default_factory=list)


class AskRequest(BaseModel):
    question: str = Field(..., min_length=2)
    top_k: int = Field(default=4, ge=1, le=12)
    filters: MetadataFilter = Field(default_factory=MetadataFilter)


class AskResponse(BaseModel):
    question: str
    answer: str
    status: GroundingStatus
    violation: ViolationType
    violation_detail: str | None = None
    citations: list[CitationItem]
    retrieved_chunks: list[RetrievedChunkItem]
    model_used: str


class EvalCase(BaseModel):
    question: str
    expected_doc_key: str
    expected_clause_or_keyword: str
    expected_numbers: list[str] = Field(default_factory=list)
    filters: MetadataFilter = Field(default_factory=MetadataFilter)


class EvalRequest(BaseModel):
    cases: list[EvalCase]
    top_k: int = Field(default=3, ge=1, le=10)


class EvalComparisonMetrics(BaseModel):
    total_cases: int
    hybrid_recall_at_k: float
    dense_only_recall_at_k: float
    bm25_only_recall_at_k: float
    hybrid_mrr: float
    dense_only_mrr: float
    bm25_only_mrr: float
    grounding_pass_rate: float
