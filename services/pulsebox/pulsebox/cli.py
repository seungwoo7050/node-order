from __future__ import annotations

import argparse
import asyncio
import sys

import uvicorn

from pulsebox.app import create_app
from pulsebox.store import PulseStore
from pulsebox.watchdog import PulseWatchdog


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="pulsebox",
        description="Lightweight error fingerprinting and cron dead man's switch daemon",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    # Server subcommand
    server_parser = subparsers.add_parser("server", help="Run the pulsebox API server")
    server_parser.add_argument("--host", default="127.0.0.1", help="Host address to bind")
    server_parser.add_argument("--port", type=int, default=8000, help="Port to bind")
    server_parser.add_argument(
        "--db", default="sqlite:///pulsebox.db", help="SQLAlchemy database URL"
    )
    server_parser.add_argument("--webhook-url", default=None, help="Default alert webhook URL")
    server_parser.add_argument(
        "--enable-watchdog",
        action="store_true",
        default=True,
        help="Enable background watchdog loop",
    )

    # Scan subcommand
    scan_parser = subparsers.add_parser(
        "scan", help="Run an immediate scan for overdue cron monitors"
    )
    scan_parser.add_argument(
        "--db", default="sqlite:///pulsebox.db", help="SQLAlchemy database URL"
    )

    # Ping subcommand
    ping_parser = subparsers.add_parser("ping", help="Record a check-in ping for a cron monitor")
    ping_parser.add_argument("slug", help="Monitor slug identifier")
    ping_parser.add_argument(
        "--db", default="sqlite:///pulsebox.db", help="SQLAlchemy database URL"
    )

    # Issues subcommand
    issues_parser = subparsers.add_parser("issues", help="List tracked error issues")
    issues_parser.add_argument(
        "--db", default="sqlite:///pulsebox.db", help="SQLAlchemy database URL"
    )
    issues_parser.add_argument("--service", default=None, help="Filter issues by service name")

    return parser


async def _run_scan(db_url: str) -> None:
    store = PulseStore(database_url=db_url)
    watchdog = PulseWatchdog(store=store)
    alerted = await watchdog.scan_monitors()
    if not alerted:
        print("All cron monitors are on schedule. No overdue monitors found.")
        return
    print(f"Alerted {len(alerted)} overdue cron monitors:")
    for m in alerted:
        print(f"  - {m.slug} (service={m.service}, misses={m.consecutive_misses})")


async def _run_ping(slug: str, db_url: str) -> None:
    store = PulseStore(database_url=db_url)
    try:
        mon = await store.record_ping(slug=slug)
        print(
            f"Check-in recorded for {mon.slug}. Status={mon.status}, next due at {mon.next_due_at}"
        )
    except KeyError as err:
        print(f"Error: {err}", file=sys.stderr)
        sys.exit(1)


async def _run_issues(db_url: str, service: str | None) -> None:
    store = PulseStore(database_url=db_url)
    issues = await store.list_issues(service=service)
    if not issues:
        print("No error issues found.")
        return
    print(f"Found {len(issues)} issue groups:")
    for iss in issues:
        print(
            f"  [{iss.status}] {iss.fingerprint[:12]}.. {iss.service} "
            f"({iss.occurrence_count} occurrences) - {iss.title}"
        )


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    if args.command == "server":
        store = PulseStore(database_url=args.db)
        watchdog = PulseWatchdog(store=store, default_webhook_url=args.webhook_url)
        app = create_app(
            store=store,
            watchdog=watchdog,
            enable_background_watchdog=args.enable_watchdog,
        )
        uvicorn.run(app, host=args.host, port=args.port)
    elif args.command == "scan":
        asyncio.run(_run_scan(args.db))
    elif args.command == "ping":
        asyncio.run(_run_ping(args.slug, args.db))
    elif args.command == "issues":
        asyncio.run(_run_issues(args.db, args.service))


if __name__ == "__main__":
    main()
