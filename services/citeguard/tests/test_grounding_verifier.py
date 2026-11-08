from __future__ import annotations

from citeguard.db import DatabaseManager
from citeguard.grounding import GroundingVerifier
from citeguard.schemas import LLMRawCitation, LLMRawOutput, RetrievedChunkItem


def sample_chunks() -> list[RetrievedChunkItem]:
    return [
        RetrievedChunkItem(
            chunk_uid="ftc:c17",
            doc_key="ftc-standard",
            breadcrumb="전자상거래 표준약관 > 제17조(청약철회등)",
            clause_code="제17조",
            raw_content="소비자는 재화등을 공급받은 날부터 7일 이내에 청약철회를 할 수 있습니다. 반품 배송비는 편도 3,000원입니다.",
            source_url="https://www.ftc.go.kr/terms",
            source_grade="A",
            effective_date="2026-01-01",
            dense_rank=1,
            dense_score=0.91,
            bm25_rank=1,
            bm25_score=4.2,
            rrf_score=0.032787,
        )
    ]


def test_grounding_verifier_passes_valid_numbers_and_quote() -> None:
    db_mgr = DatabaseManager("sqlite:///:memory:")
    db_mgr.create_tables()
    verifier = GroundingVerifier(db_mgr)

    llm_out = LLMRawOutput(
        answer="제17조에 따라 공급받은 날부터 7일 이내에 청약철회가 가능하며 반품 배송비는 3,000원입니다.",
        abstained=False,
        citations=[
            LLMRawCitation(
                chunk_uid="ftc:c17",
                quote="소비자는 재화등을 공급받은 날부터 7일 이내에 청약철회를 할 수 있습니다.",
            )
        ],
    )

    res = verifier.verify_output(
        question="청약철회 기간과 반품 배송비는?",
        llm_out=llm_out,
        retrieved_chunks=sample_chunks(),
        model_name="ollama/qwen2.5:0.5b",
    )
    assert res.status == "GROUNDED"
    assert res.violation == "NONE"
    assert len(res.citations) == 1
    assert "7일 이내" in res.answer


def test_grounding_verifier_blocks_numeric_hallucination_from_small_llm() -> None:
    db_mgr = DatabaseManager("sqlite:///:memory:")
    db_mgr.create_tables()
    verifier = GroundingVerifier(db_mgr)

    # Small 0.5B LLM hallucinates "14일 이내" and "5,000원" despite quoting the chunk
    hallucinated_out = LLMRawOutput(
        answer="공급받은 날부터 14일 이내에 청약철회가 가능하며 반품 배송비는 5,000원입니다.",
        abstained=False,
        citations=[
            LLMRawCitation(
                chunk_uid="ftc:c17",
                quote="소비자는 재화등을 공급받은 날부터 7일 이내에 청약철회를 할 수 있습니다.",
            )
        ],
    )

    res = verifier.verify_output(
        question="청약철회 기간은 며칠인가요?",
        llm_out=hallucinated_out,
        retrieved_chunks=sample_chunks(),
        model_name="ollama/qwen2.5:0.5b",
    )
    assert res.status == "FALLBACK_EXTRACTIVE"
    assert res.violation == "NUMERIC_HALLUCINATION"
    assert res.violation_detail is not None
    assert "14" in res.violation_detail
    assert "5000" in res.violation_detail
    # Fallback answer restores the exact source truth ("7일 이내")
    assert "7일 이내" in res.answer
    assert "14일" not in res.answer


def test_grounding_verifier_blocks_unknown_chunk_id_and_fabricated_quote() -> None:
    db_mgr = DatabaseManager("sqlite:///:memory:")
    db_mgr.create_tables()
    verifier = GroundingVerifier(db_mgr)

    bad_id_out = LLMRawOutput(
        answer="7일 이내 가능합니다.",
        abstained=False,
        citations=[
            LLMRawCitation(
                chunk_uid="non-existent-uid",
                quote="소비자는 재화등을 공급받은 날부터 7일 이내에 청약철회를 할 수 있습니다.",
            )
        ],
    )
    res_id = verifier.verify_output(
        question="청약철회 기간은?",
        llm_out=bad_id_out,
        retrieved_chunks=sample_chunks(),
        model_name="ollama/qwen2.5:0.5b",
    )
    assert res_id.status == "FALLBACK_EXTRACTIVE"
    assert res_id.violation == "UNKNOWN_CHUNK_ID"

    bad_quote_out = LLMRawOutput(
        answer="7일 이내 가능합니다.",
        abstained=False,
        citations=[
            LLMRawCitation(
                chunk_uid="ftc:c17",
                quote="원문에 전혀 존재하지 않는 날조된 인용 문장입니다.",
            )
        ],
    )
    res_quote = verifier.verify_output(
        question="청약철회 기간은?",
        llm_out=bad_quote_out,
        retrieved_chunks=sample_chunks(),
        model_name="ollama/qwen2.5:0.5b",
    )
    assert res_quote.status == "FALLBACK_EXTRACTIVE"
    assert res_quote.violation == "UNVERIFIED_QUOTE_SPAN"
