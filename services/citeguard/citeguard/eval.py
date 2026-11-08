from __future__ import annotations

from typing import Literal

from citeguard.grounding import GroundingVerifier, extract_normalized_numbers
from citeguard.ollama_client import ChatGeneratorProtocol
from citeguard.retriever import HybridRRFRetriever
from citeguard.schemas import EvalCase, EvalComparisonMetrics, EvalRequest, RetrievedChunkItem


def _find_matching_rank(
    case: EvalCase, hits: list[RetrievedChunkItem]
) -> int | None:
    target_kw = case.expected_clause_or_keyword.lower()
    for rank, hit in enumerate(hits, start=1):
        if hit.doc_key != case.expected_doc_key:
            continue
        haystack = f"{hit.breadcrumb} {hit.clause_code or ''} {hit.raw_content}".lower()
        if target_kw in haystack:
            return rank
    return None


class RAGEvaluator:
    """Computes Recall@K, MRR across retrieval modes (Hybrid RRF vs Dense vs BM25), and Grounding Pass Rate."""

    def __init__(
        self,
        retriever: HybridRRFRetriever,
        verifier: GroundingVerifier,
        generator: ChatGeneratorProtocol,
    ) -> None:
        self.retriever = retriever
        self.verifier = verifier
        self.generator = generator

    async def evaluate(self, req: EvalRequest) -> EvalComparisonMetrics:
        if not req.cases:
            return EvalComparisonMetrics(
                total_cases=0,
                hybrid_recall_at_k=0.0,
                dense_only_recall_at_k=0.0,
                bm25_only_recall_at_k=0.0,
                hybrid_mrr=0.0,
                dense_only_mrr=0.0,
                bm25_only_mrr=0.0,
                grounding_pass_rate=0.0,
            )

        mode_hits: dict[Literal["hybrid", "dense_only", "bm25_only"], int] = {
            "hybrid": 0,
            "dense_only": 0,
            "bm25_only": 0,
        }
        mode_rr: dict[Literal["hybrid", "dense_only", "bm25_only"], float] = {
            "hybrid": 0.0,
            "dense_only": 0.0,
            "bm25_only": 0.0,
        }
        grounded_passes = 0

        for case in req.cases:
            hybrid_results: list[RetrievedChunkItem] = []
            for mode in ("hybrid", "dense_only", "bm25_only"):
                hits = await self.retriever.retrieve(
                    query=case.question,
                    filters=case.filters,
                    top_k=req.top_k,
                    mode=mode,
                )
                if mode == "hybrid":
                    hybrid_results = hits
                rank = _find_matching_rank(case, hits)
                if rank is not None:
                    mode_hits[mode] += 1
                    mode_rr[mode] += 1.0 / rank

            ask_resp = await self.verifier.generate_and_verify(
                question=case.question,
                retrieved_chunks=hybrid_results,
                generator=self.generator,
            )
            ans_numbers = extract_normalized_numbers(ask_resp.answer)
            expected_nums = {n.replace(",", "") for n in case.expected_numbers}
            if ask_resp.status in {"GROUNDED", "FALLBACK_EXTRACTIVE"} and expected_nums.issubset(
                ans_numbers
            ):
                grounded_passes += 1

        total = len(req.cases)
        return EvalComparisonMetrics(
            total_cases=total,
            hybrid_recall_at_k=round(mode_hits["hybrid"] / total, 4),
            dense_only_recall_at_k=round(mode_hits["dense_only"] / total, 4),
            bm25_only_recall_at_k=round(mode_hits["bm25_only"] / total, 4),
            hybrid_mrr=round(mode_rr["hybrid"] / total, 4),
            dense_only_mrr=round(mode_rr["dense_only"] / total, 4),
            bm25_only_mrr=round(mode_rr["bm25_only"] / total, 4),
            grounding_pass_rate=round(grounded_passes / total, 4),
        )
