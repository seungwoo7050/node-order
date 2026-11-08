from __future__ import annotations

import re

from citeguard.chunker import tokenize_for_bm25
from citeguard.db import DatabaseManager
from citeguard.models import QueryAuditLog
from citeguard.ollama_client import ChatGeneratorProtocol
from citeguard.schemas import (
    AskResponse,
    CitationItem,
    GroundingStatus,
    LLMRawOutput,
    RetrievedChunkItem,
    ViolationType,
)

NUMERIC_TOKEN_RE = re.compile(r"(?<!\d)\d+(?:,\d{3})*(?:\.\d+)?(?!\d)")
SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?다요])\s+|\n+")


def extract_normalized_numbers(text: str) -> set[str]:
    """Extracts all numeric values using word boundaries and strips thousand-separator commas."""
    matches = NUMERIC_TOKEN_RE.findall(text)
    return {m.replace(",", "") for m in matches}


def normalize_for_span_match(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def build_extractive_fallback(
    question: str, chunks: list[RetrievedChunkItem]
) -> tuple[str, list[CitationItem]]:
    """Constructs a 100% source-faithful extractive summary from the top retrieved chunk."""
    top = chunks[0]
    q_tokens = set(tokenize_for_bm25(question))
    raw_sentences = [
        s.strip() for s in SENTENCE_SPLIT_RE.split(top.raw_content) if s.strip()
    ]
    if not raw_sentences:
        raw_sentences = [top.raw_content.strip()]

    best_sentence = raw_sentences[0]
    best_overlap = -1
    for sent in raw_sentences:
        s_tokens = set(tokenize_for_bm25(sent))
        overlap = len(q_tokens & s_tokens)
        if overlap > best_overlap:
            best_overlap = overlap
            best_sentence = sent

    answer = f"[{top.breadcrumb}] {best_sentence}"
    citation = CitationItem(
        chunk_uid=top.chunk_uid,
        breadcrumb=top.breadcrumb,
        quote=best_sentence,
        source_url=top.source_url,
        source_grade=top.source_grade,
        effective_date=top.effective_date,
    )
    return answer, [citation]


class GroundingVerifier:
    """Verifies local LLM outputs against retrieved source chunks for citation existence,
    exact quote span inclusion, and numeric word-boundary fidelity."""

    def __init__(self, db_manager: DatabaseManager) -> None:
        self.db_manager = db_manager

    def verify_output(
        self,
        question: str,
        llm_out: LLMRawOutput,
        retrieved_chunks: list[RetrievedChunkItem],
        model_name: str,
    ) -> AskResponse:
        if not retrieved_chunks:
            resp = AskResponse(
                question=question,
                answer="검색된 규정 원문이 없어 답변을 보류합니다.",
                status="ABSTAINED",
                violation="INSUFFICIENT_CONTEXT",
                violation_detail="No matching chunks retrieved from Qdrant/BM25.",
                citations=[],
                retrieved_chunks=[],
                model_used=model_name,
            )
            self._log_audit(resp)
            return resp

        if llm_out.abstained:
            resp = AskResponse(
                question=question,
                answer=llm_out.answer or "제공된 규정 근거만으로 답변할 수 없습니다.",
                status="ABSTAINED",
                violation="NONE",
                violation_detail=None,
                citations=[],
                retrieved_chunks=retrieved_chunks,
                model_used=model_name,
            )
            self._log_audit(resp)
            return resp

        chunk_by_uid = {ch.chunk_uid: ch for ch in retrieved_chunks}

        # Guard 1: Must provide at least one citation
        if not llm_out.citations:
            return self._trigger_fallback(
                question=question,
                retrieved_chunks=retrieved_chunks,
                violation="EMPTY_CITATIONS",
                detail="LLM generated an answer without any citation items.",
                model_name=model_name,
            )

        verified_citations: list[CitationItem] = []
        cited_chunks: list[RetrievedChunkItem] = []

        for raw_cit in llm_out.citations:
            target = chunk_by_uid.get(raw_cit.chunk_uid)
            # Guard 2: Cited chunk_uid must exist in the retrieved top-k set
            if target is None:
                return self._trigger_fallback(
                    question=question,
                    retrieved_chunks=retrieved_chunks,
                    violation="UNKNOWN_CHUNK_ID",
                    detail=f"LLM cited non-existent chunk_uid '{raw_cit.chunk_uid}'.",
                    model_name=model_name,
                )

            # Guard 3: Cited quote must be a real substring of the source chunk
            norm_quote = normalize_for_span_match(raw_cit.quote)
            norm_source = normalize_for_span_match(target.raw_content)
            if not norm_quote or norm_quote not in norm_source:
                return self._trigger_fallback(
                    question=question,
                    retrieved_chunks=retrieved_chunks,
                    violation="UNVERIFIED_QUOTE_SPAN",
                    detail=(
                        f"Quote '{raw_cit.quote}' is not an exact span of chunk '{target.chunk_uid}'."
                    ),
                    model_name=model_name,
                )

            cited_chunks.append(target)
            verified_citations.append(
                CitationItem(
                    chunk_uid=target.chunk_uid,
                    breadcrumb=target.breadcrumb,
                    quote=raw_cit.quote.strip(),
                    source_url=target.source_url,
                    source_grade=target.source_grade,
                    effective_date=target.effective_date,
                )
            )

        # Guard 4: Numeric word-boundary verification
        answer_numbers = extract_normalized_numbers(llm_out.answer)
        allowed_numbers: set[str] = set()
        for ch in cited_chunks:
            allowed_numbers |= extract_normalized_numbers(ch.raw_content)
            allowed_numbers |= extract_normalized_numbers(ch.breadcrumb)

        ungrounded_numbers = answer_numbers - allowed_numbers
        if ungrounded_numbers:
            sorted_bad = ", ".join(sorted(ungrounded_numbers))
            return self._trigger_fallback(
                question=question,
                retrieved_chunks=retrieved_chunks,
                violation="NUMERIC_HALLUCINATION",
                detail=(
                    f"Answer contains ungrounded numbers [{sorted_bad}] not present in cited source chunks."
                ),
                model_name=model_name,
            )

        resp = AskResponse(
            question=question,
            answer=llm_out.answer.strip(),
            status="GROUNDED",
            violation="NONE",
            violation_detail=None,
            citations=verified_citations,
            retrieved_chunks=retrieved_chunks,
            model_used=model_name,
        )
        self._log_audit(resp)
        return resp

    async def generate_and_verify(
        self,
        question: str,
        retrieved_chunks: list[RetrievedChunkItem],
        generator: ChatGeneratorProtocol,
    ) -> AskResponse:
        if not retrieved_chunks:
            return self.verify_output(
                question=question,
                llm_out=LLMRawOutput(answer="", abstained=True, citations=[]),
                retrieved_chunks=[],
                model_name=generator.model_name,
            )

        try:
            llm_out = await generator.generate_grounded(question, retrieved_chunks)
        except Exception as exc:
            return self._trigger_fallback(
                question=question,
                retrieved_chunks=retrieved_chunks,
                violation="EMPTY_CITATIONS",
                detail=f"Local LLM invocation failed ({type(exc).__name__}); fell back to extractive synthesis.",
                model_name=generator.model_name,
            )

        return self.verify_output(
            question=question,
            llm_out=llm_out,
            retrieved_chunks=retrieved_chunks,
            model_name=generator.model_name,
        )

    def _trigger_fallback(
        self,
        question: str,
        retrieved_chunks: list[RetrievedChunkItem],
        violation: ViolationType,
        detail: str,
        model_name: str,
    ) -> AskResponse:
        fallback_answer, fallback_citations = build_extractive_fallback(
            question, retrieved_chunks
        )
        status: GroundingStatus = "FALLBACK_EXTRACTIVE"
        resp = AskResponse(
            question=question,
            answer=fallback_answer,
            status=status,
            violation=violation,
            violation_detail=detail,
            citations=fallback_citations,
            retrieved_chunks=retrieved_chunks,
            model_used=f"{model_name}+extractive_guard",
        )
        self._log_audit(resp)
        return resp

    def _log_audit(self, resp: AskResponse) -> None:
        top_uid = resp.retrieved_chunks[0].chunk_uid if resp.retrieved_chunks else None
        top_score = resp.retrieved_chunks[0].rrf_score if resp.retrieved_chunks else 0.0
        with self.db_manager.session() as session:
            session.add(
                QueryAuditLog(
                    question=resp.question,
                    status=resp.status,
                    grounding_violation=resp.violation if resp.violation != "NONE" else None,
                    top_chunk_uid=top_uid,
                    rrf_top_score=top_score,
                )
            )
