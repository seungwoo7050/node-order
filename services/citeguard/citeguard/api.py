from __future__ import annotations

from fastapi import FastAPI
from fastapi.responses import PlainTextResponse
from sqlalchemy import func, select

from citeguard.db import DatabaseManager
from citeguard.eval import RAGEvaluator
from citeguard.grounding import GroundingVerifier
from citeguard.indexer import IncrementalSyncEngine
from citeguard.models import DocumentChunk, QueryAuditLog, SyncAuditLog
from citeguard.ollama_client import (
    ChatGeneratorProtocol,
    EmbedderProtocol,
    OllamaChatGenerator,
    OllamaEmbedder,
)
from citeguard.qdrant_store import QdrantVectorStore
from citeguard.retriever import HybridRRFRetriever
from citeguard.schemas import (
    AskRequest,
    AskResponse,
    DocumentSyncRequest,
    DocumentSyncResponse,
    EvalComparisonMetrics,
    EvalRequest,
    SearchRequest,
    SearchResponse,
)
from citeguard.scraper import LiveDocumentScraper


def create_app(
    db_url: str | None = None,
    embedder: EmbedderProtocol | None = None,
    generator: ChatGeneratorProtocol | None = None,
    qdrant: QdrantVectorStore | None = None,
    scraper: LiveDocumentScraper | None = None,
) -> FastAPI:
    db_mgr = DatabaseManager(db_url)
    db_mgr.create_tables()

    resolved_embedder = embedder or OllamaEmbedder()
    resolved_generator = generator or OllamaChatGenerator()
    resolved_qdrant = qdrant or QdrantVectorStore()
    resolved_scraper = scraper or LiveDocumentScraper()

    sync_engine = IncrementalSyncEngine(
        db_manager=db_mgr,
        embedder=resolved_embedder,
        qdrant=resolved_qdrant,
        scraper=resolved_scraper,
    )
    retriever = HybridRRFRetriever(
        db_manager=db_mgr,
        embedder=resolved_embedder,
        qdrant=resolved_qdrant,
    )
    verifier = GroundingVerifier(db_manager=db_mgr)
    evaluator = RAGEvaluator(
        retriever=retriever,
        verifier=verifier,
        generator=resolved_generator,
    )

    app = FastAPI(
        title="CiteGuard Hybrid RAG Service",
        version="0.1.0",
    )

    @app.get("/healthz")
    async def healthz() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/v1/documents/sync", response_model=DocumentSyncResponse)
    async def sync_document(req: DocumentSyncRequest) -> DocumentSyncResponse:
        return await sync_engine.sync_document(req)

    @app.post("/v1/search", response_model=SearchResponse)
    async def search_chunks(req: SearchRequest) -> SearchResponse:
        hits = await retriever.retrieve(
            query=req.query,
            filters=req.filters,
            top_k=req.top_k,
            rrf_k=req.rrf_k,
            mode=req.mode,
        )
        return SearchResponse(query=req.query, mode=req.mode, results=hits)

    @app.post("/v1/ask", response_model=AskResponse)
    async def ask_question(req: AskRequest) -> AskResponse:
        hits = await retriever.retrieve(
            query=req.question,
            filters=req.filters,
            top_k=req.top_k,
            mode="hybrid",
        )
        return await verifier.generate_and_verify(
            question=req.question,
            retrieved_chunks=hits,
            generator=resolved_generator,
        )

    @app.post("/v1/eval", response_model=EvalComparisonMetrics)
    async def run_evaluation(req: EvalRequest) -> EvalComparisonMetrics:
        return await evaluator.evaluate(req)

    @app.get("/metrics", response_class=PlainTextResponse)
    async def prometheus_metrics() -> str:
        with db_mgr.session() as session:
            active_chunks = (
                session.execute(select(func.count(DocumentChunk.id))).scalar_one() or 0
            )
            added_sum = (
                session.execute(
                    select(func.coalesce(func.sum(SyncAuditLog.added_chunks), 0))
                ).scalar_one()
                or 0
            )
            skipped_sum = (
                session.execute(
                    select(func.coalesce(func.sum(SyncAuditLog.skipped_chunks), 0))
                ).scalar_one()
                or 0
            )
            purged_sum = (
                session.execute(
                    select(func.coalesce(func.sum(SyncAuditLog.purged_chunks), 0))
                ).scalar_one()
                or 0
            )
            status_rows = session.execute(
                select(QueryAuditLog.status, func.count(QueryAuditLog.id)).group_by(
                    QueryAuditLog.status
                )
            ).all()

        status_counts = {str(st): int(cnt) for st, cnt in status_rows}
        lines = [
            "# HELP citeguard_active_chunks Total active chunks indexed in ledger and Qdrant",
            "# TYPE citeguard_active_chunks gauge",
            f"citeguard_active_chunks {active_chunks}",
            "# HELP citeguard_sync_chunks_total Cumulative chunk sync operations by action",
            "# TYPE citeguard_sync_chunks_total counter",
            f'citeguard_sync_chunks_total{{action="added"}} {added_sum}',
            f'citeguard_sync_chunks_total{{action="skipped"}} {skipped_sum}',
            f'citeguard_sync_chunks_total{{action="purged"}} {purged_sum}',
            "# HELP citeguard_queries_total Total RAG queries by grounding status",
            "# TYPE citeguard_queries_total counter",
            f'citeguard_queries_total{{status="GROUNDED"}} {status_counts.get("GROUNDED", 0)}',
            f'citeguard_queries_total{{status="FALLBACK_EXTRACTIVE"}} {status_counts.get("FALLBACK_EXTRACTIVE", 0)}',
            f'citeguard_queries_total{{status="ABSTAINED"}} {status_counts.get("ABSTAINED", 0)}',
        ]
        return "\n".join(lines) + "\n"

    return app
