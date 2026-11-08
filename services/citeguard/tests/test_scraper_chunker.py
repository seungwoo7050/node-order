from __future__ import annotations

import httpx

from citeguard.chunker import BreadcrumbChunker, tokenize_for_bm25
from citeguard.scraper import LiveDocumentScraper, html_to_markdown


async def test_live_scraper_strips_noise_and_converts_html_table() -> None:
    sample_html = """
    <html>
      <head><script>console.log("ads");</script><style>.hidden{display:none}</style></head>
      <body>
        <nav>상단 메뉴 링크</nav>
        <h1>공항철도(AREX) 운임 및 환불 규정</h1>
        <h2>제12조 승차권 환불 수수료</h2>
        <p>직통열차 승차권은 출발 시각 기준으로 수수료가 차등 부과됩니다.</p>
        <table>
          <tr><th>구분</th><th>환불 시점</th><th>수수료</th></tr>
          <tr><td>직통열차</td><td>출발 전</td><td>무료 (0원)</td></tr>
          <tr><td>직통열차</td><td>출발 후</td><td>환불 불가</td></tr>
        </table>
        <footer>Copyright AREX</footer>
      </body>
    </html>
    """

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"content-type": "text/html; charset=utf-8"},
            text=sample_html,
        )

    scraper = LiveDocumentScraper(transport=httpx.MockTransport(handler))
    md = await scraper.fetch_markdown("https://www.arex.or.kr/terms")

    assert "console.log" not in md
    assert "상단 메뉴 링크" not in md
    assert "Copyright AREX" not in md
    assert "# 공항철도(AREX) 운임 및 환불 규정" in md
    assert "## 제12조 승차권 환불 수수료" in md
    assert "| 직통열차 | 출발 전 | 무료 (0원) |" in md


def test_breadcrumb_chunker_preserves_hierarchy_and_clause_code() -> None:
    md_doc = """
# 전자상거래 표준약관

## 제4장 청약철회 및 대금환급

### 제17조 (청약철회등)
이용자는 재화등을 공급받은 날부터 7일 이내에 청약철회를 할 수 있습니다.
단, 포장을 개봉하여 가치가 현저히 감소한 경우에는 청약철회가 제한됩니다.

### 제18조 (청약철회등의 효과)
몰은 이용자로부터 재화등을 반환받은 경우 3영업일 이내에 대금을 환급합니다.
"""
    chunker = BreadcrumbChunker(max_chunk_chars=300)
    chunks = chunker.chunk_document(
        doc_key="ftc-standard",
        doc_title="전자상거래 표준약관",
        markdown_text=md_doc,
    )

    assert len(chunks) == 2
    assert chunks[0].breadcrumb == "전자상거래 표준약관 > 제4장 청약철회 및 대금환급 > 제17조 (청약철회등)"
    assert chunks[0].clause_code == "제17조"
    assert chunks[0].indexed_text.startswith("[전자상거래 표준약관 > 제4장 청약철회 및 대금환급 > 제17조 (청약철회등)]")
    assert "7일 이내" in chunks[0].raw_content

    assert chunks[1].clause_code == "제18조"
    assert "3영업일 이내" in chunks[1].raw_content

    # Re-chunking with different whitespace yields identical chunk_hash and qdrant_point_id
    chunks_re = chunker.chunk_document(
        doc_key="ftc-standard",
        doc_title="전자상거래 표준약관",
        markdown_text=md_doc + "\n\n   \n",
    )
    assert chunks_re[0].chunk_hash == chunks[0].chunk_hash
    assert chunks_re[0].qdrant_point_id == chunks[0].qdrant_point_id


def test_bm25_tokenizer_strips_korean_particles() -> None:
    tokens = tokenize_for_bm25("청약철회를 7일 이내에 요청할 수 있습니다")
    assert "청약철회" in tokens
    assert "7일" in tokens
    assert "이내" in tokens
    assert html_to_markdown("plain markdown text") == "plain markdown text"
