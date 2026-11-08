from __future__ import annotations

import json

import httpx

from citeguard.db import DatabaseManager
from citeguard.indexer import IncrementalSyncEngine
from citeguard.ollama_client import OllamaEmbedder
from citeguard.qdrant_store import InMemoryQdrantTransport, QdrantVectorStore
from citeguard.schemas import DocumentSyncRequest, MetadataFilter


def make_mock_ollama_embed_transport(embedded_texts_log: list[list[str]]) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content.decode("utf-8"))
        inputs: list[str] = body["input"]
        embedded_texts_log.append(inputs)
        vecs: list[list[float]] = []
        for text in inputs:
            # Deterministic 4-dim semantic test vector based on keywords
            v = [
                1.0 if "7일" in text or "청약철회" in text else 0.1,
                1.0 if "3영업일" in text or "환급" in text else 0.1,
                1.0 if "배송비" in text or "반품" in text else 0.1,
                1.0 if "14일" in text else 0.1,
            ]
            vecs.append(v)
        return httpx.Response(200, json={"embeddings": vecs})

    return httpx.MockTransport(handler)


async def test_incremental_sync_skips_unchanged_and_purges_stale_qdrant_points() -> None:
    db_mgr = DatabaseManager("sqlite:///:memory:")
    db_mgr.create_tables()

    embedded_batches: list[list[str]] = []
    embedder = OllamaEmbedder(
        dimension=4,
        transport=make_mock_ollama_embed_transport(embedded_batches),
    )
    qdrant_transport = InMemoryQdrantTransport()
    qdrant = QdrantVectorStore(transport=qdrant_transport)
    engine = IncrementalSyncEngine(db_manager=db_mgr, embedder=embedder, qdrant=qdrant)

    doc_v1 = """
# 전자상거래 표준약관

## 제17조 (청약철회 기간)
상품을 공급받은 날부터 7일 이내에 청약철회를 할 수 있습니다.

## 제18조 (대금 환급 기한)
반환받은 날부터 3영업일 이내에 결제 대금을 환급합니다.

## 제19조 (프로모션 특례)
한시적 무료 반품 쿠폰을 지급합니다.
"""
    res1 = await engine.sync_document(
        DocumentSyncRequest(
            doc_key="shop-policy",
            title="전자상거래 표준약관",
            category="commerce_policy",
            language="ko",
            source_grade="A",
            content=doc_v1,
        )
    )
    assert res1.version == 1
    assert res1.total_chunks == 3
    assert res1.added_chunks == 3
    assert res1.skipped_chunks == 0
    assert res1.purged_chunks == 0
    assert res1.embed_api_calls == 1
    assert len(embedded_batches) == 1
    assert len(embedded_batches[0]) == 3
    assert len(qdrant_transport.points["citeguard_chunks"]) == 3

    # 2. Re-sync identical document -> 0 embedding calls, 3 skipped
    res2 = await engine.sync_document(
        DocumentSyncRequest(
            doc_key="shop-policy",
            title="전자상거래 표준약관",
            category="commerce_policy",
            language="ko",
            source_grade="A",
            content=doc_v1,
        )
    )
    assert res2.version == 1
    assert res2.added_chunks == 0
    assert res2.skipped_chunks == 3
    assert res2.purged_chunks == 0
    assert res2.embed_api_calls == 0
    assert len(embedded_batches) == 1

    # 3. Modify 제17조 (7일 -> 14일), keep 제18조 unchanged, delete 제19조
    doc_v2 = """
# 전자상거래 표준약관

## 제17조 (청약철회 기간)
특약에 따라 상품을 공급받은 날부터 14일 이내에 청약철회를 할 수 있습니다.

## 제18조 (대금 환급 기한)
반환받은 날부터 3영업일 이내에 결제 대금을 환급합니다.
"""
    res3 = await engine.sync_document(
        DocumentSyncRequest(
            doc_key="shop-policy",
            title="전자상거래 표준약관",
            category="commerce_policy",
            language="ko",
            source_grade="A",
            content=doc_v2,
        )
    )
    assert res3.version == 2
    assert res3.total_chunks == 2
    assert res3.added_chunks == 1  # Only modified 제17조 was re-embedded
    assert res3.skipped_chunks == 1  # 제18조 was skipped without re-embedding
    assert res3.purged_chunks == 2  # Old 제17조 + deleted 제19조 purged
    assert len(embedded_batches) == 2
    assert len(embedded_batches[1]) == 1
    assert "14일 이내" in embedded_batches[1][0]

    # Verify Qdrant storage has exactly 2 active points and none contain stale "7일" or "무료 반품 쿠폰"
    active_points = list(qdrant_transport.points["citeguard_chunks"].values())
    assert len(active_points) == 2
    raw_texts = " ".join(str(p.payload["raw_content"]) for p in active_points)
    assert "14일 이내" in raw_texts
    assert "3영업일 이내" in raw_texts
    assert "7일 이내" not in raw_texts
    assert "무료 반품 쿠폰" not in raw_texts

    # Verify Qdrant metadata pre-filtering
    hits_matching = await qdrant.query_similar(
        query_vector=[0.1, 0.1, 0.1, 1.0],
        filters=MetadataFilter(category="commerce_policy", min_source_grade="A"),
        limit=5,
    )
    assert len(hits_matching) == 2

    hits_wrong_cat = await qdrant.query_similar(
        query_vector=[0.1, 0.1, 0.1, 1.0],
        filters=MetadataFilter(category="transit_policy"),
        limit=5,
    )
    assert len(hits_wrong_cat) == 0
