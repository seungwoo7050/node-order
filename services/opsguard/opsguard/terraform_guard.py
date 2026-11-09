from __future__ import annotations

from typing import Any

from opsguard.models import DriftItem, PolicyReport, Severity, Violation

DEFAULT_ALLOWED_INSTANCE_TYPES: frozenset[str] = frozenset(
    {"t3.micro", "t3.small", "t4g.micro", "t4g.small", "db.t3.micro", "db.t4g.micro"}
)

STATEFUL_RESOURCE_TYPES: frozenset[str] = frozenset(
    {"aws_db_instance", "aws_s3_bucket", "aws_ebs_volume"}
)

SENSITIVE_PORTS: frozenset[int] = frozenset({22, 5432, 6379})


def _is_public_cidr(cidr: str) -> bool:
    clean = cidr.strip()
    return clean in {"0.0.0.0/0", "::/0"}


def _ports_overlap_sensitive(from_port: int | None, to_port: int | None) -> list[int]:
    if from_port is None or to_port is None:
        return []
    if from_port == 0 and to_port == 0:
        return sorted(SENSITIVE_PORTS)
    return [p for p in sorted(SENSITIVE_PORTS) if from_port <= p <= to_port]


def evaluate_terraform_plan(
    plan_data: dict[str, Any],
    allowed_instance_types: set[str] | frozenset[str] | None = None,
) -> PolicyReport:
    """Evaluate a Terraform Plan JSON for destructive changes and security anti-patterns."""
    allowed_types = (
        DEFAULT_ALLOWED_INSTANCE_TYPES
        if allowed_instance_types is None
        else frozenset(allowed_instance_types)
    )

    violations: list[Violation] = []
    resource_changes: list[dict[str, Any]] = plan_data.get("resource_changes", [])

    for change_block in resource_changes:
        address: str = change_block.get("address", "unknown")
        res_type: str = change_block.get("type", "")
        change: dict[str, Any] = change_block.get("change", {})
        actions: list[str] = change.get("actions", [])
        after: dict[str, Any] = change.get("after") or {}

        # TF001: Destructive action on stateful resources
        if res_type in STATEFUL_RESOURCE_TYPES and "delete" in actions:
            violations.append(
                Violation(
                    rule_id="TF001",
                    severity=Severity.ERROR,
                    resource=address,
                    message=f"Destructive action {actions} on stateful resource '{res_type}' ({address})",
                    remediation="Prevent destruction of stateful resources; check lifecycle prevent_destroy or migration strategy.",
                )
            )

        # Skip creation/configuration checks if resource is purely being deleted
        if actions == ["delete"]:
            continue

        # TF002: Public ingress on sensitive ports
        if res_type == "aws_security_group":
            ingress_rules: list[dict[str, Any]] = after.get("ingress", []) or []
            for rule in ingress_rules:
                cidrs = (rule.get("cidr_blocks") or []) + (rule.get("ipv6_cidr_blocks") or [])
                if any(_is_public_cidr(str(c)) for c in cidrs):
                    fp = rule.get("from_port")
                    tp = rule.get("to_port")
                    try:
                        from_p = int(fp) if fp is not None else None
                        to_p = int(tp) if tp is not None else None
                    except (ValueError, TypeError):
                        from_p, to_p = None, None
                    exposed = _ports_overlap_sensitive(from_p, to_p)
                    if exposed:
                        violations.append(
                            Violation(
                                rule_id="TF002",
                                severity=Severity.ERROR,
                                resource=address,
                                message=f"Security group allows public ingress (0.0.0.0/0 or ::/0) to sensitive port(s) {exposed} on {address}",
                                remediation="Restrict ingress CIDR to trusted VPC/VPN blocks instead of 0.0.0.0/0 or ::/0.",
                            )
                        )

        elif res_type == "aws_security_group_rule":
            rule_type = after.get("type", "")
            if rule_type == "ingress":
                cidrs = (after.get("cidr_blocks") or []) + (after.get("ipv6_cidr_blocks") or [])
                if any(_is_public_cidr(str(c)) for c in cidrs):
                    fp = after.get("from_port")
                    tp = after.get("to_port")
                    try:
                        from_p = int(fp) if fp is not None else None
                        to_p = int(tp) if tp is not None else None
                    except (ValueError, TypeError):
                        from_p, to_p = None, None
                    exposed = _ports_overlap_sensitive(from_p, to_p)
                    if exposed:
                        violations.append(
                            Violation(
                                rule_id="TF002",
                                severity=Severity.ERROR,
                                resource=address,
                                message=f"Security group rule allows public ingress to sensitive port(s) {exposed} on {address}",
                                remediation="Restrict ingress CIDR to trusted VPC/VPN blocks instead of 0.0.0.0/0 or ::/0.",
                            )
                        )

        # TF003: Database encryption and backup retention
        if res_type == "aws_db_instance":
            storage_encrypted = after.get("storage_encrypted")
            if not storage_encrypted:
                violations.append(
                    Violation(
                        rule_id="TF003",
                        severity=Severity.ERROR,
                        resource=address,
                        message=f"Database instance '{address}' does not enable storage encryption (storage_encrypted=False/missing)",
                        remediation="Set storage_encrypted = true in aws_db_instance.",
                    )
                )

            retention = after.get("backup_retention_period")
            try:
                retention_days = int(retention) if retention is not None else 0
            except (ValueError, TypeError):
                retention_days = 0

            if retention_days < 1:
                violations.append(
                    Violation(
                        rule_id="TF003",
                        severity=Severity.ERROR,
                        resource=address,
                        message=f"Database instance '{address}' backup_retention_period is {retention_days} (must be >= 1 day)",
                        remediation="Set backup_retention_period >= 1 to ensure automated backups.",
                    )
                )

        # TF004: Budget protection on instance types
        instance_size: str | None = None
        if res_type == "aws_instance":
            instance_size = after.get("instance_type")
        elif res_type == "aws_db_instance":
            instance_size = after.get("instance_class")

        if instance_size and instance_size not in allowed_types:
            violations.append(
                Violation(
                    rule_id="TF004",
                    severity=Severity.ERROR,
                    resource=address,
                    message=f"Disallowed instance type/class '{instance_size}' for {address}. Allowed types: {sorted(allowed_types)}",
                    remediation=f"Change instance size to one of allowed list: {sorted(allowed_types)}.",
                )
            )

    return PolicyReport.create(target_type="terraform_plan", violations=violations)


def detect_terraform_drift(
    desired_resources: dict[str, dict[str, Any]],
    actual_snapshot: dict[str, dict[str, Any]],
) -> PolicyReport:
    """Compare desired infrastructure against actual cloud snapshot to detect configuration drift."""
    drifts: list[DriftItem] = []
    violations: list[Violation] = []

    # Check for missing resources or attribute discrepancies
    for addr, expected_attrs in desired_resources.items():
        if addr not in actual_snapshot:
            drifts.append(
                DriftItem(
                    resource_address=addr,
                    attribute="__existence__",
                    expected="present",
                    actual="missing",
                )
            )
            continue

        actual_attrs = actual_snapshot[addr]
        for attr, expected_val in expected_attrs.items():
            actual_val = actual_attrs.get(attr)
            if actual_val != expected_val:
                drifts.append(
                    DriftItem(
                        resource_address=addr,
                        attribute=attr,
                        expected=expected_val,
                        actual=actual_val,
                    )
                )

    # Check for unmanaged resources in runtime
    for addr in actual_snapshot:
        if addr not in desired_resources:
            drifts.append(
                DriftItem(
                    resource_address=addr,
                    attribute="__existence__",
                    expected="absent",
                    actual="present",
                )
            )

    if drifts:
        violations.append(
            Violation(
                rule_id="TF005",
                severity=Severity.ERROR,
                resource=drifts[0].resource_address,
                message=f"Infrastructure drift detected across {len(drifts)} attribute/resource discrepancy(ies)",
                remediation="Run terraform refresh or terraform apply to reconcile cloud state with declared code.",
            )
        )

    return PolicyReport.create(
        target_type="terraform_drift",
        violations=violations,
        drifts=drifts,
    )
