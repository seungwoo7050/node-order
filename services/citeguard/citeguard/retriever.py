from __future__ import annotations

import json
import math
from collections import Counter
from typing import Literal, cast

from sqlalchemy import select

from citeguard.chunker import tokenize_for_bm25
from citeguard.db import DatabaseManager
from citeguard.models import DocumentChunk
from citeguard.ollama_client import EmbedderProtocol
from citeguard.qdrant_store import GRADE_ALLOWED_MAP, QdrantVectorStore
from citeguard.schemas import MetadataFilter, RetrievedChunkItem, SourceGrade


class HybridRRFRetriever:
    """Combines Qdrant Cosine Dense Retrieval and Okapi BM25 Lexical Retrieval via Reciprocal Rank Fusion."""

    def __init__(
        self,
        db_manager: DatabaseManager,
        embedder: EmbedderProtocol,
        qdrant: QdrantVectorStore,
        k1: float = 1.5,
        b: float = 0.75,
    ) -> None:
        self.db_manager = db_manager
        self.embedder = embedder
        self.qdrant = qdrant
        self.k1 = k1
        self.b = b

    async def retrieve(
        self,
        query: str,
        filters: MetadataFilter,
        top_k: int = 4,
        rrf_k: int = 60,
        mode: Literal["hybrid", "dense_only", "bm25_only"] = "hybrid",
    ) -> list[RetrievedChunkItem]:
        candidates = self._load_filtered_chunks(filters)
        if not candidates:
            return []

        candidate_by_uid = {c.chunk_uid: c for c in candidates}
        candidate_pool_size = max(top_k * 4, 16)

        dense_ranks: dict[str, tuple[int, float]] = {}
        if mode in {"hybrid", "dense_only"}:
            q_vecs = await self.embedder.embed_batch([query])
            if q_vecs:
                qdrant_hits = await self.qdrant.query_similar(
                    query_vector=q_vecs[0],
                    filters=filters,
                    limit=candidate_pool_size,
                )
                rank_idx = 1
                for hit in qdrant_hits:
                    if hit.chunk_uid in candidate_by_uid:
                        dense_ranks[hit.chunk_uid] = (rank_idx, hit.score)
                        rank_idx += 1

        bm25_ranks: dict[str, tuple[int, float]] = {}
        if mode in {"hybrid", "bm25_only"}:
            bm25_scored = self._score_bm25(query, candidates)
            for rank_idx, (uid, score) in enumerate(bm25_scored[:candidate_pool_size], start=1):
                if score > 0.0:
                    bm25_ranks[uid] = (rank_idx, score)

        scored_items: list[RetrievedChunkItem] = []
        all_uids = set(dense_ranks.keys()) | set(bm25_ranks.keys())

        for uid in all_uids:
            ch = candidate_by_uid[uid]
            d_entry = dense_ranks.get(uid)
            b_entry = bm25_ranks.get(uid)

            d_rank = d_entry[0] if d_entry else None
            d_score = d_entry[1] if d_entry else 0.0
            b_rank = b_entry[0] if b_entry else None
            b_score = b_entry[1] if b_entry else 0.0

            if mode == "dense_only":
                if d_rank is None:
                    continue
                rrf_score = 1.0 / (rrf_k + d_rank)
            elif mode == "bm25_only":
                if b_rank is None:
                    continue
                rrf_score = 1.0 / (rrf_k + b_rank)
            else:
                rrf_score = 0.0
                if d_rank is not None:
                    rrf_score += 1.0 / (rrf_k + d_rank)
                if b_rank is not None:
                    rrf_score += 1.0 / (rrf_k + b_rank)

            scored_items.append(
                RetrievedChunkItem(
                    chunk_uid=ch.chunk_uid,
                    doc_key=ch.doc_key,
                    breadcrumb=ch.breadcrumb,
                    clause_code=ch.clause_code,
                    raw_content=ch.raw_content,
                    source_url=ch.source_url,
                    source_grade=cast(SourceGrade, ch.source_grade),
                    effective_date=ch.effective_date,
                    dense_rank=d_rank,
                    dense_score=round(d_score, 6),
                    bm25_rank=b_rank,
                    bm25_score=round(b_score, 6),
                    rrf_score=round(rrf_score, 6),
                )
            )

        scored_items.sort(
            key=lambda item: (item.rrf_score, item.bm25_score, item.dense_score),
            reverse=True,
        )
        return scored_items[:top_k]

    def _load_filtered_chunks(self, filters: MetadataFilter) -> list[DocumentChunk]:
        with self.db_manager.session() as session:
            stmt = select(DocumentChunk)
            if filters.category:
                stmt = stmt.where(DocumentChunk.category == filters.category)
            if filters.language:
                stmt = stmt.where(DocumentChunk.language == filters.language)
            if filters.doc_key:
                stmt = stmt.where(DocumentChunk.doc_key == filters.doc_key)
            if filters.min_source_grade:
                allowed = GRADE_ALLOWED_MAP.get(filters.min_source_grade, ["A", "B", "C"])
                stmt = stmt.where(DocumentChunk.source_grade.in_(allowed))
            if filters.effective_after:
                stmt = stmt.where(DocumentChunk.effective_date >= filters.effective_after)
            return list(session.execute(stmt).scalars())

    def _score_bm25(
        self, query: str, chunks: list[DocumentChunk]
    ) -> list[tuple[str, float]]:
        query_tokens = tokenize_for_bm25(query)
        if not query_tokens or not chunks:
            return []

        doc_tokens_list: list[list[str]] = []
        df_counter: Counter[str] = Counter()

        for ch in chunks:
            try:
                toks = [str(x) for x in json.loads(ch.tokens_json)]
            except Exception:
                toks = tokenize_for_bm25(ch.indexed_text)
            doc_tokens_list.append(toks)
            for unique_tok in set(toks):
                df_counter[unique_tok] += 1

        n_docs = len(chunks)
        avgdl = sum(len(t) for t in doc_tokens_list) / max(n_docs, 1)
        if avgdl == 0.0:
            avgdl = 1.0

        results: list[tuple[str, float]] = []
        for ch, doc_toks in zip(chunks, doc_tokens_list, strict=True):
            tf_map = Counter(doc_toks)
            dl = len(doc_toks)
            score = 0.0
            for q_tok in query_tokens:
                tf = tf_map.get(q_tok, 0)
                if tf == 0:
                    continue
                df = df_counter.get(q_tok, 0)
                idf = math.log(1.0 + (n_docs - df + 0.5) / (df + 0.5))
                denom = tf + self.k1 * (1.0 - self.b + self.b * (dl / avgdl))
                score += idf * ((tf * (self.k1 + 1.0)) / denom)
            results.append((ch.chunk_uid, score))

        results.sort(key=lambda item: item[1], reverse=True)
        return results
