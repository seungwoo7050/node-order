from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

import typer

from opsguard.k8s_guard import evaluate_k8s_manifests
from opsguard.migration_guard import evaluate_sql_migration, verify_backup_restore_drill
from opsguard.models import PolicyReport
from opsguard.terraform_guard import detect_terraform_drift, evaluate_terraform_plan

cli_app = typer.Typer(
    name="opsguard",
    help="OpsGuard: Declarative infrastructure policy validator and migration linter CLI",
    add_completion=False,
)


def _render_report(report: PolicyReport) -> None:
    target = report.target_type.upper()
    typer.echo(f"\n[OpsGuard] Verification Result for {target}")
    typer.echo("=" * 60)

    if report.violations:
        for idx, v in enumerate(report.violations, start=1):
            color = typer.colors.RED if v.severity.value == "ERROR" else typer.colors.YELLOW
            typer.secho(
                f"[{idx}] {v.severity.value} [{v.rule_id}] on {v.resource}",
                fg=color,
                bold=True,
            )
            typer.echo(f"    Message:     {v.message}")
            typer.echo(f"    Remediation: {v.remediation}")

    if report.drifts:
        typer.secho(f"\nDiscovered {len(report.drifts)} drift item(s):", fg=typer.colors.CYAN)
        for d in report.drifts:
            typer.echo(
                f"  - {d.resource_address}.{d.attribute} (expected: {d.expected!r}, actual: {d.actual!r})"
            )

    typer.echo("-" * 60)
    summary_text = (
        f"Passed: {report.passed} | Errors: {report.error_count} | Warnings: {report.warning_count}"
    )
    if report.passed:
        typer.secho(f"STATUS: SUCCESS - {summary_text}", fg=typer.colors.GREEN, bold=True)
    else:
        typer.secho(f"STATUS: FAILED  - {summary_text}", fg=typer.colors.RED, bold=True)
        raise typer.Exit(code=1)


@cli_app.command(name="terraform")
def check_terraform(
    path: Path = typer.Argument(..., help="Path to Terraform Plan JSON or desired state JSON"),
    actual_path: Optional[Path] = typer.Option(
        None,
        "--actual",
        "-a",
        help="Optional path to actual runtime snapshot JSON to trigger drift detection",
    ),
    allowed_types: Optional[list[str]] = typer.Option(
        None,
        "--allowed-type",
        help="Allowed compute or database instance types (can specify multiple)",
    ),
) -> None:
    """Validate Terraform Plan JSON or detect configuration drift against runtime snapshot."""
    if not path.exists():
        typer.secho(f"Error: File not found: {path}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=2)

    content = json.loads(path.read_text(encoding="utf-8"))

    if actual_path is not None:
        if not actual_path.exists():
            typer.secho(f"Error: Actual snapshot file not found: {actual_path}", fg=typer.colors.RED, err=True)
            raise typer.Exit(code=2)
        actual_content = json.loads(actual_path.read_text(encoding="utf-8"))
        report = detect_terraform_drift(desired_resources=content, actual_snapshot=actual_content)
    else:
        allowed = set(allowed_types) if allowed_types else None
        report = evaluate_terraform_plan(content, allowed_instance_types=allowed)

    _render_report(report)


@cli_app.command(name="k8s")
def check_k8s(
    path: Path = typer.Argument(..., help="Path to Kubernetes/Helm YAML manifest"),
) -> None:
    """Validate Kubernetes manifests and Argo Rollouts for production invariants."""
    if not path.exists():
        typer.secho(f"Error: File not found: {path}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=2)

    yaml_text = path.read_text(encoding="utf-8")
    report = evaluate_k8s_manifests(yaml_text)
    _render_report(report)


@cli_app.command(name="migration")
def check_migration(
    path: Path = typer.Argument(..., help="Path to SQL migration file"),
    allow_contract: bool = typer.Option(
        False,
        "--allow-contract",
        help="Allow destructive drop operations during contracted deprecation stage",
    ),
) -> None:
    """Lint SQL migration for zero-downtime expand-contract violations."""
    if not path.exists():
        typer.secho(f"Error: File not found: {path}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=2)

    sql_text = path.read_text(encoding="utf-8")
    report = evaluate_sql_migration(sql_text, allow_contract=allow_contract)
    _render_report(report)


@cli_app.command(name="restore")
def check_restore(
    path: Path = typer.Argument(..., help="Path to SQL database dump file"),
    sha256: str = typer.Option(..., "--sha256", "-s", help="Expected SHA-256 checksum"),
    tables: list[str] = typer.Option(
        ...,
        "--table",
        "-t",
        help="Required table name expected to exist and hold records",
    ),
) -> None:
    """Execute SQLite in-memory backup restore drill and verify data integrity."""
    if not path.exists():
        typer.secho(f"Error: File not found: {path}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=2)

    dump_sql = path.read_text(encoding="utf-8")
    report = verify_backup_restore_drill(
        dump_sql=dump_sql,
        expected_sha256=sha256,
        required_tables=tables,
    )
    _render_report(report)


def main() -> None:
    cli_app()


if __name__ == "__main__":
    main()
