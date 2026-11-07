"""CLI entrypoint for driftwatch server and manual check commands."""

from __future__ import annotations

import argparse
import asyncio
import sys

import uvicorn

from driftwatch.app import create_app
from driftwatch.runner import DriftRunner
from driftwatch.store import DriftStore


def parse_args(args: list[str] | None = None) -> argparse.Namespace:
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(
        prog="driftwatch",
        description="Fact drift detector and debounce alert engine",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    # serve command
    serve_parser = subparsers.add_parser("serve", help="Run driftwatch HTTP API and poller")
    serve_parser.add_argument("--host", default="0.0.0.0", help="Bind host (default: 0.0.0.0)")
    serve_parser.add_argument("--port", type=int, default=8000, help="Bind port (default: 8000)")
    serve_parser.add_argument(
        "--db",
        default="sqlite:///driftwatch.db",
        help="Database URL (default: sqlite:///driftwatch.db)",
    )
    serve_parser.add_argument(
        "--poll-interval",
        type=float,
        default=30.0,
        help="Background poller interval in seconds (0 to disable)",
    )

    # check command
    check_parser = subparsers.add_parser("check", help="Execute on-demand checks")
    check_parser.add_argument(
        "--db",
        default="sqlite:///driftwatch.db",
        help="Database URL",
    )
    check_parser.add_argument(
        "--target-id",
        help="Target ID to check",
    )
    check_parser.add_argument(
        "--all",
        action="store_true",
        help="Check all due targets",
    )

    # init-db command
    init_parser = subparsers.add_parser("init-db", help="Initialize database tables")
    init_parser.add_argument(
        "--db",
        default="sqlite:///driftwatch.db",
        help="Database URL",
    )

    return parser.parse_args(args)


async def _run_check(db_url: str, target_id: str | None, check_all: bool) -> None:
    store = DriftStore(db_url=db_url)
    runner = DriftRunner(store=store)

    if target_id:
        result = await runner.check_target(target_id)
        print(f"Target: {result.target_id} | Status: {result.status} | Value: {result.extracted_value} | Alert: {result.alert_type}")
    elif check_all:
        results = await runner.check_due_targets()
        print(f"Completed {len(results)} due target checks.")
        for r in results:
            print(f"- {r.target_id}: status={r.status}, value={r.extracted_value}, alert={r.alert_type}")
    else:
        print("Specify either --target-id <id> or --all")


def main(argv: list[str] | None = None) -> None:
    """CLI application entrypoint."""
    args = parse_args(argv if argv is not None else sys.argv[1:])

    if args.command == "serve":
        store = DriftStore(db_url=args.db)
        runner = DriftRunner(store=store)
        app = create_app(store=store, runner=runner, poll_interval=args.poll_interval)
        uvicorn.run(app, host=args.host, port=args.port)

    elif args.command == "check":
        asyncio.run(_run_check(args.db, args.target_id, args.all))

    elif args.command == "init-db":
        store = DriftStore(db_url=args.db)
        store.create_tables()
        print(f"Database schema initialized successfully for {args.db}")


if __name__ == "__main__":
    main()
