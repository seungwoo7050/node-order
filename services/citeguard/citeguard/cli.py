from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

import uvicorn

from citeguard.api import create_app
from citeguard.db import DatabaseManager
from citeguard.grounding import GroundingVerifier
from citeguard.indexer import IncrementalSyncEngine
from citeguard.ollama_client import OllamaChatGenerator, OllamaEmbedder
from citeguard.qdrant_store import QdrantVectorStore
from citeguard.retriever import HybridRRFRetriever
from citeguard.schemas import DocumentSyncRequest, MetadataFilter


async def _cmd_sync(args: argparse.Namespace) -> int:
    db_mgr = DatabaseManager(args.db_url)
    db_mgr.create_tables()
    embedder = OllamaEmbedder(base_url=args.ollama_url, model=args.embed_model)
    qdrant = QdrantVectorStore(base_url=args.qdrant_url, collection_name=args.collection)
    engine = IncrementalSyncEngine(db_manager=db_mgr, embedder=embedder, qdrant=qdrant)

    content: str | None = None
    if args.file:
        content = Path(args.file).read_text(encoding="utf-8")

    res = await engine.sync_document(
        DocumentSyncRequest(
            doc_key=args.doc_key,
            title=args.title,
            source_url=args.url,
            category=args.category,
            language=args.language,
            content=content,
        )
    )
    print(json.dumps(res.model_dump(), ensure_ascii=False, indent=2))
    return 0


async def _cmd_ask(args: argparse.Namespace) -> int:
    db_mgr = DatabaseManager(args.db_url)
    db_mgr.create_tables()
    embedder = OllamaEmbedder(base_url=args.ollama_url, model=args.embed_model)
    generator = OllamaChatGenerator(base_url=args.ollama_url, model=args.chat_model)
    qdrant = QdrantVectorStore(base_url=args.qdrant_url, collection_name=args.collection)
    retriever = HybridRRFRetriever(db_manager=db_mgr, embedder=embedder, qdrant=qdrant)
    verifier = GroundingVerifier(db_manager=db_mgr)

    filters = MetadataFilter(category=args.category, language=args.language)
    hits = await retriever.retrieve(query=args.question, filters=filters, top_k=args.top_k)
    resp = await verifier.generate_and_verify(
        question=args.question,
        retrieved_chunks=hits,
        generator=generator,
    )
    print(json.dumps(resp.model_dump(), ensure_ascii=False, indent=2))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="citeguard",
        description="Incremental Qdrant Hybrid RAG and Local Ollama Grounding Verifier CLI",
    )
    parser.add_argument("--db-url", default="sqlite:///./citeguard.db")
    parser.add_argument("--qdrant-url", default="http://localhost:6333")
    parser.add_argument("--collection", default="citeguard_chunks")
    parser.add_argument("--ollama-url", default="http://localhost:11434")
    parser.add_argument("--embed-model", default="all-minilm")
    parser.add_argument("--chat-model", default="qwen2.5:0.5b")

    sub = parser.add_subparsers(dest="command", required=True)

    serve_p = sub.add_parser("serve", help="Run FastAPI HTTP server")
    serve_p.add_argument("--host", default="127.0.0.1")
    serve_p.add_argument("--port", type=int, default=8090)

    sync_p = sub.add_parser("sync", help="Incrementally sync a policy document into Qdrant")
    sync_p.add_argument("--doc-key", required=True)
    sync_p.add_argument("--title", required=True)
    sync_p.add_argument("--url", default="https://official.example.org/policy")
    sync_p.add_argument("--file", default=None, help="Local Markdown/HTML file path")
    sync_p.add_argument("--category", default="commerce_policy")
    sync_p.add_argument("--language", default="ko")

    ask_p = sub.add_parser("ask", help="Query Hybrid RAG and verify local LLM answer")
    ask_p.add_argument("question")
    ask_p.add_argument("--category", default=None)
    ask_p.add_argument("--language", default=None)
    ask_p.add_argument("--top-k", type=int, default=4)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.command == "serve":
        app = create_app(db_url=args.db_url)
        uvicorn.run(app, host=args.host, port=args.port)
        return 0
    if args.command == "sync":
        return asyncio.run(_cmd_sync(args))
    if args.command == "ask":
        return asyncio.run(_cmd_ask(args))
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
