from __future__ import annotations

import json

from sqlalchemy import select

from citeguard.chunker import BreadcrumbChunker, compute_sha256
from citeguard.db import DatabaseManager
from citeguard.models import DocumentChunk, DocumentSource, SyncAuditLog
from citeguard.ollama_client import EmbedderProtocol
from citeguard.qdrant_store import QdrantPoint, QdrantVectorStore
from citeguard.schemas import DocumentSyncRequest, DocumentSyncResponse
from citeguard.scraper import LiveDocumentScraper, html_to_markdown


class IncrementalSyncEngine:
    """Performs SHA-256 chunk diffing, selective neural embedding, Qdrant upsert, and stale point purge."""

    def __init__(
        self,
        db_manager: DatabaseManager,
        embedder: EmbedderProtocol,
        qdrant: QdrantVectorStore,
        scraper: LiveDocumentScraper | None = None,
    ) -> None:
        self.db_manager = db_manager
        self.embedder = embedder
        self.qdrant = qdrant
        self.scraper = scraper or LiveDocumentScraper()

    async def sync_document(self, req: DocumentSyncRequest) -> DocumentSyncResponse:
        if req.content is not None and req.content.strip():
            markdown_text = html_to_markdown(req.content)
        else:
            markdown_text = await self.scraper.fetch_markdown(req.source_url)

        doc_hash = compute_sha256(markdown_text)
        chunker = BreadcrumbChunker(max_chunk_chars=req.max_chunk_chars)
        incoming_chunks = chunker.chunk_document(
            doc_key=req.doc_key,
            doc_title=req.title,
            markdown_text=markdown_text,
        )
        incoming_by_hash = {ch.chunk_hash: ch for ch in incoming_chunks}

        with self.db_manager.session() as session:
            doc = session.execute(
                select(DocumentSource).where(DocumentSource.doc_key == req.doc_key)
            ).scalar_one_or_none()

            if doc is None:
                doc = DocumentSource(
                    doc_key=req.doc_key,
                    title=req.title,
                    source_url=req.source_url,
                    category=req.category,
                    language=req.language,
                    source_grade=req.source_grade,
                    effective_date=req.effective_date,
                    content_hash=doc_hash,
                    version=1,
                )
                session.add(doc)
                session.flush()
                existing_rows: list[DocumentChunk] = []
            else:
                existing_rows = list(
                    session.execute(
                        select(DocumentChunk).where(DocumentChunk.document_id == doc.id)
                    ).scalars()
                )

            existing_by_hash = {row.chunk_hash: row for row in existing_rows}

            unchanged_hashes = set(existing_by_hash.keys()) & set(incoming_by_hash.keys())
            stale_hashes = set(existing_by_hash.keys()) - set(incoming_by_hash.keys())
            new_chunks = [
                ch for ch in incoming_chunks if ch.chunk_hash not in existing_by_hash
            ]

            stale_point_ids = [existing_by_hash[h].qdrant_point_id for h in stale_hashes]
            for h in stale_hashes:
                session.delete(existing_by_hash[h])

            # Update chunk_index or metadata on unchanged chunks if order shifted
            for h in unchanged_hashes:
                row = existing_by_hash[h]
                inc = incoming_by_hash[h]
                row.chunk_index = inc.chunk_index
                row.category = req.category
                row.language = req.language
                row.source_grade = req.source_grade
                row.effective_date = req.effective_date
                row.source_url = req.source_url

            embed_calls = 0
            vectors: list[list[float]] = []
            if new_chunks:
                vectors = await self.embedder.embed_batch([c.indexed_text for c in new_chunks])
                embed_calls = 1

            qdrant_points: list[QdrantPoint] = []
            for ch, vec in zip(new_chunks, vectors, strict=True):
                db_chunk = DocumentChunk(
                    chunk_uid=ch.chunk_uid,
                    qdrant_point_id=ch.qdrant_point_id,
                    document_id=doc.id,
                    doc_key=req.doc_key,
                    chunk_index=ch.chunk_index,
                    breadcrumb=ch.breadcrumb,
                    clause_code=ch.clause_code,
                    raw_content=ch.raw_content,
                    indexed_text=ch.indexed_text,
                    chunk_hash=ch.chunk_hash,
                    category=req.category,
                    language=req.language,
                    source_grade=req.source_grade,
                    effective_date=req.effective_date,
                    source_url=req.source_url,
                    tokens_json=json.dumps(ch.tokens, ensure_ascii=False),
                    vector_json=json.dumps(vec),
                )
                session.add(db_chunk)
                qdrant_points.append(
                    QdrantPoint(
                        point_id=ch.qdrant_point_id,
                        vector=vec,
                        payload={
                            "chunk_uid": ch.chunk_uid,
                            "doc_key": req.doc_key,
                            "breadcrumb": ch.breadcrumb,
                            "clause_code": ch.clause_code,
                            "raw_content": ch.raw_content,
                            "category": req.category,
                            "language": req.language,
                            "source_grade": req.source_grade,
                            "effective_date": req.effective_date,
                            "source_url": req.source_url,
                        },
                    )
                )

            if existing_rows and (new_chunks or stale_hashes):
                doc.version += 1
            doc.title = req.title
            doc.source_url = req.source_url
            doc.category = req.category
            doc.language = req.language
            doc.source_grade = req.source_grade
            doc.effective_date = req.effective_date
            doc.content_hash = doc_hash

            deleted_count = await self.qdrant.delete_points(stale_point_ids)
            upserted_count = await self.qdrant.upsert_points(
                qdrant_points, vector_size=self.embedder.dimension
            )

            audit = SyncAuditLog(
                doc_key=req.doc_key,
                added_chunks=len(new_chunks),
                skipped_chunks=len(unchanged_hashes),
                purged_chunks=len(stale_hashes),
                embed_calls=embed_calls,
            )
            session.add(audit)
            current_version = doc.version

        return DocumentSyncResponse(
            doc_key=req.doc_key,
            version=current_version,
            total_chunks=len(incoming_chunks),
            added_chunks=len(new_chunks),
            skipped_chunks=len(unchanged_hashes),
            purged_chunks=len(stale_hashes),
            embed_api_calls=embed_calls,
            qdrant_upserted=upserted_count,
            qdrant_deleted=deleted_count,
        )
