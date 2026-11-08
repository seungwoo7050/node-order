from __future__ import annotations

import pytest
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError

from citeguard.db import DatabaseManager
from citeguard.models import DocumentChunk, DocumentSource
from citeguard.schemas import AskRequest, DocumentSyncRequest


def test_document_and_chunk_unique_hash_constraint() -> None:
    db_mgr = DatabaseManager("sqlite:///:memory:")
    db_mgr.create_tables()

    with db_mgr.session() as session:
        doc = DocumentSource(
            doc_key="kr-ecommerce-standard",
            title="전자상거래 표준약관",
            source_url="https://www.ftc.go.kr/standard-terms",
            category="commerce_policy",
            language="ko",
            source_grade="A",
            effective_date="2026-01-01",
            content_hash="abc123hash",
        )
        session.add(doc)
        session.flush()

        c1 = DocumentChunk(
            chunk_uid="chunk-001",
            qdrant_point_id="00000000-0000-0000-0000-000000000001",
            document_id=doc.id,
            doc_key=doc.doc_key,
            chunk_index=0,
            breadcrumb="전자상거래 표준약관 > 제17조(청약철회등)",
            clause_code="제17조",
            raw_content="재화등을 공급받은 날부터 7일 이내에 청약철회를 할 수 있습니다.",
            indexed_text="[전자상거래 표준약관 > 제17조(청약철회등)] 재화등을 공급받은 날부터 7일 이내에 청약철회를 할 수 있습니다.",
            chunk_hash="same_chunk_hash",
            category="commerce_policy",
            language="ko",
            source_grade="A",
            effective_date="2026-01-01",
            source_url=doc.source_url,
        )
        session.add(c1)
        session.flush()

        c2 = DocumentChunk(
            chunk_uid="chunk-002",
            qdrant_point_id="00000000-0000-0000-0000-000000000002",
            document_id=doc.id,
            doc_key=doc.doc_key,
            chunk_index=1,
            breadcrumb="전자상거래 표준약관 > 제17조(청약철회등)",
            clause_code="제17조",
            raw_content="동일 내용 중복 적재 시도",
            indexed_text="동일 내용 중복 적재 시도",
            chunk_hash="same_chunk_hash",
            category="commerce_policy",
            language="ko",
            source_grade="A",
            effective_date="2026-01-01",
            source_url=doc.source_url,
        )
        session.add(c2)
        with pytest.raises(IntegrityError):
            session.flush()
        session.rollback()


def test_schema_validation_bounds() -> None:
    req = DocumentSyncRequest(
        doc_key="arex-fare-policy",
        title="공항철도 운임 및 환불 규정",
        category="transit_policy",
    )
    assert req.max_chunk_chars == 480
    assert req.source_grade == "A"

    with pytest.raises(ValidationError):
        AskRequest(question="a", top_k=0)
