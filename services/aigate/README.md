# aigate

외부 LLM 및 서드파티 HTTP API 호출에 필요한 회복탄력성 기능을 묶은 Go 게이트웨이입니다. Go 표준 `net/http` 클라이언트의 `http.RoundTripper` 미들웨어로 코드에 직접 주입하거나, 독립 리버스 프록시 데몬(`cmd/aigate`)으로 띄워 사용할 수 있습니다.

## 왜 만들었나

OpenAI나 Anthropic 같은 LLM API를 서비스에 연동하면 세 가지 문제가 반복해서 발생합니다.

1. **429 Too Many Requests와 장애 전파**: 특정 테넌트가 순간적으로 트래픽을 몰아치면 상위 API 할당량이 고갈되어 다른 사용자 요청까지 모두 실패합니다. 업스트림 장애가 발생했을 때 빠르게 우회하지 못하면 백엔드 워커 스레드가 타임아웃까지 묶여 전체 서비스가 지연됩니다.
2. **표준 `singleflight`의 리더 컨텍스트 취소 전파 버그**: 동일한 프롬프트나 쿼리 요청이 동시에 들어올 때 `golang.org/x/sync/singleflight`로 요청을 병합하면, 가장 먼저 진입한 첫 번째 호출자(Leader)가 네트워크 타임아웃이나 브라우저 탭 닫기로 컨텍스트를 취소하는 순간 뒤이어 대기하던 모든 후속 호출자(Follower)의 업스트림 호출까지 함께 중단됩니다.
3. **SSE(Server-Sent Events) 스트리밍 버퍼링 문제**: 일반적인 프록시나 요청 병합 미들웨어는 응답 바디를 메모리에 버퍼링한 뒤 반환하므로, LLM의 토큰 스트리밍(`text/event-stream`) 첫 토큰 전달 시간(TTFT, Time-To-First-Token)이 크게 지연됩니다.

`aigate`는 외부 의존성 없이 Go 표준 라이브러리만으로 이 세 가지 문제를 해결하기 위해 작성했습니다.

## 구조와 주요 설계 판단

```
pkg/gate/
├── config.go         설정 모델과 에러 정의 (ProviderConfig, RateLimitConfig, BreakerConfig)
├── ratelimit.go      테넌트별 Token Bucket 레이트 리미터와 유휴 버킷 정리
├── singleflight.go   호출자 컨텍스트 취소가 격리된 Single-Flight 요청 병합기
├── breaker.go        Closed-Open-HalfOpen 3상태 서킷 브레이커와 단일 프로브 가드
├── failover.go       다중 업스트림 프로바이더 라우터 (Primary -> Fallback 자동 우회)
├── sse.go            text/event-stream 무버퍼 청크 즉시 Flush 프록시
├── transport.go      http.RoundTripper 및 http.Handler 결합체, Prometheus 메트릭
└── transport_test.go 동시성 및 회복탄력성 불변조건 검증 (go test -race)
cmd/aigate/
└── main.go           독립 실행 리버스 프록시 서버 데몬 (/healthz, /metrics)
```

- **`context.WithoutCancel` 기반 참조 카운팅 Single-Flight**: `singleflight.Group` 내부에서 실행 컨텍스트를 생성할 때 `context.WithoutCancel`을 적용하고 대기 중인 호출자 수를 참조 카운팅합니다. 첫 번째 호출자가 컨텍스트를 취소하더라도 대기자가 1명 이상 남아 있으면 업스트림 호출을 중단하지 않고 유지합니다. 모든 대기자가 취소된 시점에만 업스트림 컨텍스트를 취소합니다.
- **Half-Open 단일 프로브(Single-Probe) 가드**: 서킷 브레이커가 `Open` 상태에서 `Cooldown` 시간이 지나 `Half-Open`으로 전이할 때, 동시 요청이 몰려도 오직 `MaxHalfOpenProbes`(기본 1개)의 요청만 업스트림으로 보내고 나머지 동시 요청은 즉시 Fallback으로 넘기거나 거절합니다. 프로브 요청이 성공해야만 `Closed`로 복구하며, 실패하면 즉시 다시 `Open`으로 되돌립니다.
- **스트리밍 분기와 무버퍼 즉시 Flush**: 요청 헤더(`Accept: text/event-stream`)나 본문(`"stream": true`), 또는 업스트림 응답 헤더의 `Content-Type`을 검사해 SSE 요청은 Single-Flight 병합 대상에서 제외합니다. `http.Flusher`를 사용해 업스트림에서 청크가 도착하는 즉시 클라이언트로 밀어내어 TTFT 지연을 없앱니다.
- **재시도 가능한 요청 본문 복제**: Failover 라우터는 프라이머리 프로바이더 실패(5xx, 429, 네트워크 오류) 시 Fallback 프로바이더로 재시도할 수 있도록 진입 시점의 본문을 최대 바이트(`MaxBodyBytes`, 기본 10MB)까지 메모리에 보관하고 `req.GetBody`로 복원합니다.

## 사용법

### 1. Go 라이브러리로 사용 (`http.RoundTripper`)

기존 Go 애플리케이션의 `http.Client` 전송 계층에 직접 주입할 수 있습니다.

```go
package main

import (
	"context"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/woopinbell/aigate/pkg/gate"
)

func main() {
	cfg := gate.DefaultConfig()
	cfg.RateLimit.RequestsPerSecond = 20.0
	cfg.RateLimit.Burst = 40.0
	cfg.Breaker.FailureThreshold = 3
	cfg.Breaker.Cooldown = 5 * time.Second

	cfg.Providers = []gate.ProviderConfig{
		{
			Name:     "primary-openai",
			BaseURL:  "https://api.openai.com",
			APIKey:   "sk-primary-key",
			Priority: 1,
			Timeout:  30 * time.Second,
		},
		{
			Name:     "fallback-azure",
			BaseURL:  "https://my-resource.openai.azure.com",
			APIKey:   "azure-key",
			Priority: 2,
			Timeout:  30 * time.Second,
		},
	}

	gateway := gate.NewGateway(cfg)
	client := &http.Client{
		Transport: gateway,
		Timeout:   60 * time.Second,
	}

	req, _ := http.NewRequestWithContext(
		context.Background(),
		http.MethodPost,
		"https://api.openai.com/v1/chat/completions",
		strings.NewReader(`{"model":"gpt-4o","messages":[{"role":"user","content":"ping"}]}`),
	)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Tenant-ID", "tenant-alpha")

	resp, err := client.Do(req)
	if err != nil {
		log.Fatalf("Request failed: %v", err)
	}
	defer resp.Body.Close()

	log.Printf("Provider used: %s (Failovers: %s)",
		resp.Header.Get("X-AIGate-Provider"),
		resp.Header.Get("X-AIGate-Failover-Count"),
	)
}
```

### 2. 독립 리버스 프록시 데몬 실행 (`cmd/aigate`)

```sh
# 빌드
make build

# 실행
./bin/aigate -listen :8081 \
  -primary http://localhost:9001 \
  -fallback http://localhost:9002 \
  -rps 20 \
  -burst 40 \
  -failure-threshold 3 \
  -cooldown 5s
```

- 상태 확인: `GET http://localhost:8081/healthz`
- Prometheus 메트릭: `GET http://localhost:8081/metrics`
  - `aigate_requests_total`: 처리한 전체 요청 수
  - `aigate_coalesced_total`: Single-Flight로 병합된 요청 수
  - `aigate_rate_limited_total`: 레이트 리밋(429)으로 차단된 요청 수
  - `aigate_failover_total`: 대체 프로바이더로 우회한 횟수
  - `aigate_circuit_state{provider="..."}`: 서킷 상태 (`0`=Closed, `1`=HalfOpen, `2`=Open)

## 테스트

Go 표준 라이브러리만 사용하므로 외부 서비스 없이 모든 테스트가 통과합니다.

```sh
make vet
make race
```

- `TestSingleFlightLeaderCancelDoesNotAbortFollowers`: 리더 컨텍스트 취소 시 후속 대기자 정상 수신 검증
- `TestSingleFlightAllCallersCancelAbortsUpstream`: 모든 호출자 취소 시 업스트림 호출 즉시 중단 검증
- `TestCircuitBreakerHalfOpenSingleProbe`: Half-Open 전이 시 단 1개의 프로브만 허용하고 동시 요청을 차단하는지 검증
- `TestFailoverOnPrimary503AndCircuitOpen`: 503 및 서킷 Open 발생 시 Fallback 프로바이더 자동 우회 검증
- `TestSSEStreamFlushesChunksImmediately`: 스트리밍 청크가 버퍼링 없이 즉시 클라이언트에 flush되는지 검증
- `TestTokenBucketRateLimitAndRetryAfter`: 버킷 고갈 시 429와 정밀한 Retry-After 반환 및 유휴 버킷 정리 검증
- `TestConcurrentSingleFlightContention`: 20개 동시 요청 병합 시 데이터 경합(-race) 여부 검증

## 범위와 한계

- **단일 프로세스 메모리 상태**: 레이트 리미터 토큰 버킷과 서킷 브레이커 상태는 단일 프로세스의 인메모리 뮤텍스로 관리합니다. 여러 인스턴스를 무상태로 띄워 클러스터 전체의 총량을 공유해야 한다면 Redis Lua 스크립트 기반 분산 저장소로 교체해야 합니다.
- **요청 본문 메모리 상한**: 프로바이더 장애 시 재전송을 지원하기 위해 요청 본문을 메모리에 올립니다. 대용량 파일 업로드(오디오/이미지 전송) 시 메모리 사용량이 커질 수 있으므로 기본값(`MaxBodyBytes = 10MB`)을 초과하는 요청은 버퍼링하지 않도록 주의해야 합니다.
