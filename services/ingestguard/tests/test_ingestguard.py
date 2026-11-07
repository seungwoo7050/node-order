from __future__ import annotations

import asyncio
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient

from ingestguard.app import create_app
from ingestguard.models import ColumnRule, IngestRequest, SchemaSpec
from ingestguard.replayer import (
    IngestService,
    MetricsCollector,
    QuarantineAlreadyReplayedError,
    QuarantineNotFoundError,
    ReplayValidationError,
)
from ingestguard.store import IngestStore


@pytest.fixture
def product_schema() -> SchemaSpec:
    return SchemaSpec(
        key_field="sku",
        fields={
            "sku": ColumnRule(type="str", required=True, min_length=3, max_length=30),
            "name": ColumnRule(type="str", required=True, min_length=1, max_length=100),
            "price": ColumnRule(type="float", required=True, ge=0.0),
            "stock": ColumnRule(type="int", required=True, ge=0),
            "is_active": ColumnRule(type="bool", required=False),
        },
    )


@pytest.fixture
def store() -> IngestStore:
    s = IngestStore(db_url="sqlite:///:memory:")
    s.init_db()
    return s


@pytest.fixture
def service(store: IngestStore) -> IngestService:
    return IngestService(store=store, metrics=MetricsCollector())


@pytest.mark.asyncio
async def test_csv_and_jsonl_mixed_ingest_with_quarantine(
    service: IngestService, product_schema: SchemaSpec
) -> None:
    # CSV content with 3 rows: row 1 valid, row 2 negative price (invalid), row 3 valid
    csv_content = (
        "sku,name,price,stock,is_active\n"
        "SKU-001,Widget Alpha,19.99,10,true\n"
        "SKU-002,Broken Beta,-5.00,0,false\n"
        "SKU-003,Widget Gamma,29.99,5,true\n"
    )

    req = IngestRequest(
        dataset="products",
        format_type="csv",
        schema_spec=product_schema,
        content=csv_content,
        chunk_size=2,
    )

    summary = await service.ingest_batch(req)

    assert summary.total_rows == 3
    assert summary.inserted_rows == 2
    assert summary.updated_rows == 0
    assert summary.skipped_rows == 0
    assert summary.quarantined_rows == 1
    assert summary.status == "PARTIAL_QUARANTINE"

    # Verify quarantine row
    q_rows = await service.store.get_quarantine_rows(summary.job_id)
    assert len(q_rows) == 1
    assert q_rows[0].row_number == 2
    assert q_rows[0].status == "PENDING"
    assert "Broken Beta" in q_rows[0].raw_payload_json

    # JSONL content with 2 rows: row 1 invalid stock string, row 2 valid
    jsonl_content = (
        '{"sku": "SKU-004", "name": "Delta Item", "price": 9.99, "stock": "invalid_number"}\n'
        '{"sku": "SKU-005", "name": "Epsilon Item", "price": 14.50, "stock": 50}\n'
    )

    req_jsonl = IngestRequest(
        dataset="products",
        format_type="jsonl",
        schema_spec=product_schema,
        content=jsonl_content,
        chunk_size=10,
    )

    summary_jsonl = await service.ingest_batch(req_jsonl)
    assert summary_jsonl.total_rows == 2
    assert summary_jsonl.inserted_rows == 1
    assert summary_jsonl.quarantined_rows == 1
    assert summary_jsonl.status == "PARTIAL_QUARANTINE"

    q_rows_jsonl = await service.store.get_quarantine_rows(summary_jsonl.job_id)
    assert len(q_rows_jsonl) == 1
    assert q_rows_jsonl[0].row_number == 1


@pytest.mark.asyncio
async def test_idempotent_upsert_and_hash_comparison(
    service: IngestService, product_schema: SchemaSpec
) -> None:
    initial_csv = (
        "sku,name,price,stock,is_active\n"
        "SKU-A,Item A,10.00,100,true\n"
        "SKU-B,Item B,20.00,200,true\n"
    )

    # First ingest
    req1 = IngestRequest(
        dataset="catalog",
        format_type="csv",
        schema_spec=product_schema,
        content=initial_csv,
    )
    s1 = await service.ingest_batch(req1)
    assert s1.inserted_rows == 2
    assert s1.skipped_rows == 0
    assert s1.updated_rows == 0
    assert s1.status == "COMPLETED"

    # Re-uploading identical content -> all rows skipped
    req2 = IngestRequest(
        dataset="catalog",
        format_type="csv",
        schema_spec=product_schema,
        content=initial_csv,
    )
    s2 = await service.ingest_batch(req2)
    assert s2.inserted_rows == 0
    assert s2.skipped_rows == 2
    assert s2.updated_rows == 0
    assert s2.status == "COMPLETED"

    # Uploading with 1 modified row and 1 identical row
    modified_csv = (
        "sku,name,price,stock,is_active\n"
        "SKU-A,Item A,15.50,90,true\n"  # price & stock modified
        "SKU-B,Item B,20.00,200,true\n"  # unchanged
    )
    req3 = IngestRequest(
        dataset="catalog",
        format_type="csv",
        schema_spec=product_schema,
        content=modified_csv,
    )
    s3 = await service.ingest_batch(req3)
    assert s3.inserted_rows == 0
    assert s3.updated_rows == 1
    assert s3.skipped_rows == 1
    assert s3.status == "COMPLETED"

    # Verify updated record in store
    records = await service.store.get_records("catalog")
    assert len(records) == 2
    sku_a_rec = next(r for r in records if r.record_key == "SKU-A")
    assert '"price": 15.5' in sku_a_rec.payload_json or '"price":15.5' in sku_a_rec.payload_json


@pytest.mark.asyncio
async def test_quarantine_replay_lifecycle(
    service: IngestService, product_schema: SchemaSpec
) -> None:
    bad_csv = "sku,name,price,stock\nSKU-ERR,Faulty Item,-99.0,10\n"
    req = IngestRequest(
        dataset="inventory",
        format_type="csv",
        schema_spec=product_schema,
        content=bad_csv,
    )
    summary = await service.ingest_batch(req)
    assert summary.quarantined_rows == 1

    q_rows = await service.store.get_quarantine_rows(summary.job_id)
    quarantine_id = q_rows[0].quarantine_id
    assert q_rows[0].status == "PENDING"

    # Attempt replay with invalid payload (price still negative)
    invalid_patch: dict[str, Any] = {
        "sku": "SKU-ERR",
        "name": "Faulty Item",
        "price": -10.0,
        "stock": 10,
    }
    with pytest.raises(ReplayValidationError) as exc_info:
        await service.replay_quarantine_row(
            quarantine_id=quarantine_id,
            patched_payload=invalid_patch,
            spec=product_schema,
        )
    assert len(exc_info.value.errors) > 0

    # Ensure quarantine row is STILL pending
    q_item_pending = await service.store.get_quarantine_row(quarantine_id)
    assert q_item_pending is not None
    assert q_item_pending.status == "PENDING"

    # Attempt replay with valid patch
    valid_patch: dict[str, Any] = {
        "sku": "SKU-ERR",
        "name": "Fixed Item",
        "price": 49.99,
        "stock": 10,
        "is_active": True,
    }
    promoted_record = await service.replay_quarantine_row(
        quarantine_id=quarantine_id,
        patched_payload=valid_patch,
        spec=product_schema,
    )
    assert promoted_record.record_key == "SKU-ERR"

    # Verify quarantine status transitioned to REPLAYED
    q_item_replayed = await service.store.get_quarantine_row(quarantine_id)
    assert q_item_replayed is not None
    assert q_item_replayed.status == "REPLAYED"
    assert q_item_replayed.replayed_at is not None

    # Verify present in ingested records
    records = await service.store.get_records("inventory")
    assert len(records) == 1
    assert records[0].record_key == "SKU-ERR"

    # Verify replaying an already replayed row raises QuarantineAlreadyReplayedError
    with pytest.raises(QuarantineAlreadyReplayedError):
        await service.replay_quarantine_row(
            quarantine_id=quarantine_id,
            patched_payload=valid_patch,
            spec=product_schema,
        )

    # Verify nonexistent quarantine id raises QuarantineNotFoundError
    with pytest.raises(QuarantineNotFoundError):
        await service.replay_quarantine_row(
            quarantine_id="nonexistent-id",
            patched_payload=valid_patch,
            spec=product_schema,
        )


@pytest.mark.asyncio
async def test_concurrent_batch_uploads_contention(product_schema: SchemaSpec) -> None:
    store = IngestStore(db_url="sqlite:///:memory:")
    store.init_db()
    service = IngestService(store=store)

    # Concurrently ingest overlapping and distinct batches
    batch1 = "sku,name,price,stock\nSKU-C1,Item C1,10.0,5\nSKU-COMMON,Common Item,20.0,10\n"
    batch2 = "sku,name,price,stock\nSKU-C2,Item C2,30.0,15\nSKU-COMMON,Common Item,20.0,10\n"
    batch3 = "sku,name,price,stock\nSKU-C3,Item C3,40.0,20\nSKU-COMMON,Common Item,25.0,12\n"

    req1 = IngestRequest(dataset="concurrency", format_type="csv", schema_spec=product_schema, content=batch1)
    req2 = IngestRequest(dataset="concurrency", format_type="csv", schema_spec=product_schema, content=batch2)
    req3 = IngestRequest(dataset="concurrency", format_type="csv", schema_spec=product_schema, content=batch3)

    summaries = await asyncio.gather(
        service.ingest_batch(req1),
        service.ingest_batch(req2),
        service.ingest_batch(req3),
    )

    assert len(summaries) == 3
    records = await service.store.get_records("concurrency", limit=100)
    keys = {r.record_key for r in records}
    assert "SKU-C1" in keys
    assert "SKU-C2" in keys
    assert "SKU-C3" in keys
    assert "SKU-COMMON" in keys
    assert len(records) == 4


@pytest.mark.asyncio
async def test_fastapi_e2e_endpoints(product_schema: SchemaSpec) -> None:
    app = create_app(db_url="sqlite:///:memory:")
    transport = ASGITransport(app=app)

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Healthz
        r_health = await client.get("/healthz")
        assert r_health.status_code == 200
        assert r_health.json()["status"] == "ok"

        # 2. Ingest batch via HTTP POST
        csv_payload = "sku,name,price,stock\nHTTP-01,Web Item,99.9,5\nHTTP-ERR,Bad,not_a_number,1\n"
        ingest_payload = {
            "dataset": "ecommerce",
            "format_type": "csv",
            "schema_spec": product_schema.model_dump(),
            "content": csv_payload,
            "chunk_size": 10,
        }
        r_ingest = await client.post("/v1/jobs/ingest", json=ingest_payload)
        assert r_ingest.status_code == 201
        job_data = r_ingest.json()
        job_id = job_data["job_id"]
        assert job_data["inserted_rows"] == 1
        assert job_data["quarantined_rows"] == 1
        assert job_data["status"] == "PARTIAL_QUARANTINE"

        # 3. GET /v1/jobs/{job_id}
        r_job = await client.get(f"/v1/jobs/{job_id}")
        assert r_job.status_code == 200
        assert r_job.json()["job_id"] == job_id

        # 4. GET /v1/jobs/{job_id}/quarantine
        r_quarantine = await client.get(f"/v1/jobs/{job_id}/quarantine")
        assert r_quarantine.status_code == 200
        q_list = r_quarantine.json()
        assert len(q_list) == 1
        q_id = q_list[0]["quarantine_id"]
        assert q_list[0]["row_number"] == 2

        # 5. POST /v1/quarantine/{quarantine_id}/replay with invalid payload -> 422
        bad_replay = {
            "patched_payload": {"sku": "HTTP-ERR", "name": "Bad", "price": -1.0, "stock": 1},
            "schema_spec": product_schema.model_dump(),
        }
        r_bad_replay = await client.post(f"/v1/quarantine/{q_id}/replay", json=bad_replay)
        assert r_bad_replay.status_code == 422
        assert "errors" in r_bad_replay.json()

        # 6. POST /v1/quarantine/{quarantine_id}/replay with valid payload -> 200
        good_replay = {
            "patched_payload": {"sku": "HTTP-ERR", "name": "Fixed Item", "price": 45.0, "stock": 10},
            "schema_spec": product_schema.model_dump(),
        }
        r_good_replay = await client.post(f"/v1/quarantine/{q_id}/replay", json=good_replay)
        assert r_good_replay.status_code == 200
        promoted = r_good_replay.json()
        assert promoted["record_key"] == "HTTP-ERR"

        # 7. GET /v1/datasets/{dataset}/records
        r_records = await client.get("/v1/datasets/ecommerce/records")
        assert r_records.status_code == 200
        records = r_records.json()
        assert len(records) == 2

        # 8. GET /metrics (Prometheus)
        r_metrics = await client.get("/metrics")
        assert r_metrics.status_code == 200
        assert "ingestguard_rows_inserted_total 1" in r_metrics.text
        assert "ingestguard_rows_quarantined_total 1" in r_metrics.text
        assert "ingestguard_rows_replayed_total 1" in r_metrics.text
