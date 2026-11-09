from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import httpx
import pytest
from httpx import ASGITransport
from typer.testing import CliRunner

from opsguard.api import app
from opsguard.cli import cli_app
from opsguard.k8s_guard import evaluate_k8s_manifests
from opsguard.migration_guard import evaluate_sql_migration, verify_backup_restore_drill
from opsguard.terraform_guard import detect_terraform_drift, evaluate_terraform_plan

runner = CliRunner()


# ---------------------------------------------------------------------------
# 1. Terraform Plan Tests (TF001, TF002, TF003, TF004)
# ---------------------------------------------------------------------------
def test_terraform_rules_tf001_to_tf004() -> None:
    # Plan containing TF001 (delete stateful), TF002 (port 22 0.0.0.0/0),
    # TF003 (unencrypted DB & retention 0), TF004 (expensive instance)
    bad_plan: dict[str, Any] = {
        "resource_changes": [
            {
                "address": "aws_s3_bucket.user_data",
                "type": "aws_s3_bucket",
                "change": {"actions": ["delete"]},
            },
            {
                "address": "aws_security_group.ingress_web",
                "type": "aws_security_group",
                "change": {
                    "actions": ["create"],
                    "after": {
                        "ingress": [
                            {
                                "from_port": 22,
                                "to_port": 22,
                                "cidr_blocks": ["0.0.0.0/0"],
                            }
                        ]
                    },
                },
            },
            {
                "address": "aws_db_instance.main",
                "type": "aws_db_instance",
                "change": {
                    "actions": ["create"],
                    "after": {
                        "storage_encrypted": False,
                        "backup_retention_period": 0,
                        "instance_class": "db.m5.24xlarge",
                    },
                },
            },
            {
                "address": "aws_instance.worker",
                "type": "aws_instance",
                "change": {
                    "actions": ["create"],
                    "after": {"instance_type": "c5.metal"},
                },
            },
        ]
    }

    report = evaluate_terraform_plan(bad_plan)
    assert not report.passed
    assert report.error_count >= 5

    rule_ids = {v.rule_id for v in report.violations}
    assert "TF001" in rule_ids
    assert "TF002" in rule_ids
    assert "TF003" in rule_ids
    assert "TF004" in rule_ids

    # Valid plan
    valid_plan: dict[str, Any] = {
        "resource_changes": [
            {
                "address": "aws_db_instance.replica",
                "type": "aws_db_instance",
                "change": {
                    "actions": ["create"],
                    "after": {
                        "storage_encrypted": True,
                        "backup_retention_period": 7,
                        "instance_class": "db.t3.micro",
                    },
                },
            },
            {
                "address": "aws_security_group.db_private",
                "type": "aws_security_group",
                "change": {
                    "actions": ["create"],
                    "after": {
                        "ingress": [
                            {
                                "from_port": 5432,
                                "to_port": 5432,
                                "cidr_blocks": ["10.0.0.0/16"],
                            }
                        ]
                    },
                },
            },
        ]
    }
    valid_report = evaluate_terraform_plan(valid_plan)
    assert valid_report.passed
    assert valid_report.error_count == 0


# ---------------------------------------------------------------------------
# 2. Terraform Drift Tests (TF005)
# ---------------------------------------------------------------------------
def test_terraform_drift_tf005() -> None:
    desired: dict[str, dict[str, Any]] = {
        "aws_s3_bucket.data": {"bucket": "prod-data", "versioning": True},
        "aws_instance.web": {"instance_type": "t3.micro", "monitoring": True},
    }
    actual_drifted: dict[str, dict[str, Any]] = {
        # versioning drifted to False
        "aws_s3_bucket.data": {"bucket": "prod-data", "versioning": False},
        # aws_instance.web is missing
        # unmanaged shadow resource exists
        "aws_iam_user.shadow_admin": {"name": "shadow_admin"},
    }

    report = detect_terraform_drift(desired, actual_drifted)
    assert not report.passed
    assert report.error_count == 1
    assert report.violations[0].rule_id == "TF005"
    assert len(report.drifts) == 3

    # Exact match without drift
    clean_actual: dict[str, dict[str, Any]] = {
        "aws_s3_bucket.data": {"bucket": "prod-data", "versioning": True},
        "aws_instance.web": {"instance_type": "t3.micro", "monitoring": True},
    }
    clean_report = detect_terraform_drift(desired, clean_actual)
    assert clean_report.passed
    assert len(clean_report.drifts) == 0


# ---------------------------------------------------------------------------
# 3. Kubernetes Invariants (K8S001, K8S002, K8S003)
# ---------------------------------------------------------------------------
def test_k8s_workload_invariants_k8s001_to_k8s003() -> None:
    bad_yaml = """
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-service
spec:
  template:
    spec:
      containers:
        - name: app
          image: mycorp/orders:latest
          # missing resources (memory request & limit)
          # missing livenessProbe & readinessProbe
"""
    report = evaluate_k8s_manifests(bad_yaml)
    assert not report.passed
    rule_ids = {v.rule_id for v in report.violations}
    assert "K8S001" in rule_ids
    assert "K8S002" in rule_ids
    assert "K8S003" in rule_ids

    # Compliant Deployment
    valid_yaml = """
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-service
spec:
  template:
    spec:
      containers:
        - name: app
          image: mycorp/orders:v1.4.2
          resources:
            requests:
              memory: "256Mi"
            limits:
              memory: "512Mi"
          readinessProbe:
            httpGet:
              path: /ready
              port: 8080
          livenessProbe:
            httpGet:
              path: /health
              port: 8080
"""
    valid_report = evaluate_k8s_manifests(valid_yaml)
    assert valid_report.passed
    assert len(valid_report.violations) == 0


# ---------------------------------------------------------------------------
# 4. Argo Rollouts Canary Rules (ARGO001)
# ---------------------------------------------------------------------------
def test_argo_rollout_canary_argo001() -> None:
    # Non-monotonic weights and missing analysis
    bad_rollout = """
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: frontend-rollout
spec:
  strategy:
    canary:
      steps:
        - setWeight: 50
        - setWeight: 20
"""
    report = evaluate_k8s_manifests(bad_rollout)
    assert not report.passed
    assert any(v.rule_id == "ARGO001" for v in report.violations)

    # Valid Rollout with monotonically increasing weights and analysis
    valid_rollout = """
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: frontend-rollout
spec:
  template:
    spec:
      containers:
        - name: web
          image: myregistry.io/frontend:v2.0.0
          resources:
            requests:
              memory: "128Mi"
            limits:
              memory: "256Mi"
          readinessProbe:
            httpGet:
              path: /healthz
              port: 3000
          livenessProbe:
            httpGet:
              path: /healthz
              port: 3000
  strategy:
    canary:
      steps:
        - setWeight: 10
        - analysis:
            templates:
              - templateName: error-rate-check
        - setWeight: 50
        - analysis:
            templates:
              - templateName: latency-check
        - setWeight: 100
"""
    valid_report = evaluate_k8s_manifests(valid_rollout)
    assert valid_report.passed
    assert len(valid_report.violations) == 0


# ---------------------------------------------------------------------------
# 5. SQL Migration Expand-Contract (MIG001, MIG002, MIG003)
# ---------------------------------------------------------------------------
def test_migration_destructive_and_locks_mig001_to_mig003() -> None:
    # MIG001 (DROP), MIG002 (RENAME), MIG003 (ALTER TYPE)
    sql = """
    -- Migration step 1
    ALTER TABLE users DROP COLUMN legacy_phone;
    ALTER TABLE accounts RENAME COLUMN balance TO remaining_funds;
    ALTER TABLE orders ALTER COLUMN status TYPE VARCHAR(100);
    """

    # In expand phase (allow_contract=False)
    report = evaluate_sql_migration(sql, allow_contract=False)
    assert not report.passed
    rule_ids = {v.rule_id for v in report.violations}
    assert "MIG001" in rule_ids
    assert "MIG002" in rule_ids
    assert "MIG003" in rule_ids

    # In contract phase (allow_contract=True): DROP is permitted, but RENAME & ALTER TYPE still rejected
    contract_report = evaluate_sql_migration(sql, allow_contract=True)
    c_rules = {v.rule_id for v in contract_report.violations}
    assert "MIG001" not in c_rules
    assert "MIG002" in c_rules
    assert "MIG003" in c_rules


# ---------------------------------------------------------------------------
# 6. SQL Migration Column NOT NULL & Concurrency (MIG004, MIG005)
# ---------------------------------------------------------------------------
def test_migration_not_null_and_concurrent_indexes_mig004_to_mig005() -> None:
    unsafe_sql = """
    ALTER TABLE users ADD COLUMN age INT NOT NULL;
    CREATE INDEX idx_users_email ON users(email);
    DROP INDEX idx_orders_customer_id;
    """
    report = evaluate_sql_migration(unsafe_sql)
    assert not report.passed
    rule_ids = {v.rule_id for v in report.violations}
    assert "MIG004" in rule_ids
    assert "MIG005" in rule_ids

    safe_sql = """
    ALTER TABLE users ADD COLUMN age INT NOT NULL DEFAULT 18;
    CREATE INDEX CONCURRENTLY idx_users_email ON users(email);
    DROP INDEX CONCURRENTLY idx_orders_customer_id;
    """
    safe_report = evaluate_sql_migration(safe_sql)
    assert safe_report.passed
    assert len(safe_report.violations) == 0


# ---------------------------------------------------------------------------
# 7. Backup Restore Drill Invariants (BAK001, BAK002, BAK003)
# ---------------------------------------------------------------------------
def test_backup_restore_drill_bak001_to_bak003() -> None:
    valid_dump = """
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
    INSERT INTO users (id, name) VALUES (1, 'Alice');
    CREATE TABLE payments (id INTEGER PRIMARY KEY, amount REAL);
    INSERT INTO payments (id, amount) VALUES (1, 150.0), (2, 45.5);
    """
    sha256_hash = hashlib.sha256(valid_dump.encode("utf-8")).hexdigest()

    # Successful restore drill
    success_report = verify_backup_restore_drill(
        dump_sql=valid_dump,
        expected_sha256=sha256_hash,
        required_tables=["users", "payments"],
    )
    assert success_report.passed
    assert success_report.error_count == 0

    # BAK001: Bad SHA256
    bad_hash_report = verify_backup_restore_drill(
        dump_sql=valid_dump,
        expected_sha256="0000000000000000000000000000000000000000000000000000000000000000",
        required_tables=["users"],
    )
    assert any(v.rule_id == "BAK001" for v in bad_hash_report.violations)

    # BAK002: Missing required table or 0 rows
    empty_dump = """
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
    """
    empty_hash = hashlib.sha256(empty_dump.encode("utf-8")).hexdigest()
    missing_report = verify_backup_restore_drill(
        dump_sql=empty_dump,
        expected_sha256=empty_hash,
        required_tables=["users", "audit_logs"],
    )
    assert any(v.rule_id == "BAK002" for v in missing_report.violations)

    # BAK003: Negative amount invariant in financial table
    corrupted_dump = """
    CREATE TABLE payments (id INTEGER PRIMARY KEY, amount REAL);
    INSERT INTO payments (id, amount) VALUES (1, -500.0);
    """
    corr_hash = hashlib.sha256(corrupted_dump.encode("utf-8")).hexdigest()
    invariant_report = verify_backup_restore_drill(
        dump_sql=corrupted_dump,
        expected_sha256=corr_hash,
        required_tables=["payments"],
    )
    assert any(v.rule_id == "BAK003" for v in invariant_report.violations)


# ---------------------------------------------------------------------------
# 8. FastAPI Endpoints & Prometheus Metrics
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_fastapi_endpoints_and_audit_metrics(tmp_path: Path) -> None:
    import os

    import aiosqlite
    from sqlalchemy import create_engine

    from opsguard.models import Base

    test_db = tmp_path / "test_api_audit.db"
    os.environ["OPSGUARD_DB_PATH"] = str(test_db)
    sync_engine = create_engine(f"sqlite:///{test_db}")
    Base.metadata.create_all(sync_engine)
    sync_engine.dispose()

    transport = ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        # GET /healthz
        res_health = await client.get("/healthz")
        assert res_health.status_code == 200
        assert res_health.json()["service"] == "opsguard"

        # POST /v1/verify/terraform
        tf_payload = {
            "plan": {
                "resource_changes": [
                    {
                        "address": "aws_s3_bucket.archive",
                        "type": "aws_s3_bucket",
                        "change": {"actions": ["delete"]},
                    }
                ]
            }
        }
        res_tf = await client.post("/v1/verify/terraform", json=tf_payload)
        assert res_tf.status_code == 200
        assert not res_tf.json()["passed"]

        # POST /v1/verify/k8s
        k8s_payload = {
            "manifest_yaml": "apiVersion: v1\nkind: Pod\nmetadata:\n  name: simple\n"
        }
        res_k8s = await client.post("/v1/verify/k8s", json=k8s_payload)
        assert res_k8s.status_code == 200
        assert res_k8s.json()["passed"]

        # POST /v1/verify/migration
        mig_payload = {
            "sql_text": "ALTER TABLE users DROP COLUMN email;",
            "allow_contract": False,
        }
        res_mig = await client.post("/v1/verify/migration", json=mig_payload)
        assert res_mig.status_code == 200
        assert not res_mig.json()["passed"]

        # POST /v1/verify/restore
        dump_text = "CREATE TABLE orders (id INT, amount REAL); INSERT INTO orders VALUES (1, 10.0);"
        hash_val = hashlib.sha256(dump_text.encode("utf-8")).hexdigest()
        restore_payload = {
            "dump_sql": dump_text,
            "expected_sha256": hash_val,
            "required_tables": ["orders"],
        }
        res_restore = await client.post("/v1/verify/restore", json=restore_payload)
        assert res_restore.status_code == 200
        assert res_restore.json()["passed"]

        # GET /metrics
        res_metrics = await client.get("/metrics")
        assert res_metrics.status_code == 200
        assert "opsguard_checks_total" in res_metrics.text

    # Verify audit records in SQLite
    async with aiosqlite.connect(str(test_db)) as db:
        async with db.execute("SELECT count(*) FROM audit_records") as cursor:
            row = await cursor.fetchone()
            assert row is not None
            assert row[0] == 4


# ---------------------------------------------------------------------------
# 9. Typer CLI Commands
# ---------------------------------------------------------------------------
def test_typer_cli_commands(tmp_path: Path) -> None:
    # 1. CLI terraform
    tf_file = tmp_path / "plan.json"
    tf_file.write_text(
        json.dumps(
            {
                "resource_changes": [
                    {
                        "address": "aws_db_instance.db",
                        "type": "aws_db_instance",
                        "change": {"actions": ["delete"]},
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    result_tf = runner.invoke(cli_app, ["terraform", str(tf_file)])
    assert result_tf.exit_code == 1
    assert "TF001" in result_tf.stdout

    # 2. CLI k8s
    k8s_file = tmp_path / "deploy.yaml"
    k8s_file.write_text(
        """
apiVersion: apps/v1
kind: Deployment
metadata:
  name: test-app
spec:
  template:
    spec:
      containers:
        - name: app
          image: app:latest
""",
        encoding="utf-8",
    )
    result_k8s = runner.invoke(cli_app, ["k8s", str(k8s_file)])
    assert result_k8s.exit_code == 1
    assert "K8S001" in result_k8s.stdout

    # 3. CLI migration
    mig_file = tmp_path / "mig.sql"
    mig_file.write_text("ALTER TABLE users DROP COLUMN test;", encoding="utf-8")
    result_mig = runner.invoke(cli_app, ["migration", str(mig_file)])
    assert result_mig.exit_code == 1
    assert "MIG001" in result_mig.stdout

    result_mig_contract = runner.invoke(cli_app, ["migration", str(mig_file), "--allow-contract"])
    assert result_mig_contract.exit_code == 0
    assert "SUCCESS" in result_mig_contract.stdout

    # 4. CLI restore
    dump_file = tmp_path / "dump.sql"
    dump_content = "CREATE TABLE users (id INT); INSERT INTO users VALUES (1);"
    dump_file.write_text(dump_content, encoding="utf-8")
    sha256_val = hashlib.sha256(dump_content.encode("utf-8")).hexdigest()

    result_restore = runner.invoke(
        cli_app,
        ["restore", str(dump_file), "--sha256", sha256_val, "--table", "users"],
    )
    assert result_restore.exit_code == 0
    assert "SUCCESS" in result_restore.stdout
