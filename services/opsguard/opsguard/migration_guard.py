from __future__ import annotations

import hashlib
import re
import sqlite3

from opsguard.models import MigrationReport, PolicyReport, RestoreDrillReport, Severity, Violation


def strip_sql_comments(sql: str) -> str:
    """Remove single-line and multi-line SQL comments."""
    # Remove /* ... */ comments
    no_block = re.sub(r"/\*.*?\*/", "", sql, flags=re.DOTALL)
    # Remove -- ... comments
    no_line = re.sub(r"--[^\n]*", "", no_block)
    return no_line


def evaluate_sql_migration(sql_text: str, allow_contract: bool = False) -> PolicyReport:
    """Analyze PostgreSQL migration scripts for exclusive-lock anti-patterns in Expand-Contract flows."""
    clean_sql = strip_sql_comments(sql_text)
    raw_statements = [s.strip() for s in clean_sql.split(";") if s.strip()]

    violations: list[Violation] = []

    for stmt_idx, raw_stmt in enumerate(raw_statements, start=1):
        norm = re.sub(r"\s+", " ", raw_stmt).strip().upper()
        res_label = f"statement-{stmt_idx}"

        # MIG001: DROP COLUMN or DROP TABLE (blocked when allow_contract is False)
        has_drop_col = bool(re.search(r"\bDROP\s+COLUMN\b", norm))
        has_drop_tbl = bool(re.search(r"\bDROP\s+TABLE\b", norm))
        if (has_drop_col or has_drop_tbl) and not allow_contract:
            action = "DROP COLUMN" if has_drop_col else "DROP TABLE"
            violations.append(
                Violation(
                    rule_id="MIG001",
                    severity=Severity.ERROR,
                    resource=res_label,
                    message=f"Destructive operation '{action}' detected during expand phase",
                    remediation="Postpone DROP statements to contract phase after all old service replicas are retired (allow_contract=True).",
                )
            )

        # MIG002: RENAME COLUMN or RENAME TO
        has_rename_col = bool(re.search(r"\bRENAME\s+COLUMN\b", norm))
        has_rename_tbl = bool(re.search(r"\bRENAME\s+TO\b", norm))
        if has_rename_col or has_rename_tbl:
            action = "RENAME COLUMN" if has_rename_col else "RENAME TABLE"
            violations.append(
                Violation(
                    rule_id="MIG002",
                    severity=Severity.ERROR,
                    resource=res_label,
                    message=f"Immediate renaming '{action}' breaks running applications querying the old identifier",
                    remediation="Apply expand-contract: add the new column/table, dual-write/backfill, then deprecate the legacy name.",
                )
            )

        # MIG003: ALTER COLUMN ... TYPE
        has_alter_type = bool(
            re.search(r"\bALTER\s+(?:COLUMN\s+)?[A-Z0-9_\"\`]+\s+TYPE\b", norm)
            or (re.search(r"\bALTER\s+COLUMN\b", norm) and re.search(r"\bTYPE\b", norm))
        )
        if has_alter_type:
            violations.append(
                Violation(
                    rule_id="MIG003",
                    severity=Severity.ERROR,
                    resource=res_label,
                    message="Direct ALTER COLUMN TYPE takes an exclusive table lock and can trigger a full table rewrite",
                    remediation="Add a new column with the target type, dual-write new records, backfill in batches, and switch readers.",
                )
            )

        # MIG004: ADD COLUMN ... NOT NULL without DEFAULT
        has_add_not_null = bool(
            re.search(r"\bADD\s+(?:COLUMN\s+)?[A-Z0-9_\"\`]+.*?\bNOT\s+NULL\b", norm)
        )
        has_default = "DEFAULT" in norm
        if has_add_not_null and not has_default:
            violations.append(
                Violation(
                    rule_id="MIG004",
                    severity=Severity.ERROR,
                    resource=res_label,
                    message="Adding a NOT NULL column without a DEFAULT value locks the table and fails on non-empty rows",
                    remediation="Provide DEFAULT clause or introduce the column as NULLable, backfill values, then apply NOT NULL constraint.",
                )
            )

        # MIG005: CREATE INDEX or DROP INDEX without CONCURRENTLY
        if re.search(r"\bCREATE\s+(?:UNIQUE\s+)?INDEX\b", norm):
            if not re.search(r"\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\b", norm):
                violations.append(
                    Violation(
                        rule_id="MIG005",
                        severity=Severity.ERROR,
                        resource=res_label,
                        message="CREATE INDEX without CONCURRENTLY locks the table against writes",
                        remediation="Append CONCURRENTLY keyword to CREATE INDEX.",
                    )
                )

        if re.search(r"\bDROP\s+INDEX\b", norm):
            if not re.search(r"\bDROP\s+INDEX\s+CONCURRENTLY\b", norm):
                violations.append(
                    Violation(
                        rule_id="MIG005",
                        severity=Severity.ERROR,
                        resource=res_label,
                        message="DROP INDEX without CONCURRENTLY locks the table against writes",
                        remediation="Append CONCURRENTLY keyword to DROP INDEX.",
                    )
                )

    return MigrationReport(
        target_type="sql_migration",
        passed=sum(1 for v in violations if v.severity == Severity.ERROR) == 0,
        error_count=sum(1 for v in violations if v.severity == Severity.ERROR),
        warning_count=sum(1 for v in violations if v.severity == Severity.WARNING),
        violations=violations,
        sql_statements_count=len(raw_statements),
        contract_allowed=allow_contract,
    )


def verify_backup_restore_drill(
    dump_sql: str,
    expected_sha256: str,
    required_tables: list[str],
) -> PolicyReport:
    """Validate database backup integrity via SHA-256 validation and SQLite in-memory restore drill."""
    violations: list[Violation] = []
    row_counts: dict[str, int] = {}

    # BAK001: SHA-256 verification
    actual_hash = hashlib.sha256(dump_sql.encode("utf-8")).hexdigest()
    if actual_hash.lower() != expected_sha256.strip().lower():
        violations.append(
            Violation(
                rule_id="BAK001",
                severity=Severity.ERROR,
                resource="dump_checksum",
                message=f"Backup SHA-256 checksum mismatch. Expected {expected_sha256}, got {actual_hash}",
                remediation="Ensure backup dump transfer integrity and cryptographic signature verification.",
            )
        )

    # In-memory SQLite restore verification
    conn = sqlite3.connect(":memory:")
    try:
        conn.executescript(dump_sql)
    except sqlite3.Error as exc:
        violations.append(
            Violation(
                rule_id="BAK002",
                severity=Severity.ERROR,
                resource="database_restore",
                message=f"Database dump execution failed during recovery drill: {exc}",
                remediation="Ensure dump SQL statements are syntactically valid and executable.",
            )
        )
        conn.close()
        return RestoreDrillReport(
            target_type="restore_drill",
            passed=False,
            error_count=len(violations),
            warning_count=0,
            violations=violations,
            expected_sha256=expected_sha256,
            actual_sha256=actual_hash,
            tables_checked=required_tables,
            row_counts=row_counts,
        )

    cursor = conn.cursor()

    # Discover existing tables
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
    existing_tables = {row[0] for row in cursor.fetchall()}

    # BAK002: Verify required tables and non-empty rows
    for req_table in required_tables:
        if req_table not in existing_tables:
            violations.append(
                Violation(
                    rule_id="BAK002",
                    severity=Severity.ERROR,
                    resource=f"table:{req_table}",
                    message=f"Required table '{req_table}' is missing after backup restore drill",
                    remediation="Check backup export schema configuration to include all critical business tables.",
                )
            )
            continue

        try:
            cursor.execute(f"SELECT COUNT(*) FROM \"{req_table}\";")
            count = int(cursor.fetchone()[0])
            row_counts[req_table] = count
            if count < 1:
                violations.append(
                    Violation(
                        rule_id="BAK002",
                        severity=Severity.ERROR,
                        resource=f"table:{req_table}",
                        message=f"Required table '{req_table}' is empty (0 rows) after restore",
                        remediation="Verify that backup dump contains production data and not just schema DDL.",
                    )
                )
        except sqlite3.Error as exc:
            violations.append(
                Violation(
                    rule_id="BAK002",
                    severity=Severity.ERROR,
                    resource=f"table:{req_table}",
                    message=f"Querying table '{req_table}' failed: {exc}",
                    remediation="Verify table schema integrity.",
                )
            )

    # BAK003: Check financial and payment invariants (negative amount check)
    target_amount_columns = {"amount", "total", "price", "payment_amount"}
    for table_name in existing_tables:
        cursor.execute(f"PRAGMA table_info(\"{table_name}\");")
        columns = [row[1] for row in cursor.fetchall()]
        matched_cols = [c for c in columns if c.lower() in target_amount_columns]

        for col in matched_cols:
            try:
                cursor.execute(f"SELECT COUNT(*) FROM \"{table_name}\" WHERE \"{col}\" < 0;")
                neg_count = int(cursor.fetchone()[0])
                if neg_count > 0:
                    violations.append(
                        Violation(
                            rule_id="BAK003",
                            severity=Severity.ERROR,
                            resource=f"{table_name}.{col}",
                            message=f"Financial invariant violated: found {neg_count} negative value(s) in {table_name}.{col}",
                            remediation="Ensure database constraints prevent negative financial values in ledger/order records.",
                        )
                    )

                cursor.execute(
                    f"SELECT COALESCE(SUM(\"{col}\"), 0) FROM \"{table_name}\";"
                )
                col_sum = float(cursor.fetchone()[0])
                if col_sum < 0:
                    violations.append(
                        Violation(
                            rule_id="BAK003",
                            severity=Severity.ERROR,
                            resource=f"{table_name}.{col}",
                            message=f"Financial invariant violated: column sum is negative ({col_sum}) in {table_name}.{col}",
                            remediation="Audit transaction log for balance discrepancies and reconciliation defects.",
                        )
                    )
            except sqlite3.Error:
                pass

    conn.close()

    error_count = sum(1 for v in violations if v.severity == Severity.ERROR)
    warning_count = sum(1 for v in violations if v.severity == Severity.WARNING)

    return RestoreDrillReport(
        target_type="restore_drill",
        passed=error_count == 0,
        error_count=error_count,
        warning_count=warning_count,
        violations=violations,
        expected_sha256=expected_sha256,
        actual_sha256=actual_hash,
        tables_checked=required_tables,
        row_counts=row_counts,
    )
