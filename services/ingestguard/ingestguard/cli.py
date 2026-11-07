from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path
from typing import Sequence

import uvicorn

from ingestguard.app import create_app
from ingestguard.models import IngestRequest, SchemaSpec
from ingestguard.replayer import IngestService, ReplayValidationError
from ingestguard.store import IngestStore


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="ingestguard",
        description="Streaming chunk ingestion, idempotent upsert, and quarantine replay CLI.",
    )
    subparsers = parser.add_subparsers(dest="subcommand", required=True)

    # Subcommand: serve
    serve_parser = subparsers.add_parser("serve", help="Run the IngestGuard FastAPI server")
    serve_parser.add_argument("--host", default="0.0.0.0", help="Host address (default: 0.0.0.0)")
    serve_parser.add_argument("--port", type=int, default=8000, help="Port (default: 8000)")
    serve_parser.add_argument(
        "--db-url",
        default="sqlite:///:memory:",
        help="Database connection URL (default: sqlite:///:memory:)",
    )

    # Subcommand: ingest
    ingest_parser = subparsers.add_parser("ingest", help="Ingest a CSV or JSONL batch directly")
    ingest_parser.add_argument("--dataset", required=True, help="Target dataset name")
    ingest_parser.add_argument(
        "--format",
        required=True,
        choices=["csv", "jsonl"],
        dest="format_type",
        help="Input format",
    )
    ingest_parser.add_argument("--spec", required=True, help="Path to JSON SchemaSpec file")
    ingest_parser.add_argument("--input", required=True, help="Path to input data file")
    ingest_parser.add_argument("--chunk-size", type=int, default=200, help="Chunk size")
    ingest_parser.add_argument(
        "--db-url",
        default="sqlite:///ingestguard.db",
        help="Database connection URL (default: sqlite:///ingestguard.db)",
    )

    # Subcommand: replay
    replay_parser = subparsers.add_parser("replay", help="Replay a quarantined row with a patch")
    replay_parser.add_argument("--id", required=True, dest="quarantine_id", help="Quarantine ID")
    replay_parser.add_argument("--spec", required=True, help="Path to JSON SchemaSpec file")
    replay_parser.add_argument("--payload", required=True, help="Path to patched JSON payload")
    replay_parser.add_argument(
        "--db-url",
        default="sqlite:///ingestguard.db",
        help="Database connection URL (default: sqlite:///ingestguard.db)",
    )

    return parser


def main(argv: Sequence[str] | None = None) -> None:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.subcommand == "serve":
        app = create_app(db_url=args.db_url)
        uvicorn.run(app, host=args.host, port=args.port)

    elif args.subcommand == "ingest":
        spec_content = Path(args.spec).read_text(encoding="utf-8")
        spec_dict = json.loads(spec_content)
        schema_spec = SchemaSpec.model_validate(spec_dict)

        data_content = Path(args.input).read_text(encoding="utf-8")

        store = IngestStore(db_url=args.db_url)
        store.init_db()
        service = IngestService(store=store)

        req = IngestRequest(
            dataset=args.dataset,
            format_type=args.format_type,
            schema_spec=schema_spec,
            content=data_content,
            chunk_size=args.chunk_size,
        )

        summary = asyncio.run(service.ingest_batch(req))
        print(json.dumps(summary.model_dump(), indent=2, ensure_ascii=False))

    elif args.subcommand == "replay":
        spec_content = Path(args.spec).read_text(encoding="utf-8")
        spec_dict = json.loads(spec_content)
        schema_spec = SchemaSpec.model_validate(spec_dict)

        payload_content = Path(args.payload).read_text(encoding="utf-8")
        patched_payload = json.loads(payload_content)

        store = IngestStore(db_url=args.db_url)
        store.init_db()
        service = IngestService(store=store)

        try:
            record = asyncio.run(
                service.replay_quarantine_row(
                    quarantine_id=args.quarantine_id,
                    patched_payload=patched_payload,
                    spec=schema_spec,
                )
            )
            print(
                json.dumps(
                    {
                        "status": "REPLAYED",
                        "record_id": record.id,
                        "record_key": record.record_key,
                        "updated_at": record.updated_at.isoformat(),
                    },
                    indent=2,
                )
            )
        except ReplayValidationError as exc:
            print(f"Validation failed: {exc.errors}", file=sys.stderr)
            sys.exit(1)


if __name__ == "__main__":
    main()
