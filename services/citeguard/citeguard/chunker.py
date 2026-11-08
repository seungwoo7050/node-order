from __future__ import annotations

import hashlib
import re
import uuid
from dataclasses import dataclass

HEADING_RE = re.compile(r"^(#{1,4})\s+(.+?)\s*$")
CLAUSE_RE = re.compile(r"(제\s*\d+\s*조(?:의\s*\d+)?|Article\s+\d+(?:\.\d+)?|Rule\s+\d+(?:\.\d+)?)", re.IGNORECASE)
TOKEN_RE = re.compile(r"[가-힣A-Za-z0-9]+(?:-\d+)?")
KO_PARTICLES = (
    "으로부터",
    "에서부터",
    "에게는",
    "으로는",
    "이라도",
    "에서",
    "으로",
    "에게",
    "까지",
    "부터",
    "이나",
    "거나",
    "처럼",
    "보다",
    "조차",
    "마저",
    "은",
    "는",
    "이",
    "가",
    "을",
    "를",
    "의",
    "에",
    "로",
    "와",
    "과",
    "도",
    "만",
)


@dataclass(frozen=True)
class ParsedChunk:
    chunk_uid: str
    qdrant_point_id: str
    chunk_index: int
    breadcrumb: str
    clause_code: str | None
    raw_content: str
    indexed_text: str
    chunk_hash: str
    tokens: list[str]


def normalize_whitespace(text: str) -> str:
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.strip().splitlines()]
    return "\n".join(line for line in lines if line)


def compute_sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def extract_clause_code(breadcrumb: str, content: str) -> str | None:
    for target in (breadcrumb, content):
        match = CLAUSE_RE.search(target)
        if match:
            return re.sub(r"\s+", "", match.group(1))
    return None


def tokenize_for_bm25(text: str) -> list[str]:
    """Tokenizes Korean/English text, strips trailing Korean particles, and preserves numbers/codes."""
    raw_tokens = TOKEN_RE.findall(text.lower())
    result: list[str] = []
    for tok in raw_tokens:
        result.append(tok)
        if any("가" <= ch <= "힣" for ch in tok) and len(tok) >= 3:
            for particle in KO_PARTICLES:
                if tok.endswith(particle) and len(tok) - len(particle) >= 2:
                    stem = tok[: -len(particle)]
                    result.append(stem)
                    break
    return result


class BreadcrumbChunker:
    """Splits Markdown documents into context-preserving chunks with breadcrumb prefixes and table integrity."""

    def __init__(self, max_chunk_chars: int = 480) -> None:
        self.max_chunk_chars = max_chunk_chars

    def chunk_document(self, doc_key: str, doc_title: str, markdown_text: str) -> list[ParsedChunk]:
        normalized_doc = markdown_text.strip()
        if not normalized_doc:
            return []

        heading_stack: dict[int, str] = {0: doc_title.strip()}
        blocks = self._split_into_semantic_blocks(normalized_doc)

        section_buffers: list[tuple[str, str]] = []
        current_paragraphs: list[str] = []

        def current_breadcrumb() -> str:
            ordered = [heading_stack[level] for level in sorted(heading_stack.keys())]
            deduped: list[str] = []
            for item in ordered:
                if not deduped or deduped[-1] != item:
                    deduped.append(item)
            return " > ".join(deduped)

        def flush_current_section(crumb: str) -> None:
            if not current_paragraphs:
                return
            combined = "\n".join(current_paragraphs).strip()
            current_paragraphs.clear()
            if combined:
                section_buffers.extend(self._pack_paragraphs(crumb, combined))

        for block in blocks:
            heading_match = HEADING_RE.match(block)
            if heading_match and "\n" not in block:
                flush_current_section(current_breadcrumb())
                level = len(heading_match.group(1))
                heading_title = heading_match.group(2).strip()
                for deeper in [k for k in list(heading_stack.keys()) if k >= level]:
                    del heading_stack[deeper]
                heading_stack[level] = heading_title
            else:
                current_paragraphs.append(block)

        flush_current_section(current_breadcrumb())

        chunks: list[ParsedChunk] = []
        seen_hashes: set[str] = set()
        for breadcrumb, raw_body in section_buffers:
            norm_body = normalize_whitespace(raw_body)
            if not norm_body:
                continue
            chunk_hash = compute_sha256(f"{breadcrumb}\n{norm_body}")
            if chunk_hash in seen_hashes:
                continue
            seen_hashes.add(chunk_hash)

            idx = len(chunks)
            point_uuid = str(uuid.uuid5(uuid.NAMESPACE_URL, f"citeguard:{doc_key}:{chunk_hash}"))
            chunk_uid = f"{doc_key}:{chunk_hash[:12]}"
            indexed_text = f"[{breadcrumb}]\n{norm_body}"
            clause_code = extract_clause_code(breadcrumb, norm_body)
            tokens = tokenize_for_bm25(indexed_text)

            chunks.append(
                ParsedChunk(
                    chunk_uid=chunk_uid,
                    qdrant_point_id=point_uuid,
                    chunk_index=idx,
                    breadcrumb=breadcrumb,
                    clause_code=clause_code,
                    raw_content=norm_body,
                    indexed_text=indexed_text,
                    chunk_hash=chunk_hash,
                    tokens=tokens,
                )
            )
        return chunks

    def _split_into_semantic_blocks(self, text: str) -> list[str]:
        """Groups consecutive table lines together while splitting headings and paragraphs."""
        blocks: list[str] = []
        table_buf: list[str] = []
        para_buf: list[str] = []

        def flush_para() -> None:
            if para_buf:
                blocks.append("\n".join(para_buf).strip())
                para_buf.clear()

        def flush_table() -> None:
            if table_buf:
                blocks.append("\n".join(table_buf).strip())
                table_buf.clear()

        for raw_line in text.splitlines():
            line = raw_line.strip()
            if not line:
                flush_table()
                flush_para()
                continue
            if HEADING_RE.match(line):
                flush_table()
                flush_para()
                blocks.append(line)
            elif line.startswith("|") and line.endswith("|"):
                flush_para()
                table_buf.append(line)
            else:
                flush_table()
                para_buf.append(line)

        flush_table()
        flush_para()
        return [b for b in blocks if b]

    def _pack_paragraphs(self, breadcrumb: str, section_body: str) -> list[tuple[str, str]]:
        paragraphs = [p.strip() for p in section_body.split("\n") if p.strip()]
        packed: list[tuple[str, str]] = []
        buf: list[str] = []
        buf_len = 0

        for para in paragraphs:
            is_table_row = para.startswith("|") and para.endswith("|")
            # Keep markdown table rows together inside the current buffer if already in a table
            if buf and buf_len + len(para) + 1 > self.max_chunk_chars and not is_table_row:
                packed.append((breadcrumb, "\n".join(buf)))
                buf = [para]
                buf_len = len(para)
            else:
                buf.append(para)
                buf_len += len(para) + 1

        if buf:
            packed.append((breadcrumb, "\n".join(buf)))
        return packed
