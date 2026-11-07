# ingestguard

커머스 상품 카탈로그, 정산 내역, B2B 데이터 이관처럼 대용량 CSV나 JSONL 데이터를 적재할 때, 일부 행의 스키마 오류 때문에 전체 배치가 실패하거나 재업로드 시 정상 데이터가 중복 적재되는 문제를 해결하는 스트리밍 청크 검증, `record_key` 멱등 Upsert, 불량 행 격리(Quarantine) 및 보정 재반영(Replay) 패키지 겸 독립 FastAPI 서버입니다.

## 왜 만들었나

- **전체 롤백(All-or-Nothing) 병목**: 수만 건의 배치 적재 중 단 몇 줄의 타입 불일치나 누락 필드로 인해 전체 트랜잭션이 롤백되면, 오류 행을 수작업으로 발라내기 전까지 전체 적재 파이프라인이 중단됩니다.
- **재업로드 시 무차별 쓰기와 중복 적재**: 오류 수정 후 파일 전체를 다시 업로드하면, 이미 성공했던 대다수의 정상 행까지 다시 쓰기 연산이 발생해 데이터베이스 락 경합과 스토리지 I/O 낭비가 발생합니다.
- **불량 데이터 유실과 사후 추적 부재**: 스키마 검증 실패 행을 애플리케이션 로그 파일에만 남겨두면, 운영자가 원본 데이터와 오류 원인을 파악하기 어렵고 데이터베이스에 수동 쿼리로 땜질 적재하다가 정합성이 깨집니다.

## 구조와 설계 판단

```
ingestguard/
├── models.py      SQLAlchemy 2.0 ORM 모델 및 Pydantic v2 스키마 정의
├── parser.py      CSV·JSONL 청크 스트리밍 제너레이터 및 동적 모델 검증기
├── store.py       SQLite/PostgreSQL 동기 엔진 기반 Unit-of-Work 저장소
├── replayer.py    배치 적재 오케스트레이션, 격리 행 재반영 및 Prometheus 메트릭
├── app.py         FastAPI Lifespan HTTP 서버 (/v1/jobs, /quarantine, /metrics)
└── cli.py         serve, ingest, replay 명령어를 제공하는 CLI 엔트리포인트
tests/
└── test_ingestguard.py   멱등 Upsert, 격리 전이, 동시성 경합 및 FastAPI E2E 검증
```

- **Pydantic v2 기반 청크 스트리밍 검증**: `io.StringIO`와 `csv.DictReader` 제너레이터를 사용해 전체 파일을 메모리에 적재하지 않고 `chunk_size` 단위로 끊어 검증합니다. `SchemaSpec` 규칙에 따라 동적 모델(`pydantic.create_model`)을 생성하고, 유효한 행(`ValidatedRow`)과 실패한 행(`RejectedRow`)을 분리해 반환합니다.
- **SHA-256 해시 비교 기반 멱등 Upsert**: 정상 행은 `(dataset, record_key)` 복합 키로 기존 레코드를 조회합니다. 데이터가 없으면 신규 `INSERT`하고, 존재하더라도 정렬된 JSON의 SHA-256 해시가 같으면 쓰기 없이 건너뛰며(`skipped_rows`), 내용이 달라진 경우에만 `UPDATE`를 수행합니다.
- **원자적 불량 행 격리(Quarantine)와 상태 승격(Replay)**: 검증에 실패한 행은 배치를 중단시키지 않고 `QuarantineRow(status="PENDING")` 테이블에 원본 페이로드와 세부 에러 내역을 보존합니다. 이후 운영자가 수정한 페이로드를 전달하면 동일한 `SchemaSpec`으로 재검증한 뒤 본 테이블로 승격하고 상태를 `REPLAYED`로 갱신합니다.
- **Unit-of-Work 스레드 격리와 동시성 보호**: 비동기 FastAPI 이벤트 루프가 동기 DB 드라이버 I/O로 블로킹되지 않도록 모든 트랜잭션 작업을 `asyncio.to_thread`로 분리했습니다. 특히 인메모리 SQLite 환경에서도 `StaticPool`과 `threading.Lock`을 결합해 다중 스레드 간 연결 충돌을 방지합니다.

## 사용법

### 1. 요구 환경
- Python 3.12 이상
- 주요 의존성: `fastapi`, `pydantic>=2.7`, `sqlalchemy>=2.0`, `uvicorn`, `httpx`, `pytest`

### 2. 서버 실행
```bash
# 기본 인메모리 SQLite 모드로 실행
python3 -m ingestguard.cli serve --host 0.0.0.0 --port 8000

# 파일 기반 SQLite 또는 PostgreSQL 실행
python3 -m ingestguard.cli serve --db-url "sqlite:///ingest.db" --port 8000
```

### 3. API 엔드포인트

| 메서드 | 경로 | 설명 |
|---|---|---|
| `POST` | `/v1/jobs/ingest` | CSV/JSONL 데이터 청크 스트리밍 적재 시작 |
| `GET` | `/v1/jobs/{job_id}` | 적재 작업 통계 및 상태(COMPLETED, PARTIAL_QUARANTINE) 조회 |
| `GET` | `/v1/jobs/{job_id}/quarantine` | 해당 작업에서 격리된 불량 행 목록 및 원본 페이로드 조회 |
| `POST` | `/v1/quarantine/{quarantine_id}/replay` | 보정된 페이로드 검증 후 본 테이블로 승격 반영 |
| `GET` | `/v1/datasets/{dataset}/records` | 적재된 정상 레코드 목록 조회 |
| `GET` | `/healthz` | 서비스 헬스체크 |
| `GET` | `/metrics` | Prometheus 텍스트 형식 메트릭 노출 |

### 4. CLI를 통한 직접 적재 및 재반영

```bash
# 배치 적재 실행
python3 -m ingestguard.cli ingest \
  --dataset products \
  --format csv \
  --spec schema.json \
  --input data.csv \
  --db-url sqlite:///ingest.db

# 격리 행 재반영
python3 -m ingestguard.cli replay \
  --id "quarantine-uuid" \
  --spec schema.json \
  --payload patch.json \
  --db-url sqlite:///ingest.db
```

## 테스트 실행

```bash
python3 -m pytest -v
```
