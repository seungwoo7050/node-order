# OpsGuard

선언형 인프라(Terraform, Kubernetes, Argo Rollouts) 정책 검증기와 PostgreSQL 무중단 마이그레이션(Expand-Contract) DDL 린터 및 백업 복원 검증 엔진입니다.

배포 파이프라인(CI/CD) 직전 단계에서 파괴적인 인프라 변경, 보안 그룹 오설정, 컨테이너 리소스 누락, 테이블 락 유발 DDL, 손상된 데이터베이스 덤프를 사전에 차단합니다.

```text
                  +-----------------------------------------+
                  |         CI/CD Pipeline / Engineer       |
                  +----+--------------------+----------+----+
                       |                    |          |
                       v                    v          v
               +---------------+    +---------------+  |
               | opsguard CLI  |    | opsguard API  |  |
               +-------+-------+    +-------+-------+  |
                       |                    |          |
       +---------------+--------------------+----------+
       |
       +---> [Terraform Guard]
       |     - Plan 파괴적 변경 차단 (TF001: DB/S3/EBS 삭제 방지)
       |     - 민감 포트(22, 5432, 6379) 공용 인바운드 차단 (TF002)
       |     - 암호화 및 백업 보존 주기 검증 (TF003)
       |     - 인스턴스 타입 허용 목록 제한 (TF004)
       |     - 런타임 스냅샷 대조 드리프트 감지 (TF005)
       |
       +---> [Kubernetes / Argo Guard]
       |     - 태그 누락 및 :latest 태그 차단 (K8S001)
       |     - 메모리 Request/Limit 누락 차단 (K8S002)
       |     - Liveness / Readiness 프로브 누락 차단 (K8S003)
       |     - Argo Rollouts Canary 가중치 단조 증가 및 Analysis 필수화 (ARGO001)
       |
       +---> [Migration & Restore Guard]
       |     - Expand 단계 DROP 차단 및 Contract 단계 제어 (MIG001)
       |     - RENAME COLUMN / TABLE 차단 (MIG002)
       |     - ALTER COLUMN TYPE 직접 변경 차단 (MIG003)
       |     - DEFAULT 없는 NOT NULL 컬럼 추가 차단 (MIG004)
       |     - CONCURRENTLY 없는 인덱스 생성/삭제 차단 (MIG005)
       |     - SHA-256 검증 및 SQLite 인메모리 복원 드릴 (BAK001, BAK002)
       |     - 결제/주문 데이터 음수 금액 불변식 검증 (BAK003)
       |
       +---> [Audit & Observability]
             - 배포 게이트 감사 로그 저장 (SQLite audit_records)
             - 프로메테우스 메트릭 수집 (/metrics)
```

## 정책 규칙 상세

| 규칙 ID | 심각도 | 검증 영역 | 차단 조건 및 정책 |
|---|---|---|---|
| `TF001` | ERROR | Terraform | `aws_db_instance`, `aws_s3_bucket`, `aws_ebs_volume` 삭제 또는 교체(actions에 delete 포함) |
| `TF002` | ERROR | Terraform | `aws_security_group` 인바운드에서 포트 22, 5432, 6379에 `0.0.0.0/0` 또는 `::/0` 허용 |
| `TF003` | ERROR | Terraform | `aws_db_instance`의 `storage_encrypted` 비활성화 또는 `backup_retention_period < 1` |
| `TF004` | ERROR | Terraform | 예산 보호 기준 외의 고비용 인스턴스 크기 지정 |
| `TF005` | ERROR | Terraform | 선언 코드와 클라우드 런타임 스냅샷 간 속성 불일치 또는 미관리 리소스 발생 |
| `K8S001` | ERROR | Kubernetes | 컨테이너 이미지 태그가 생략되었거나 `:latest` 지정 |
| `K8S002` | ERROR | Kubernetes | `resources.limits.memory` 또는 `resources.requests.memory` 설정 누락 |
| `K8S003` | ERROR | Kubernetes | `readinessProbe` 또는 `livenessProbe` 설정 누락 |
| `ARGO001` | ERROR | Argo Rollouts | `spec.strategy.canary.steps` 가중치 비단조 증가 또는 `analysis` 단계 누락 |
| `MIG001` | ERROR | Migration | `DROP COLUMN`, `DROP TABLE` 실행 (`allow_contract=True` 지정 시 허용) |
| `MIG002` | ERROR | Migration | 구 버전 쿼리와 충돌하는 `RENAME COLUMN`, `RENAME TO` 실행 |
| `MIG003` | ERROR | Migration | 배타적 테이블 락과 전체 재작성을 유발하는 `ALTER COLUMN TYPE` 실행 |
| `MIG004` | ERROR | Migration | 기존 행 락과 실패를 유발하는 `DEFAULT` 없는 `ADD COLUMN ... NOT NULL` |
| `MIG005` | ERROR | Migration | 쓰기 락을 유발하는 `CONCURRENTLY` 없는 인덱스 생성 및 삭제 |
| `BAK001` | ERROR | Backup Drill | 백업 덤프 파일 SHA-256 해시값 불일치 |
| `BAK002` | ERROR | Backup Drill | 복원 후 필수 테이블 누락 또는 데이터 행 수 0건 |
| `BAK003` | ERROR | Backup Drill | 주문 및 결제 금액 컬럼에 음수 값 존재 또는 합계 음수 |

## CLI 사용법

```bash
# 1. Terraform Plan JSON 검사
opsguard terraform plan.json

# 2. Terraform 런타임 드리프트 검사
opsguard terraform desired.json --actual actual.json

# 3. Kubernetes / Argo Rollouts 매니페스트 검사
opsguard k8s deployment.yaml

# 4. SQL 무중단 마이그레이션 린트 (Expand 단계)
opsguard migration migration.sql

# 5. SQL 무중단 마이그레이션 린트 (Contract 단계)
opsguard migration migration.sql --allow-contract

# 6. 백업 덤프 복원 드릴 검증
opsguard restore dump.sql --sha256 <expected-hash> --table users --table orders
```

## API 서버 실행

```bash
uvicorn opsguard.api:app --host 0.0.0.0 --port 8000
```

### 주요 엔드포인트
- `POST /v1/verify/terraform`: Terraform Plan 또는 Drift 검증
- `POST /v1/verify/k8s`: Kubernetes 및 Argo Rollouts YAML 검증
- `POST /v1/verify/migration`: 무중단 DDL 린트 검증
- `POST /v1/verify/restore`: 백업 복원 정합성 드릴 검증
- `GET /healthz`: 서버 상태 확인
- `GET /metrics`: Prometheus 메트릭 수집 (`opsguard_checks_total`, `opsguard_violations_total`)

## 테스트 및 코드 검증

```bash
# 전체 점검 (린트, 타입체크, 단위/통합 테스트)
make check

# 개별 점검
make lint       # ruff check
make typecheck  # mypy opsguard tests
make test       # pytest -v tests/
```
