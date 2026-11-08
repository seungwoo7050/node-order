from __future__ import annotations

import json

import httpx

from citeguard.db import DatabaseManager
from citeguard.indexer import IncrementalSyncEngine
from citeguard.ollama_client import OllamaEmbedder
from citeguard.qdrant_store import InMemoryQdrantTransport, QdrantVectorStore
from citeguard.retriever import HybridRRFRetriever
from citeguard.schemas import DocumentSyncRequest, MetadataFilter


def make_semantic_embed_transport() -> httpx.MockTransport:
    """Simulates neural embeddings where refund clauses cluster together semantically,
    making exact clause number (제18조의2) indistinguishable by dense vector alone."""

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content.decode("utf-8"))
        inputs: list[str] = body["input"]
        vecs: list[list[float]] = []
        for text in inputs:
            if "마음이 바뀌어" in text or "제17조" in text:
                # Query or clause about general withdrawal
                vecs.append([0.95, 0.20, 0.10, 0.05])
            elif "제18조의2" in text and "지연이자" in text:
                # Specific sub-clause has slightly lower dense score for a generic query
                vecs.append([0.70, 0.65, 0.10, 0.05])
            elif "제18조의2" in text:
                # Query asking specifically for "제18조의2 지연배상금" — dense model confuses it with 제17조
                vecs.append([0.92, 0.25, 0.10, 0.05])
            else:
                vecs.append([0.10, 0.15, 0.90, 0.20])
        return httpx.Response(200, json={"embeddings": vecs})

    return httpx.MockTransport(handler)


async def test_hybrid_rrf_outperforms_dense_only_on_exact_clause_and_bm25_on_paraphrase() -> None:
    db_mgr = DatabaseManager("sqlite:///:memory:")
    db_mgr.create_tables()

    embedder = OllamaEmbedder(dimension=4, transport=make_semantic_embed_transport())
    qdrant = QdrantVectorStore(transport=InMemoryQdrantTransport())
    sync_engine = IncrementalSyncEngine(db_manager=db_mgr, embedder=embedder, qdrant=qdrant)
    retriever = HybridRRFRetriever(db_manager=db_mgr, embedder=embedder, qdrant=qdrant)

    policy_md = """
# 전자상거래 표준약관

## 제17조 (청약철회 기간)
소비자는 재화등을 공급받은 날부터 7일 이내에 청약철회를 할 수 있습니다.

## 제18조의2 (대금환급 지연이자 및 배상금)
몰이 대금 환급을 지연한 때에는 연 15%의 지연배상금을 지급해야 합니다. 코드: FTC-DELAY-15

## 제24조 (면책 조항)
천재지변으로 인한 배송 지연에 대하여는 책임을 지지 않습니다.
"""
    await sync_engine.sync_document(
        DocumentSyncRequest(
            doc_key="ftc-terms",
            title="전자상거래 표준약관",
            category="commerce_policy",
            content=policy_md,
        )
    )

    # Case 1: Exact clause & code query ("제18조의2 FTC-DELAY-15 기준")
    # Dense-only mistakenly ranks 제17조 #1 due to vector proximity
    dense_hits = await retriever.retrieve(
        query="제18조의2 FTC-DELAY-15 기준",
        filters=MetadataFilter(category="commerce_policy"),
        top_k=3,
        mode="dense_only",
    )
    assert dense_hits[0].clause_code == "제17조"

    # Hybrid RRF fuses BM25 rank #1 + Dense rank #2 to promote 제18조의2 to #1
    hybrid_hits = await retriever.retrieve(
        query="제18조의2 FTC-DELAY-15 기준",
        filters=MetadataFilter(category="commerce_policy"),
        top_k=3,
        mode="hybrid",
        rrf_k=1,
    )
    assert hybrid_hits[0].clause_code == "제18조의2"
    assert hybrid_hits[0].bm25_rank == 1
    assert hybrid_hits[0].dense_rank == 2

    # Case 2: Semantic paraphrase with 0 lexical overlap ("마음이 바뀌어 물건을 물리고 싶을 때")
    bm25_paraphrase = await retriever.retrieve(
        query="마음이 바뀌어 물건을 물리고 싶을 때",
        filters=MetadataFilter(category="commerce_policy"),
        top_k=3,
        mode="bm25_only",
    )
    assert len(bm25_paraphrase) == 0

    hybrid_paraphrase = await retriever.retrieve(
        query="마음이 바뀌어 물건을 물리고 싶을 때",
        filters=MetadataFilter(category="commerce_policy"),
        top_k=3,
        mode="hybrid",
    )
    assert len(hybrid_paraphrase) == 3
    assert hybrid_paraphrase[0].clause_code == "제17조"
