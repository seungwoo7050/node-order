<p align="center">
  <h1 align="center">pgrelay</h1>
  <p align="center"><b>PostgreSQL 기반 트랜잭셔널 아웃박스 및 웹훅 전달 엔진</b></p>
  <p align="center">
    Go 1.24 | PostgreSQL | SKIP LOCKED | HMAC-SHA256 | Full Jitter | Prometheus
  </p>
</p>

---

PostgreSQL 기반의 트랜잭션 아웃박스(Transactional Outbox) 및 웹훅 전달 엔진입니다. 비즈니스 쿼리와 웹훅 발송 이벤트를 단일 데이터베이스 트랜잭션에 원자적으로 기록하고, 백그라운드 워커가 대상 엔드포인트로 안전하게 전달합니다.

외부 메시지 큐(Kafka, RabbitMQ) 클러스터를 별도로 운영하기 부담스러운 단일 데이터베이스 환경에서, Go 라이브러리(`pkg/relay`)로 애플리케이션에 직접 임베딩하거나 독립 사이드카 데몬(`cmd/pgrelay`)으로 띄워 쓸 수 있습니다.

## 아키텍처 흐름도

```mermaid
flowchart LR
    Tx["App Business Tx\n(EnqueueTx)"] --> DB[("PostgreSQL\noutbox_events")]
    DB -->|"SKIP LOCKED"| Workers["Worker Pool &\nStale Lock Reaper"]
    Workers --> Signer["HMAC-SHA256 &\nFull Jitter Backoff"]
    Signer --> Dest["Partner Webhook\nor Dead Letter"]
```

## 왜 만들었나

애플리케이션에서 DB `COMMIT` 직후 외부 웹훅이나 서드파티 API를 직접 호출하는 방식에는 이중 쓰기(Dual-Write) 결함이 있습니다.

1. DB 트랜잭션은 커밋되었으나 네트워크 순단이나 프로세스 비정상 종료로 웹훅 호출이 유실되는 경우.
2. 반대로 웹훅 호출은 성공했으나 애플리케이션의 DB 커밋 직전 롤백되어 결제나 상태 변경 없는 유령 웹훅이 발송되는 경우.

이 문제를 막기 위해 Kafka나 Debezium(CDC)을 도입하는 것은 소규모 및 중규모 서비스에 과도한 인프라 관리 비용(Zookeeper/KRaft, 커넥터 모니터링, 스키마 레지스트리)을 유발합니다. PostgreSQL은 이미 ACID 트랜잭션과 고성능 행 잠금(`FOR UPDATE SKIP LOCKED`), 그리고 비동기 알림(`LISTEN/NOTIFY`) 기능을 내장하고 있습니다. `pgrelay`는 데이터베이스 본래의 기능을 살려 추가 인프라 없이 비동기 전달 정합성을 지키기 위해 만들었습니다.

## 구조와 설계 판단

```text
cmd/pgrelay/          독립 실행 바이너리 (REST API, /metrics, /healthz, graceful shutdown)
migrations/           outbox_events 테이블 DDL 및 부분 인덱스(Partial Index)
pkg/relay/
├── event.go          Event 모델 및 유효성 검증
├── store.go          Store 인터페이스 및 DBTx 추상화
├── pgstore.go        PostgreSQL SKIP LOCKED 쿼리 및 상태 전이
├── memstore.go       결정론적 단위 및 동시성 검증용 인메모리 스토어 (Tx 롤백 시뮬레이션)
├── notifier.go       LISTEN/NOTIFY 신호 전파 및 폴백 폴링 티커
├── signer.go         HMAC-SHA256 서명 생성 및 리플레이 방어 검증기
├── backoff.go        AWS Full Jitter 기반 지수 백오프 계산기
├── dispatcher.go     HTTP POST 발송기 (응답 크기 제한, 재시도/영구실패 분류)
├── engine.go         워커 풀 조율, 고아 락 회수(Reaper), 프로메테우스 메트릭 수집기
└── engine_test.go    불변조건 I1~I5 동시성 및 레이스 검증 테스트
```

### 1. 패키지와 데몬 분리 (`pkg/relay` vs `cmd/pgrelay`)
호스트 애플리케이션이 Go로 작성되었다면 `pkg/relay`를 임베딩하여 비즈니스 트랜잭션(`*sql.Tx`) 안에서 `relay.EnqueueTx`를 호출하는 방식이 가장 정합성이 높습니다. 반면 Python, Node.js 등 타 언어 스택이거나 사이드카 아키텍처를 원할 때는 `cmd/pgrelay` 데몬을 컨테이너 옆에 띄우고 동일 DB 테이블을 바라보게 하거나 로컬 REST API로 이벤트를 위임할 수 있습니다.

### 2. `FOR UPDATE SKIP LOCKED` 기반 배치 선점
여러 워커 프로세스가 동시에 큐를 폴링할 때 경합으로 인한 지연(Lock Contention)을 없애기 위해 PostgreSQL의 `SKIP LOCKED` 구문을 사용합니다.
```sql
WITH candidates AS (
    SELECT id FROM outbox_events
    WHERE status = 'pending' AND next_attempt_at <= $1
    ORDER BY next_attempt_at ASC, id ASC
    LIMIT $2
    FOR UPDATE SKIP LOCKED
)
UPDATE outbox_events e
SET status = 'processing', locked_at = $3, locked_by = $4, attempts = e.attempts + 1
FROM candidates c
WHERE e.id = c.id
RETURNING e.id, e.topic, e.endpoint, ...;
```
이미 다른 워커가 잡은 행은 대기 없이 건너뛰므로, 워커 수가 늘어나도 블로킹 없이 높은 처리량을 유지합니다. `status = 'pending'` 조건의 부분 인덱스(Partial Index)를 타기 때문에 전체 테이블 크기가 커져도 선점 속도가 느려지지 않습니다.

### 3. 고아 락 회수 (Stale Lock Reaper)
워커가 이벤트를 선점해 `status = 'processing'` 상태로 처리하던 도중 `OOMKilled`나 하드웨어 장애로 비정상 종료되면 해당 이벤트가 영구히 방치될 위험이 있습니다. `pgrelay`의 백그라운드 Reaper 루프는 `locked_at < NOW() - lease_timeout` 조건의 고아 행을 주기적으로 감지해 다시 `pending` 상태로 원상 복구합니다.

### 4. Full Jitter 지수 백오프
장애가 발생한 수신 웹훅 서버가 복구되었을 때 대기 중이던 수천 건의 재시도 요청이 일시에 몰리는 썬더링 허드(Thundering Herd) 현상을 방지합니다. AWS 아키텍처 권장 방식인 Full Jitter 수식(`random(0, min(max_delay, base_delay * factor^(attempts-1)))`)을 적용해 재시도 시점을 고르게 분산시킵니다. 5회(`max_attempts`) 이상 재시도에 실패하면 상태를 `dead`(DLQ)로 격리해 정상 발송 파이프라인을 차단하지 않습니다.

### 5. HMAC-SHA256 서명과 리플레이 방어
수신 측에서 발송 주체를 신뢰할 수 있도록 `X-PGRelay-Signature` 헤더(`v1=<hex>`)를 동봉합니다. 페이로드 바디와 발송 유닉스 타임스탬프(`X-PGRelay-Timestamp`)를 결합해 서명하므로, 중간자 공격에 의한 내용 변조와 허용 오차(기본 5분)를 벗어난 리플레이 요청을 가려냅니다.

## 사용법

### 라이브러리로 코드에 임베딩 (`pkg/relay`)

```go
package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"log"
	"time"

	"github.com/woopinbell/pgrelay/pkg/relay"
)

func main() {
	db, _ := sql.Open("postgres", "postgres://user:pass@localhost:5432/mydb?sslmode=disable")
	defer db.Close()

	store := relay.NewPGStore(db)
	dispatcher := relay.NewHTTPDispatcher(nil, relay.NewSigner([]byte("webhook-secret")))

	engine, err := relay.NewEngine(relay.EngineConfig{
		Store:        store,
		Dispatcher:   dispatcher,
		WorkerCount:  4,
		BatchSize:    16,
		PollInterval: 500 * time.Millisecond,
		LeaseTimeout: 30 * time.Second,
	})
	if err != nil {
		log.Fatal(err)
	}

	ctx := context.Background()

	// 비즈니스 트랜잭션 안에서 원자적 이벤트 Enqueue
	tx, _ := db.BeginTx(ctx, nil)
	_, _ = tx.ExecContext(ctx, "UPDATE orders SET status = 'paid' WHERE id = $1", "ord_123")

	payload, _ := json.Marshal(map[string]any{"order_id": "ord_123", "amount": 50000})
	_ = relay.EnqueueTx(ctx, tx, relay.Event{
		Topic:    "order.paid",
		Endpoint: "https://api.partner.com/webhook",
		Payload:  payload,
	})
	_ = tx.Commit() // 주문 상태와 아웃박스 이벤트가 원자적으로 커밋됨

	// 백그라운드 발송 루프 시작
	go engine.Start(ctx)
	defer engine.Stop()
}
```

### 독립 데몬 실행 (`cmd/pgrelay`)

```sh
# 빌드
make build

# 실행
./bin/pgrelay -dsn "postgres://user:pass@localhost:5432/mydb?sslmode=disable" \
  -listen :8080 \
  -signing-secret "my-secret-key" \
  -workers 8 \
  -batch 32
```

- 메트릭: `GET http://localhost:8080/metrics`
  - `pgrelay_events_enqueued_total`: 인큐된 이벤트 수
  - `pgrelay_events_delivered_total`: 발송 성공 이벤트 수
  - `pgrelay_events_failed_total`: 재시도 실패 이벤트 수
  - `pgrelay_events_dead_total`: 최대 재시도 초과(DLQ) 이벤트 수
  - `pgrelay_reaper_recovered_total`: 고아 락 회수 건수

## 테스트

외부 PostgreSQL 없이 인메모리 스토어(`memstore.go`)를 사용해 모든 동시성 및 복구 테스트를 결정론적으로 검증할 수 있습니다.

```sh
make vet
make race
```

- `TestEngine_ConcurrentWorkersClaimExclusively`: 8개 워커가 수백 개 이벤트를 경합할 때 중복 실행 없는지 검증
- `TestEngine_ReaperRecoversStaleLock`: 처리 중 강제 중단된 이벤트를 Reaper가 정상 회수하는지 검증
- `TestEngine_ExponentialBackoffWithJitter`: 연속 실패 시 Full Jitter 수식에 따른 지수 대기 시간 검증
- `TestEngine_DeadLetterQueueOnMaxAttempts`: 최대 재시도 횟수 초과 시 dead 상태 격리 검증
- `TestSigner_TamperedPayloadRejected`: 페이로드나 타임스탬프 변조 시 HMAC 서명 검증 실패 검증
