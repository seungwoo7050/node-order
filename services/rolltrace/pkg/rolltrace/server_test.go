package rolltrace

import (
	"bytes"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

// 1. W3C traceparent 파싱 및 유효성 검증
func TestTraceContext_ParseAndFormat(t *testing.T) {
	// Valid sampled traceparent
	validRaw := "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
	tc, err := ParseTraceParent(validRaw)
	if err != nil {
		t.Fatalf("expected valid parse, got error: %v", err)
	}
	if tc.TraceID != "4bf92f3577b34da6a3ce929d0e0e4736" {
		t.Errorf("unexpected trace ID: %s", tc.TraceID)
	}
	if tc.SpanID != "00f067aa0ba902b7" {
		t.Errorf("unexpected span ID: %s", tc.SpanID)
	}
	if !tc.Sampled {
		t.Errorf("expected sampled=true")
	}
	if tc.String() != validRaw {
		t.Errorf("expected serialized %s, got %s", validRaw, tc.String())
	}

	// All-zero trace ID rejected
	allZeroTrace := "00-00000000000000000000000000000000-00f067aa0ba902b7-01"
	if _, err := ParseTraceParent(allZeroTrace); err == nil {
		t.Errorf("expected error for all-zero trace ID")
	}

	// All-zero span ID rejected
	allZeroSpan := "00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01"
	if _, err := ParseTraceParent(allZeroSpan); err == nil {
		t.Errorf("expected error for all-zero span ID")
	}

	// Malformed formats
	malformed := []string{
		"invalid",
		"01-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01", // bad version
		"00-short-00f067aa0ba902b7-01",
		"00-4bf92f3577b34da6a3ce929d0e0e4736-short-01",
	}
	for _, raw := range malformed {
		if _, err := ParseTraceParent(raw); err == nil {
			t.Errorf("expected error for malformed raw: %s", raw)
		}
	}

	// ChildSpan produces unique span ID with identical trace ID
	child := tc.ChildSpan()
	if child.TraceID != tc.TraceID {
		t.Errorf("child trace ID should match parent")
	}
	if child.SpanID == tc.SpanID {
		t.Errorf("child span ID should be distinct from parent")
	}
}

// 2. HTTP 미들웨어 컨텍스트 전파 및 스팬 인제스트 검증
func TestPropagateMiddleware(t *testing.T) {
	sampler := NewTailSampler(DefaultTailSampleConfig())

	handler := PropagateMiddleware("order-service", "canary", sampler, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tc, ok := TraceFromContext(r.Context())
		if !ok {
			t.Errorf("tracecontext missing in request context")
		}
		if tc.TraceID == "" {
			t.Errorf("trace ID should not be empty")
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	}))

	req := httptest.NewRequest(http.MethodGet, "/orders/123", nil)
	req.Header.Set("traceparent", "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	respTraceparent := rec.Header().Get("traceparent")
	if respTraceparent == "" {
		t.Errorf("response traceparent header missing")
	}
	respTraceID := rec.Header().Get("X-Trace-ID")
	if respTraceID != "4bf92f3577b34da6a3ce929d0e0e4736" {
		t.Errorf("expected X-Trace-ID 4bf92f3577b34da6a3ce929d0e0e4736, got %s", respTraceID)
	}

	// Verify span ingested into sampler
	metrics := sampler.GetSlotMetrics("canary")
	if metrics.TotalRequests != 1 {
		t.Errorf("expected total requests 1, got %d", metrics.TotalRequests)
	}
}

// 3. Tail-based Sampling: 이상 트레이스 100% 보존 vs 정상 트레이스 5% 결정론적 샘플링
func TestTailSampler_AnomalyRetention(t *testing.T) {
	cfg := DefaultTailSampleConfig()
	cfg.BaseSampleRate = 0.05
	cfg.LatencyThresholdMs = 200
	cfg.ErrorStatusThreshold = 500
	sampler := NewTailSampler(cfg)

	// Anomaly 1: Error status code (500)
	errTraceID := "11111111111111111111111111111111"
	sampler.IngestSpan(&Span{
		TraceID:    errTraceID,
		SpanID:     "1000000000000001",
		Service:    "payment",
		StatusCode: 500,
		DurationMs: 50,
		Slot:       "canary",
	})
	if decision := sampler.EvaluateTrace(errTraceID); decision != DecisionKeepAnomaly {
		t.Errorf("expected DecisionKeepAnomaly for error trace, got %s", decision)
	}
	if _, found := sampler.GetTrace(errTraceID); !found {
		t.Errorf("expected error trace to be preserved")
	}

	// Anomaly 2: High latency (>= 200ms)
	latencyTraceID := "22222222222222222222222222222222"
	sampler.IngestSpan(&Span{
		TraceID:    latencyTraceID,
		SpanID:     "2000000000000001",
		Service:    "payment",
		StatusCode: 200,
		DurationMs: 250,
		Slot:       "stable",
	})
	if decision := sampler.EvaluateTrace(latencyTraceID); decision != DecisionKeepAnomaly {
		t.Errorf("expected DecisionKeepAnomaly for high latency trace, got %s", decision)
	}

	// Anomaly 3: Fallback used
	fallbackTraceID := "33333333333333333333333333333333"
	sampler.IngestSpan(&Span{
		TraceID:      fallbackTraceID,
		SpanID:       "3000000000000001",
		Service:      "payment",
		StatusCode:   200,
		DurationMs:   20,
		FallbackUsed: true,
		Slot:         "canary",
	})
	if decision := sampler.EvaluateTrace(fallbackTraceID); decision != DecisionKeepAnomaly {
		t.Errorf("expected DecisionKeepAnomaly for fallback trace, got %s", decision)
	}

	// Normal traces deterministic sample check across 1000 IDs
	sampledCount := 0
	totalNormal := 1000
	for i := 0; i < totalNormal; i++ {
		normalID := fmt.Sprintf("aaaaaaaaaaaaaaaaaaaa%012d", i)
		sampler.IngestSpan(&Span{
			TraceID:    normalID,
			SpanID:     fmt.Sprintf("bbbbbbbb%08d", i),
			Service:    "payment",
			StatusCode: 200,
			DurationMs: 20,
			Slot:       "stable",
		})
		if sampler.EvaluateTrace(normalID) == DecisionKeepSampled {
			sampledCount++
		}
	}

	// BaseSampleRate is 5% (0.05). With 1000 items, should be roughly around 30~70
	if sampledCount < 20 || sampledCount > 100 {
		t.Errorf("expected sample count roughly around 50 for 5%% rate, got %d", sampledCount)
	}
}

// 4. Priority Eviction: 버퍼 한계 도달 시 정상 트레이스 우선 축출 및 이상 트레이스 보호
func TestTailSampler_PriorityEviction(t *testing.T) {
	cfg := DefaultTailSampleConfig()
	cfg.MaxBufferedTraces = 5
	sampler := NewTailSampler(cfg)

	// Ingest 2 anomaly traces
	anomaly1 := "99999999999999999999999999999901"
	anomaly2 := "99999999999999999999999999999902"
	sampler.IngestSpan(&Span{TraceID: anomaly1, SpanID: "1", StatusCode: 500, Slot: "canary"})
	sampler.IngestSpan(&Span{TraceID: anomaly2, SpanID: "2", StatusCode: 500, Slot: "canary"})

	// Ingest 3 normal traces (fills buffer to 5)
	for i := 1; i <= 3; i++ {
		normID := fmt.Sprintf("0000000000000000000000000000000%d", i)
		sampler.IngestSpan(&Span{TraceID: normID, SpanID: "n", StatusCode: 200, DurationMs: 10})
	}

	// Ingest 4 more normal traces to cause repeated evictions
	for i := 4; i <= 7; i++ {
		normID := fmt.Sprintf("0000000000000000000000000000000%d", i)
		sampler.IngestSpan(&Span{TraceID: normID, SpanID: "n", StatusCode: 200, DurationMs: 10})
	}

	// Anomaly traces must still be preserved despite heavy evictions!
	if _, found := sampler.traces[anomaly1]; !found {
		t.Fatalf("anomaly trace 1 was prematurely evicted!")
	}
	if _, found := sampler.traces[anomaly2]; !found {
		t.Fatalf("anomaly trace 2 was prematurely evicted!")
	}
}

// 5. Deployment Lease: 원자적 획득, 만료 후 자동 선점, 동시 소유 충돌 검증
func TestLeaseManager_AcquireAndConflict(t *testing.T) {
	cfg := LeaseConfig{DefaultTTL: 100 * time.Millisecond}
	lm := NewLeaseManager(cfg)

	// Worker 1 acquires lease
	lease, err := lm.TryAcquire("checkout", "worker-1", 100*time.Millisecond)
	if err != nil {
		t.Fatalf("failed to acquire lease: %v", err)
	}
	if lease.HolderID != "worker-1" {
		t.Errorf("expected holder worker-1, got %s", lease.HolderID)
	}

	// Worker 1 can idempotently renew
	renewed, err := lm.TryAcquire("checkout", "worker-1", 100*time.Millisecond)
	if err != nil {
		t.Fatalf("worker-1 failed to renew lease: %v", err)
	}
	if renewed.Version != 2 {
		t.Errorf("expected lease version 2, got %d", renewed.Version)
	}

	// Worker 2 attempts acquire; must fail with ErrLeaseHeld
	_, err = lm.TryAcquire("checkout", "worker-2", 100*time.Millisecond)
	if err != ErrLeaseHeld {
		t.Fatalf("expected ErrLeaseHeld, got %v", err)
	}

	// Worker 2 cannot release worker-1's lease
	if err := lm.Release("checkout", "worker-2"); err != ErrUnauthorizedHolder {
		t.Errorf("expected ErrUnauthorizedHolder, got %v", err)
	}

	// Wait for TTL expiration
	time.Sleep(120 * time.Millisecond)

	// Worker 2 can now claim the expired lease
	lease2, err := lm.TryAcquire("checkout", "worker-2", 100*time.Millisecond)
	if err != nil {
		t.Fatalf("worker-2 failed to acquire expired lease: %v", err)
	}
	if lease2.HolderID != "worker-2" {
		t.Errorf("expected holder worker-2, got %s", lease2.HolderID)
	}

	// Clean release by worker-2
	if err := lm.Release("checkout", "worker-2"); err != nil {
		t.Fatalf("failed to release lease: %v", err)
	}
	if _, held := lm.GetLease("checkout"); held {
		t.Errorf("expected lease to be released")
	}
}

// 6. 최소 표본수(20건) 게이트: 표본 부족 시 단 1건 에러에도 Hold 유지 및 조기 롤백 차단
func TestCanaryController_SampleCountGate(t *testing.T) {
	cfg := DefaultCanaryConfig()
	cfg.MinSampleCount = 20
	cfg.MaxErrorRate = 0.02
	lm := NewLeaseManager(DefaultLeaseConfig())
	sampler := NewTailSampler(DefaultTailSampleConfig())
	ctrl := NewCanaryController(cfg, lm, sampler)

	_, err := ctrl.StartRollout("catalog", "v1.1.0", "deployer-1")
	if err != nil {
		t.Fatalf("failed to start rollout: %v", err)
	}

	// Inject 5 total samples with 2 errors (error rate = 40%, far exceeding 2%)
	// But total sample (5) < min sample count (20)
	metrics := SlotMetrics{
		TotalRequests: 5,
		ErrorCount:    2,
		ErrorRate:     0.40,
		P99LatencyMs:  120.0,
	}

	result, err := ctrl.EvaluateCanary("catalog", metrics)
	if err != nil {
		t.Fatalf("evaluation failed: %v", err)
	}
	if result.Action != ActionHold {
		t.Errorf("expected ActionHold due to low sample count, got %s", result.Action)
	}
	if result.Reason != ReasonInsufficientSamples {
		t.Errorf("expected reason %s, got %s", ReasonInsufficientSamples, result.Reason)
	}
	if result.BreachCount != 0 {
		t.Errorf("breach count should remain 0 when samples are insufficient, got %d", result.BreachCount)
	}
}

// 7. 연속 2회 SLO 위반 시 카나리 자동 롤백, CulpritTraceIDs 첨부 및 리스 자동 해제
func TestCanaryController_ConsecutiveBreachRollback(t *testing.T) {
	cfg := DefaultCanaryConfig()
	cfg.MinSampleCount = 20
	cfg.ConsecutiveBreaches = 2
	cfg.MaxErrorRate = 0.05
	lm := NewLeaseManager(DefaultLeaseConfig())
	sampler := NewTailSampler(DefaultTailSampleConfig())
	ctrl := NewCanaryController(cfg, lm, sampler)

	_, err := ctrl.StartRollout("checkout", "v2.0.0", "argo-agent")
	if err != nil {
		t.Fatalf("failed to start rollout: %v", err)
	}

	// Seed canary error in sampler
	culpritID := "deadbeefdeadbeefdeadbeefdeadbeef"
	sampler.IngestSpan(&Span{
		TraceID:    culpritID,
		SpanID:     "1111222233334444",
		Service:    "checkout",
		StatusCode: 503,
		Slot:       "canary",
	})

	breachedMetrics := SlotMetrics{
		TotalRequests: 30,
		ErrorCount:    6,
		ErrorRate:     0.20, // 20% > 5%
		P99LatencyMs:  150.0,
	}

	// Evaluation 1: First breach -> Hold
	res1, err := ctrl.EvaluateCanary("checkout", breachedMetrics)
	if err != nil {
		t.Fatalf("first eval failed: %v", err)
	}
	if res1.Action != ActionHold || res1.BreachCount != 1 {
		t.Errorf("expected Hold with breach count 1, got action=%s, breach=%d", res1.Action, res1.BreachCount)
	}

	// Evaluation 2: Consecutive breach -> Rollback
	res2, err := ctrl.EvaluateCanary("checkout", breachedMetrics)
	if err != nil {
		t.Fatalf("second eval failed: %v", err)
	}
	if res2.Action != ActionRollback {
		t.Fatalf("expected ActionRollback on consecutive breach, got %s", res2.Action)
	}
	if res2.NextWeight != 0 {
		t.Errorf("canary weight should be reset to 0%%, got %d", res2.NextWeight)
	}
	if len(res2.CulpritTraceIDs) == 0 || res2.CulpritTraceIDs[0] != culpritID {
		t.Errorf("expected culprit trace ID %s, got %v", culpritID, res2.CulpritTraceIDs)
	}

	// Deployment lease must have been released automatically
	if _, held := lm.GetLease("checkout"); held {
		t.Errorf("lease should have been automatically released upon rollback")
	}
}

// 8. 카나리 점진적 승격 (10% -> 50% -> 100%) 및 최종 완료 검증
func TestCanaryController_SuccessfulPromotion(t *testing.T) {
	cfg := DefaultCanaryConfig()
	cfg.Steps = []int{10, 50, 100}
	cfg.MinSampleCount = 20
	lm := NewLeaseManager(DefaultLeaseConfig())
	sampler := NewTailSampler(DefaultTailSampleConfig())
	ctrl := NewCanaryController(cfg, lm, sampler)

	state, err := ctrl.StartRollout("auth", "v3.0.0", "ci-bot")
	if err != nil {
		t.Fatalf("failed to start rollout: %v", err)
	}
	if state.CurrentWeight != 10 {
		t.Errorf("expected initial weight 10, got %d", state.CurrentWeight)
	}

	healthyMetrics := SlotMetrics{
		TotalRequests: 50,
		ErrorCount:    0,
		ErrorRate:     0.0,
		P99LatencyMs:  80.0,
	}

	// Step 1: Promote to 50%
	res1, err := ctrl.EvaluateCanary("auth", healthyMetrics)
	if err != nil {
		t.Fatalf("step 1 eval failed: %v", err)
	}
	if res1.Action != ActionPromote || res1.NextWeight != 50 {
		t.Errorf("expected promote to 50%%, got action=%s weight=%d", res1.Action, res1.NextWeight)
	}

	// Step 2: Promote to 100% -> Complete
	res2, err := ctrl.EvaluateCanary("auth", healthyMetrics)
	if err != nil {
		t.Fatalf("step 2 eval failed: %v", err)
	}
	if res2.Action != ActionComplete || res2.NextWeight != 100 {
		t.Errorf("expected complete at 100%%, got action=%s weight=%d", res2.Action, res2.NextWeight)
	}
	if res2.Status != RolloutStable {
		t.Errorf("expected RolloutStable, got %s", res2.Status)
	}
}

// 9. HTTP 엔드포인트 종합 테스트 (/v1/traces, /v1/rollouts/*, /v1/argo/analysis, /healthz, /metrics)
func TestServer_Endpoints(t *testing.T) {
	cfg := DefaultConfig()
	sampler := NewTailSampler(cfg.TailSampler)
	lm := NewLeaseManager(cfg.Lease)
	canary := NewCanaryController(cfg.Canary, lm, sampler)
	server := NewServer(cfg, sampler, lm, canary)
	handler := server.Handler()

	// 9.1 /healthz
	reqHealth := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	recHealth := httptest.NewRecorder()
	handler.ServeHTTP(recHealth, reqHealth)
	if recHealth.Code != http.StatusOK {
		t.Errorf("/healthz returned %d", recHealth.Code)
	}

	// 9.2 POST /v1/traces (Single JSON span)
	traceID := "aabbccddeeff00112233445566778899"
	traceJSON := fmt.Sprintf(`{
		"trace_id": "%s",
		"span_id": "0123456789abcdef",
		"service": "rolltrace",
		"operation": "GET /api",
		"status_code": 500,
		"duration_ms": 120,
		"slot": "canary"
	}`, traceID)

	reqTrace := httptest.NewRequest(http.MethodPost, "/v1/traces", bytes.NewBufferString(traceJSON))
	recTrace := httptest.NewRecorder()
	handler.ServeHTTP(recTrace, reqTrace)
	if recTrace.Code != http.StatusAccepted {
		t.Errorf("/v1/traces returned %d, body: %s", recTrace.Code, recTrace.Body.String())
	}

	// 9.3 GET /v1/traces/{traceID}
	reqGetTrace := httptest.NewRequest(http.MethodGet, "/v1/traces/"+traceID, nil)
	recGetTrace := httptest.NewRecorder()
	handler.ServeHTTP(recGetTrace, reqGetTrace)
	if recGetTrace.Code != http.StatusOK {
		t.Errorf("GET /v1/traces/%s returned %d, body: %s", traceID, recGetTrace.Code, recGetTrace.Body.String())
	}

	// 9.4 POST /v1/rollouts/start
	startJSON := `{"service": "rolltrace", "version": "v1.0.0", "holder_id": "argo-rollout-1"}`
	reqStart := httptest.NewRequest(http.MethodPost, "/v1/rollouts/start", bytes.NewBufferString(startJSON))
	recStart := httptest.NewRecorder()
	handler.ServeHTTP(recStart, reqStart)
	if recStart.Code != http.StatusOK {
		t.Errorf("POST /v1/rollouts/start returned %d, body: %s", recStart.Code, recStart.Body.String())
	}

	// 9.5 POST /v1/argo/analysis
	evalJSON := `{"service": "rolltrace"}`
	reqArgo := httptest.NewRequest(http.MethodPost, "/v1/argo/analysis", bytes.NewBufferString(evalJSON))
	recArgo := httptest.NewRecorder()
	handler.ServeHTTP(recArgo, reqArgo)
	if recArgo.Code != http.StatusOK {
		t.Errorf("POST /v1/argo/analysis returned %d, body: %s", recArgo.Code, recArgo.Body.String())
	}

	// 9.6 GET /metrics
	reqMetrics := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	recMetrics := httptest.NewRecorder()
	handler.ServeHTTP(recMetrics, reqMetrics)
	if recMetrics.Code != http.StatusOK {
		t.Errorf("GET /metrics returned %d", recMetrics.Code)
	}
}

// 10. 동시성 경합 테스트 (-race 검증, 100+ goroutine)
func TestConcurrent_RaceCondition(t *testing.T) {
	cfg := DefaultConfig()
	cfg.TailSampler.MaxBufferedTraces = 50
	sampler := NewTailSampler(cfg.TailSampler)
	lm := NewLeaseManager(cfg.Lease)
	canary := NewCanaryController(cfg.Canary, lm, sampler)

	const goroutines = 120
	var wg sync.WaitGroup
	wg.Add(goroutines)

	for i := 0; i < goroutines; i++ {
		idx := i
		go func() {
			defer wg.Done()

			traceID := fmt.Sprintf("race%028d", idx)
			slot := "stable"
			if idx%2 == 0 {
				slot = "canary"
			}

			// Concurrently ingest spans
			sampler.IngestSpan(&Span{
				TraceID:    traceID,
				SpanID:     fmt.Sprintf("span%012d", idx),
				Service:    "race-svc",
				StatusCode: 200 + (idx%3)*100, // mixture of 200, 300, 400
				DurationMs: int64(10 + (idx % 250)),
				Slot:       slot,
			})

			// Concurrently query metrics
			_ = sampler.GetSlotMetrics(slot)

			// Concurrently evaluate traces
			_ = sampler.EvaluateTrace(traceID)

			// Concurrently attempt lease operations
			holderID := fmt.Sprintf("holder-%d", idx%5)
			if l, err := lm.TryAcquire("race-service", holderID, 50*time.Millisecond); err == nil {
				_ = lm.Release("race-service", l.HolderID)
			}

			// Concurrently query canary state
			_, _ = canary.GetState("race-service")
		}()
	}

	wg.Wait()
}
