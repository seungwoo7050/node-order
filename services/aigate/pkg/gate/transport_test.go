package gate

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type roundTripFunc func(req *http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

// Invariant I1: TestSingleFlightLeaderCancelDoesNotAbortFollowers proves that when the leader
// caller's context is cancelled, the upstream call continues unharmed so followers receive valid results.
func TestSingleFlightLeaderCancelDoesNotAbortFollowers(t *testing.T) {
	group := NewGroup()
	key := "test-leader-cancel"

	started := make(chan struct{})
	upstreamFinished := make(chan struct{})
	var upstreamCallCount atomic.Int32

	slowFn := func(execCtx context.Context) (any, error) {
		upstreamCallCount.Add(1)
		close(started)

		select {
		case <-time.After(150 * time.Millisecond):
			close(upstreamFinished)
			return "upstream-ok", nil
		case <-execCtx.Done():
			return nil, execCtx.Err()
		}
	}

	leaderCtx, leaderCancel := context.WithCancel(context.Background())
	followerCtx := context.Background()

	var wg sync.WaitGroup
	var followerVal any
	var followerErr error
	var leaderVal any
	var leaderErr error

	// 1. Leader starts call
	wg.Add(1)
	go func() {
		defer wg.Done()
		leaderVal, leaderErr, _ = group.Do(leaderCtx, key, slowFn)
	}()

	<-started

	// 2. Follower joins in-flight call
	wg.Add(1)
	go func() {
		defer wg.Done()
		followerVal, followerErr, _ = group.Do(followerCtx, key, slowFn)
	}()

	// Small pause to ensure follower registered in subscribers
	time.Sleep(20 * time.Millisecond)

	// 3. Leader cancels its context while upstream is still executing
	leaderCancel()

	wg.Wait()

	// Leader must receive context.Canceled
	if leaderErr != context.Canceled {
		t.Fatalf("expected leader context.Canceled, got: %v (val=%v)", leaderErr, leaderVal)
	}

	// Follower must receive successful response unharmed
	if followerErr != nil {
		t.Fatalf("follower failed unexpectedly: %v", followerErr)
	}
	if followerVal != "upstream-ok" {
		t.Fatalf("expected follower to receive 'upstream-ok', got: %v", followerVal)
	}

	// Upstream must have run exactly once
	if calls := upstreamCallCount.Load(); calls != 1 {
		t.Fatalf("expected exactly 1 upstream call, got %d", calls)
	}

	select {
	case <-upstreamFinished:
		// Upstream finished successfully
	default:
		t.Fatal("upstream call did not finish normally")
	}
}

// Invariant I1 (Edge): TestSingleFlightAllCallersCancelAbortsUpstream proves that when ALL callers
// cancel their contexts, the upstream call's context is cancelled immediately.
func TestSingleFlightAllCallersCancelAbortsUpstream(t *testing.T) {
	group := NewGroup()
	key := "test-all-cancel"

	started := make(chan struct{})
	upstreamAborted := make(chan struct{})

	abortableFn := func(execCtx context.Context) (any, error) {
		close(started)
		select {
		case <-time.After(500 * time.Millisecond):
			return "too-slow", nil
		case <-execCtx.Done():
			close(upstreamAborted)
			return nil, execCtx.Err()
		}
	}

	ctx1, cancel1 := context.WithCancel(context.Background())
	ctx2, cancel2 := context.WithCancel(context.Background())

	var wg sync.WaitGroup

	wg.Add(1)
	go func() {
		defer wg.Done()
		_, _, _ = group.Do(ctx1, key, abortableFn)
	}()

	<-started

	wg.Add(1)
	go func() {
		defer wg.Done()
		_, _, _ = group.Do(ctx2, key, abortableFn)
	}()

	time.Sleep(20 * time.Millisecond)

	// Cancel caller 1
	cancel1()
	time.Sleep(20 * time.Millisecond)

	select {
	case <-upstreamAborted:
		t.Fatal("upstream was aborted while caller 2 was still active")
	default:
		// Expected: upstream is still running
	}

	// Cancel caller 2: Now all subscribers cancelled
	cancel2()

	wg.Wait()

	select {
	case <-upstreamAborted:
		// Expected: upstream was aborted once all subscribers cancelled
	case <-time.After(300 * time.Millisecond):
		t.Fatal("upstream call was not aborted after all callers cancelled")
	}
}

// Invariant I2: TestCircuitBreakerHalfOpenSingleProbe proves that transitioning from Open to Half-Open
// after cooldown admits strictly at most MaxHalfOpenProbes concurrent request while fast-failing others.
func TestCircuitBreakerHalfOpenSingleProbe(t *testing.T) {
	cfg := BreakerConfig{
		FailureThreshold:  2,
		Cooldown:          100 * time.Millisecond,
		MaxHalfOpenProbes: 1,
	}
	cb := NewCircuitBreaker(cfg)

	t0 := time.Now()

	// 1. Initially StateClosed
	if state := cb.State(); state != StateClosed {
		t.Fatalf("expected StateClosed, got %v", state)
	}

	// 2. Fail twice to trip breaker to StateOpen
	allowed, done1 := cb.Allow(t0)
	if !allowed {
		t.Fatal("expected request 1 allowed")
	}
	done1(false)

	allowed, done2 := cb.Allow(t0)
	if !allowed {
		t.Fatal("expected request 2 allowed")
	}
	done2(false)

	if state := cb.State(); state != StateOpen {
		t.Fatalf("expected StateOpen after 2 failures, got %v", state)
	}

	// 3. Before cooldown elapses (e.g. t0 + 40ms): requests must fail fast
	allowed, _ = cb.Allow(t0.Add(40 * time.Millisecond))
	if allowed {
		t.Fatal("expected request blocked during cooldown")
	}

	// 4. After cooldown (t0 + 120ms): transition to Half-Open
	tAfterCooldown := t0.Add(120 * time.Millisecond)

	// First probe request is admitted
	probeAllowed, probeDone := cb.Allow(tAfterCooldown)
	if !probeAllowed {
		t.Fatal("expected first probe allowed in Half-Open")
	}

	// Concurrent probe requests while first probe is in flight MUST be rejected (MaxHalfOpenProbes=1)
	concurrent1, _ := cb.Allow(tAfterCooldown)
	if concurrent1 {
		t.Fatal("expected concurrent probe 1 to be rejected (saturated)")
	}

	concurrent2, _ := cb.Allow(tAfterCooldown)
	if concurrent2 {
		t.Fatal("expected concurrent probe 2 to be rejected (saturated)")
	}

	// 5. Probe succeeds: Breaker should reset to StateClosed
	probeDone(true)

	if state := cb.State(); state != StateClosed {
		t.Fatalf("expected StateClosed after probe success, got %v", state)
	}

	// Subsequent requests should be allowed in StateClosed
	postAllowed, postDone := cb.Allow(tAfterCooldown.Add(10 * time.Millisecond))
	if !postAllowed {
		t.Fatal("expected request allowed after recovery to Closed")
	}
	postDone(true)

	// 6. Test probe failure branch: trip again, let probe fail, verify re-tripping to Open
	cb.Trip(t0)
	tNextCooldown := t0.Add(120 * time.Millisecond)

	probe2Allowed, probe2Done := cb.Allow(tNextCooldown)
	if !probe2Allowed {
		t.Fatal("expected probe 2 allowed in Half-Open")
	}
	// Probe fails!
	probe2Done(false)

	if state := cb.State(); state != StateOpen {
		t.Fatalf("expected StateOpen after failed probe, got %v", state)
	}
}

// Invariant I3: TestFailoverOnPrimary503AndCircuitOpen proves that when the primary provider
// fails with 503 or has an open circuit, requests fail over to the secondary provider.
func TestFailoverOnPrimary503AndCircuitOpen(t *testing.T) {
	var primaryHits atomic.Int32
	var fallbackHits atomic.Int32

	primaryRT := roundTripFunc(func(req *http.Request) (*http.Response, error) {
		primaryHits.Add(1)
		return &http.Response{
			StatusCode: http.StatusServiceUnavailable,
			Status:     "503 Service Unavailable",
			Proto:      "HTTP/1.1",
			ProtoMajor: 1,
			ProtoMinor: 1,
			Header:     make(http.Header),
			Body:       io.NopCloser(strings.NewReader(`{"error":"primary unavailable"}`)),
			Request:    req,
		}, nil
	})

	fallbackRT := roundTripFunc(func(req *http.Request) (*http.Response, error) {
		fallbackHits.Add(1)
		return &http.Response{
			StatusCode: http.StatusOK,
			Status:     "200 OK",
			Proto:      "HTTP/1.1",
			ProtoMajor: 1,
			ProtoMinor: 1,
			Header:     make(http.Header),
			Body:       io.NopCloser(strings.NewReader(`{"choices":[{"message":{"content":"fallback response"}}]}`)),
			Request:    req,
		}, nil
	})

	cfg := DefaultConfig()
	cfg.Breaker.FailureThreshold = 2
	cfg.Breaker.Cooldown = 1 * time.Second
	cfg.Providers = []ProviderConfig{
		{
			Name:     "primary",
			BaseURL:  "http://primary.internal",
			Priority: 1,
			Timeout:  2 * time.Second,
		},
		{
			Name:     "fallback",
			BaseURL:  "http://fallback.internal",
			Priority: 2,
			Timeout:  2 * time.Second,
		},
	}

	gateway := NewGateway(cfg)
	gateway.Failover().SetProviderTransport("primary", primaryRT)
	gateway.Failover().SetProviderTransport("fallback", fallbackRT)

	client := &http.Client{Transport: gateway}

	// Request 1: Primary returns 503 -> fails over to fallback
	req1, _ := http.NewRequest(http.MethodPost, "http://localhost/v1/chat/completions", strings.NewReader(`{"model":"gpt-4o"}`))
	req1.Header.Set("Content-Type", "application/json")
	resp1, err := client.Do(req1)
	if err != nil {
		t.Fatalf("request 1 failed: %v", err)
	}
	defer resp1.Body.Close()

	if resp1.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK from fallback, got: %d", resp1.StatusCode)
	}
	if prov := resp1.Header.Get("X-AIGate-Provider"); prov != "fallback" {
		t.Fatalf("expected provider 'fallback', got: %q", prov)
	}
	if count := resp1.Header.Get("X-AIGate-Failover-Count"); count != "1" {
		t.Fatalf("expected failover count '1', got: %q", count)
	}

	// Request 2: Second failure on primary trips primary breaker to StateOpen
	req2, _ := http.NewRequest(http.MethodPost, "http://localhost/v1/chat/completions", strings.NewReader(`{"model":"gpt-4o"}`))
	resp2, err := client.Do(req2)
	if err != nil {
		t.Fatalf("request 2 failed: %v", err)
	}
	_ = resp2.Body.Close()

	primaryBreaker := gateway.Failover().GetProviderBreaker("primary")
	if primaryBreaker == nil || primaryBreaker.State() != StateOpen {
		t.Fatalf("expected primary breaker StateOpen, got %v", primaryBreaker.State())
	}

	primaryHitsBefore := primaryHits.Load()

	// Request 3: Primary breaker is StateOpen; gateway should immediately skip primary
	req3, _ := http.NewRequest(http.MethodPost, "http://localhost/v1/chat/completions", strings.NewReader(`{"model":"gpt-4o"}`))
	resp3, err := client.Do(req3)
	if err != nil {
		t.Fatalf("request 3 failed: %v", err)
	}
	_ = resp3.Body.Close()

	if primaryHits.Load() != primaryHitsBefore {
		t.Fatalf("expected primary server to be bypassed while circuit is open, hits increased from %d to %d",
			primaryHitsBefore, primaryHits.Load())
	}
	if resp3.Header.Get("X-AIGate-Provider") != "fallback" {
		t.Fatalf("expected provider 'fallback', got: %q", resp3.Header.Get("X-AIGate-Provider"))
	}
}

type mockFlusherWriter struct {
	header     http.Header
	statusCode int
	mu         sync.Mutex
	buf        bytes.Buffer
	flushes    int
}

func newMockFlusherWriter() *mockFlusherWriter {
	return &mockFlusherWriter{
		header: make(http.Header),
	}
}

func (m *mockFlusherWriter) Header() http.Header {
	return m.header
}

func (m *mockFlusherWriter) WriteHeader(statusCode int) {
	m.statusCode = statusCode
}

func (m *mockFlusherWriter) Write(b []byte) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.buf.Write(b)
}

func (m *mockFlusherWriter) Flush() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.flushes++
}

func (m *mockFlusherWriter) String() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.buf.String()
}

func (m *mockFlusherWriter) FlushCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.flushes
}

// Invariant I4: TestSSEStreamFlushesChunksImmediately proves that text/event-stream responses
// bypass single-flight buffering and flush tokens chunk-by-chunk to downstream clients.
func TestSSEStreamFlushesChunksImmediately(t *testing.T) {
	pr, pw := io.Pipe()

	streamingRT := roundTripFunc(func(req *http.Request) (*http.Response, error) {
		resp := &http.Response{
			StatusCode: http.StatusOK,
			Status:     "200 OK",
			Proto:      "HTTP/1.1",
			ProtoMajor: 1,
			ProtoMinor: 1,
			Header: http.Header{
				"Content-Type":  []string{"text/event-stream"},
				"Cache-Control": []string{"no-cache"},
			},
			Body:    pr,
			Request: req,
		}
		return resp, nil
	})

	cfg := DefaultConfig()
	cfg.Providers = []ProviderConfig{
		{
			Name:     "streaming-upstream",
			BaseURL:  "http://streaming.internal",
			Priority: 1,
			Timeout:  5 * time.Second,
		},
	}

	gateway := NewGateway(cfg)
	gateway.Failover().SetProviderTransport("streaming-upstream", streamingRT)

	req, _ := http.NewRequest(http.MethodPost, "http://localhost/v1/completions", strings.NewReader(`{"stream":true}`))
	req.Header.Set("Accept", "text/event-stream")
	req.Header.Set("Content-Type", "application/json")

	writer := newMockFlusherWriter()

	done := make(chan struct{})
	go func() {
		gateway.ServeHTTP(writer, req)
		close(done)
	}()

	// 1. Write chunk 1 through the upstream pipe
	_, err := pw.Write([]byte("data: token1\n\n"))
	if err != nil {
		t.Fatalf("pipe write 1 failed: %v", err)
	}

	// 2. Poll writer for immediate arrival of chunk 1 before stream ends
	var chunk1Received bool
	deadline := time.Now().Add(500 * time.Millisecond)
	for time.Now().Before(deadline) {
		if strings.Contains(writer.String(), "data: token1\n\n") {
			chunk1Received = true
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	if !chunk1Received {
		t.Fatal("chunk 1 was not flushed immediately to client (TTFT violation)")
	}
	if writer.FlushCount() == 0 {
		t.Fatal("expected Flush() to be invoked on Flusher")
	}

	// 3. Write chunk 2 and close pipe
	_, _ = pw.Write([]byte("data: [DONE]\n\n"))
	_ = pw.Close()

	<-done

	if !strings.Contains(writer.String(), "data: [DONE]\n\n") {
		t.Fatalf("expected stream to contain [DONE], got: %s", writer.String())
	}
}

// Invariant I5: TestTokenBucketRateLimitAndRetryAfter proves exact elapsed-time token refill,
// 429 status code with Retry-After header, and idle bucket eviction via SweepIdle.
func TestTokenBucketRateLimitAndRetryAfter(t *testing.T) {
	cfg := RateLimitConfig{
		RequestsPerSecond: 2.0, // 1 token every 500ms
		Burst:             2.0,
		IdleTTL:           100 * time.Millisecond,
	}
	limiter := NewTokenBucketLimiter(cfg)

	t0 := time.Now()

	// 1. Consume 2 burst tokens
	allowed, retryAfter, remaining := limiter.Take("tenant-a", t0)
	if !allowed || remaining > 1.0 {
		t.Fatalf("take 1 failed: allowed=%v, remaining=%v", allowed, remaining)
	}

	allowed, retryAfter, remaining = limiter.Take("tenant-a", t0)
	if !allowed || remaining > 0.1 {
		t.Fatalf("take 2 failed: allowed=%v, remaining=%v", allowed, remaining)
	}

	// 2. Third request immediately at t0 must be rejected
	allowed, retryAfter, _ = limiter.Take("tenant-a", t0)
	if allowed {
		t.Fatal("expected request 3 to be rate limited")
	}
	if retryAfter < 400*time.Millisecond || retryAfter > 600*time.Millisecond {
		t.Fatalf("expected ~500ms Retry-After, got %v", retryAfter)
	}

	// 3. Different tenant must have an independent quota
	allowedB, _, _ := limiter.Take("tenant-b", t0)
	if !allowedB {
		t.Fatal("expected tenant-b request to succeed independently")
	}

	// 4. Advance time by 500ms: tenant-a should get 1 refilled token
	t1 := t0.Add(500 * time.Millisecond)
	allowedAfterRefill, _, _ := limiter.Take("tenant-a", t1)
	if !allowedAfterRefill {
		t.Fatal("expected tenant-a to succeed after 500ms refill")
	}

	// 5. Sweep idle tenants: advance time past IdleTTL (100ms)
	if count := limiter.BucketCount(); count != 2 {
		t.Fatalf("expected 2 active buckets, got %d", count)
	}

	tIdle := t1.Add(200 * time.Millisecond)
	evicted := limiter.SweepIdle(tIdle)
	if evicted != 2 {
		t.Fatalf("expected 2 idle buckets evicted, got %d", evicted)
	}
	if count := limiter.BucketCount(); count != 0 {
		t.Fatalf("expected 0 active buckets after sweep, got %d", count)
	}
}

// TestConcurrentSingleFlightContention verifies single-flight coalescing under race detector.
func TestConcurrentSingleFlightContention(t *testing.T) {
	var upstreamCalls atomic.Int32

	mockRT := roundTripFunc(func(req *http.Request) (*http.Response, error) {
		upstreamCalls.Add(1)
		time.Sleep(30 * time.Millisecond)
		return &http.Response{
			StatusCode: http.StatusOK,
			Status:     "200 OK",
			Proto:      "HTTP/1.1",
			ProtoMajor: 1,
			ProtoMinor: 1,
			Header:     http.Header{"Content-Type": []string{"application/json"}},
			Body:       io.NopCloser(strings.NewReader(`{"result":"coalesced-response"}`)),
			Request:    req,
		}, nil
	})

	cfg := DefaultConfig()
	cfg.Providers = []ProviderConfig{
		{
			Name:     "primary",
			BaseURL:  "http://primary.internal",
			Priority: 1,
		},
	}

	gateway := NewGateway(cfg)
	gateway.Failover().SetProviderTransport("primary", mockRT)

	concurrency := 20
	var wg sync.WaitGroup
	wg.Add(concurrency)

	for i := 0; i < concurrency; i++ {
		go func() {
			defer wg.Done()
			req, _ := http.NewRequest(http.MethodPost, "http://localhost/v1/query", strings.NewReader(`{"query":"identical"}`))
			req.Header.Set("Content-Type", "application/json")
			recorder := httptest.NewRecorder()

			gateway.ServeHTTP(recorder, req)

			if recorder.Code != http.StatusOK {
				t.Errorf("expected 200, got %d", recorder.Code)
			}
			if !strings.Contains(recorder.Body.String(), "coalesced-response") {
				t.Errorf("unexpected body: %s", recorder.Body.String())
			}
		}()
	}

	wg.Wait()

	calls := upstreamCalls.Load()
	if calls != 1 {
		t.Fatalf("expected exactly 1 upstream call for 20 coalesced requests, got %d", calls)
	}

	requests, coalesced, _, _ := gateway.Metrics()
	if requests != uint64(concurrency) {
		t.Fatalf("expected %d requests total, got %d", concurrency, requests)
	}
	if coalesced != uint64(concurrency-1) {
		t.Fatalf("expected %d coalesced requests, got %d", concurrency-1, coalesced)
	}
}

// TestMetricsExposition verifies Prometheus /metrics endpoint format and counters.
func TestMetricsExposition(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Providers = []ProviderConfig{
		{Name: "openai-main", BaseURL: "http://localhost:9001", Priority: 1},
		{Name: "anthropic-backup", BaseURL: "http://localhost:9002", Priority: 2},
	}

	gateway := NewGateway(cfg)

	recorder := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/metrics", nil)
	gateway.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for /metrics, got %d", recorder.Code)
	}

	body := recorder.Body.String()
	expectedMetrics := []string{
		"aigate_requests_total",
		"aigate_coalesced_total",
		"aigate_rate_limited_total",
		"aigate_failover_total",
		`aigate_circuit_state{provider="openai-main"} 0`,
		`aigate_circuit_state{provider="anthropic-backup"} 0`,
	}

	for _, m := range expectedMetrics {
		if !strings.Contains(body, m) {
			t.Errorf("metrics output missing expected line: %s\nFull body:\n%s", m, body)
		}
	}
}

// TestHealthzEndpoint verifies the /healthz endpoint.
func TestHealthzEndpoint(t *testing.T) {
	cfg := DefaultConfig()
	gateway := NewGateway(cfg)

	recorder := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/healthz", nil)
	gateway.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for /healthz, got %d", recorder.Code)
	}
	if !strings.Contains(recorder.Body.String(), `"status":"ok"`) {
		t.Fatalf("expected status ok, got %s", recorder.Body.String())
	}
}
