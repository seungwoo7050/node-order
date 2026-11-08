from __future__ import annotations

import html
import re
from html.parser import HTMLParser

import httpx

IGNORED_TAGS = {"script", "style", "nav", "footer", "noscript", "svg", "iframe"}
HEADING_MAP = {"h1": "#", "h2": "##", "h3": "###", "h4": "####"}


class PolicyHTMLParser(HTMLParser):
    """Converts policy/regulation HTML into structured Markdown while preserving headings and tables."""

    def __init__(self) -> None:
        super().__init__()
        self._ignore_depth = 0
        self._lines: list[str] = []
        self._current_buf: list[str] = []
        self._in_heading: str | None = None
        self._in_table = False
        self._table_rows: list[list[str]] = []
        self._current_row: list[str] = []
        self._in_cell = False
        self._cell_buf: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        lower = tag.lower()
        if lower in IGNORED_TAGS:
            self._ignore_depth += 1
            return
        if self._ignore_depth > 0:
            return

        if lower in HEADING_MAP:
            self._flush_text()
            self._in_heading = HEADING_MAP[lower]
        elif lower == "table":
            self._flush_text()
            self._in_table = True
            self._table_rows = []
        elif lower == "tr" and self._in_table:
            self._current_row = []
        elif lower in {"th", "td"} and self._in_table:
            self._in_cell = True
            self._cell_buf = []
        elif lower in {"p", "div", "section", "article", "br", "li"}:
            if not self._in_table:
                self._flush_text()
                if lower == "li":
                    self._current_buf.append("- ")

    def handle_endtag(self, tag: str) -> None:
        lower = tag.lower()
        if lower in IGNORED_TAGS:
            if self._ignore_depth > 0:
                self._ignore_depth -= 1
            return
        if self._ignore_depth > 0:
            return

        if lower in HEADING_MAP and self._in_heading is not None:
            heading_text = self._clean_inline("".join(self._current_buf))
            self._current_buf = []
            if heading_text:
                self._lines.append(f"{self._in_heading} {heading_text}")
            self._in_heading = None
        elif lower in {"th", "td"} and self._in_table and self._in_cell:
            cell_text = self._clean_inline("".join(self._cell_buf))
            self._current_row.append(cell_text)
            self._cell_buf = []
            self._in_cell = False
        elif lower == "tr" and self._in_table:
            if any(cell for cell in self._current_row):
                self._table_rows.append(self._current_row)
            self._current_row = []
        elif lower == "table" and self._in_table:
            self._flush_table()
            self._in_table = False
        elif lower in {"p", "div", "section", "article", "li"} and not self._in_table:
            self._flush_text()

    def handle_data(self, data: str) -> None:
        if self._ignore_depth > 0:
            return
        if self._in_table and self._in_cell:
            self._cell_buf.append(data)
        elif not self._in_table:
            self._current_buf.append(data)

    def get_markdown(self) -> str:
        self._flush_text()
        return "\n\n".join(line for line in self._lines if line.strip())

    def _flush_text(self) -> None:
        if not self._current_buf:
            return
        cleaned = self._clean_inline("".join(self._current_buf))
        self._current_buf = []
        if cleaned and cleaned != "-":
            self._lines.append(cleaned)

    def _flush_table(self) -> None:
        if not self._table_rows:
            return
        col_count = max(len(r) for r in self._table_rows)
        md_rows: list[str] = []
        for idx, row in enumerate(self._table_rows):
            padded = row + [""] * (col_count - len(row))
            md_rows.append("| " + " | ".join(padded) + " |")
            if idx == 0:
                md_rows.append("| " + " | ".join(["---"] * col_count) + " |")
        self._lines.append("\n".join(md_rows))
        self._table_rows = []

    @staticmethod
    def _clean_inline(text: str) -> str:
        unescaped = html.unescape(text)
        return re.sub(r"\s+", " ", unescaped).strip()


def html_to_markdown(raw_html: str) -> str:
    if "<html" not in raw_html.lower() and "<body" not in raw_html.lower() and "<h" not in raw_html.lower() and "<table" not in raw_html.lower() and "<p" not in raw_html.lower():
        return raw_html.strip()
    parser = PolicyHTMLParser()
    parser.feed(raw_html)
    return parser.get_markdown()


class LiveDocumentScraper:
    """Fetches live policy/regulation pages over HTTP and normalizes HTML or Markdown."""

    def __init__(
        self,
        timeout_seconds: float = 10.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._timeout = timeout_seconds
        self._transport = transport

    async def fetch_markdown(self, url: str) -> str:
        async with httpx.AsyncClient(
            timeout=self._timeout,
            follow_redirects=True,
            transport=self._transport,
            headers={"User-Agent": "CiteGuard-PolicyIndexer/0.1"},
        ) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            content_type = resp.headers.get("content-type", "").lower()
            text = resp.text
            if "html" in content_type or "<html" in text.lower() or "<table" in text.lower():
                return html_to_markdown(text)
            return text.strip()
