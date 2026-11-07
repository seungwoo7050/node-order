package idem

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// I1: 단일 실행 보장 (50개 동시 요청 경합 시 핸들러 단 1회 실행)
func TestConcurrentDuplicateRequestsExecuteHandlerOnce(t *testing.T) {
	store := NewMemoryStore(0)
	defer store.Close()

	var handlerExecCount atomic.Int32
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		handlerExecCount.Add(1)
		time.Sleep(30 * time.Millisecond) // Simulate DB transaction / payment API call
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"order_id":"ORD-999","status":"PAID"}`))
	})

	guard := NewGuard(store, WithWaitPolicy(PolicyWaitAndReplay), WithWaitTimeout(2*time.Second))
	wrapped := guard.Wrap(handler)

	const concurrentClients = 50
	var wg sync.WaitGroup
	wg.Add(concurrentClients)

	payload := `{"amount": 50000, "customer": "cust_123"}`
	recorders := make([]*httptest.ResponseRecorder, concurrentClients)

	for i := 0; i < concurrentClients; i++ {
		idx := i
		go func() {
			defer wg.Done()
			req := httptest.NewRequest(http.MethodPost, "/v1/orders", bytes.NewBufferString(payload))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Idempotency-Key", "idemp-key-shared-50")
			rec := httptest.NewRecorder()
			wrapped.ServeHTTP(rec, req)
			recorders[idx] = rec
		}()
	}

	wg.Wait()

	// Invariant I1 verification: handler executed exactly 1 time
	if count := handlerExecCount.Load(); count != 1 {
		t.Fatalf("expected handler to execute exactly 1 time under contention, got %d", count)
	}

	replayedCount := 0
	expectedBody := `{"order_id":"ORD-999","status":"PAID"}`

	for i, rec := range recorders {
		if rec == nil {
			t.Fatalf("nil recorder at index %d", i)
		}
		if rec.Code != http.StatusOK {
			t.Fatalf("client %d got status %d, expected 200", i, rec.Code)
		}
		if rec.Body.String() != expectedBody {
			t.Fatalf("client %d body mismatch: got %q, expected %q", i, rec.Body.String(), expectedBody)
		}
		if rec.Header().Get("X-Idempotent-Replayed") == "true" {
			replayedCount++
		}
	}

	// 1 leader executed and 49 follower requests were served the cached replay
	if replayedCount != concurrentClients-1 {
		t.Fatalf("expected %d replayed responses, got %d", concurrentClients-1, replayedCount)
	}
}

// I2: In-Flight 완료 대기 브로드캐스트 (close(done) 메커니즘 검증)
func TestInFlightWaitBroadcastsCapturedResponse(t *testing.T) {
	store := NewMemoryStore(0)
	defer store.Close()

	leaderStarted := make(chan struct{})
	leaderCanFinish := make(chan struct{})

	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(leaderStarted)
		<-leaderCanFinish
		w.Header().Set("X-Custom-Header", "settled")
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"result":"created"}`))
	})

	guard := NewGuard(store, WithWaitPolicy(PolicyWaitAndReplay), WithWaitTimeout(2*time.Second))
	wrapped := guard.Wrap(handler)

	// 1. Leader request
	var leaderRec *httptest.ResponseRecorder
	var wgLeader sync.WaitGroup
	wgLeader.Add(1)

	go func() {
		defer wgLeader.Done()
		req := httptest.NewRequest(http.MethodPost, "/items", bytes.NewBufferString(`{"name":"itemA"}`))
		req.Header.Set("Idempotency-Key", "wait-broadcast-key")
		rec := httptest.NewRecorder()
		wrapped.ServeHTTP(rec, req)
		leaderRec = rec
	}()

	// Wait until leader is in-flight
	<-leaderStarted

	// 2. Spawn 5 follower requests while leader is in-flight
	const numFollowers = 5
	var wgFollowers sync.WaitGroup
	wgFollowers.Add(numFollowers)

	followerRecs := make([]*httptest.ResponseRecorder, numFollowers)

	for i := 0; i < numFollowers; i++ {
		idx := i
		go func() {
			defer wgFollowers.Done()
			req := httptest.NewRequest(http.MethodPost, "/items", bytes.NewBufferString(`{"name":"itemA"}`))
			req.Header.Set("Idempotency-Key", "wait-broadcast-key")
			rec := httptest.NewRecorder()
			wrapped.ServeHTTP(rec, req)
			followerRecs[idx] = rec
		}()
	}

	// Small pause so followers reach the wait channel
	time.Sleep(30 * time.Millisecond)

	// Release leader
	close(leaderCanFinish)
	wgLeader.Wait()
	wgFollowers.Wait()

	if leaderRec == nil || leaderRec.Code != http.StatusCreated {
		t.Fatalf("leader failed: code=%v", leaderRec.Code)
	}
	if leaderRec.Body.String() != `{"result":"created"}` {
		t.Fatalf("leader body mismatch: %s", leaderRec.Body.String())
	}

	for i := 0; i < numFollowers; i++ {
		rec := followerRecs[i]
		if rec.Code != http.StatusCreated {
			t.Fatalf("follower %d expected status 201, got %d", i, rec.Code)
		}
		if rec.Header().Get("X-Idempotent-Replayed") != "true" {
			t.Fatalf("follower %d expected X-Idempotent-Replayed: true", i)
		}
		if rec.Body.String() != `{"result":"created"}` {
			t.Fatalf("follower %d body mismatch: %s", i, rec.Body.String())
		}
	}
}

// In-Flight 즉시 거절 정책 (PolicyReject409)
func TestInFlightReject409Policy(t *testing.T) {
	store := NewMemoryStore(0)
	defer store.Close()

	leaderStarted := make(chan struct{})
	leaderRelease := make(chan struct{})

	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(leaderStarted)
		<-leaderRelease
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})

	guard := NewGuard(store, WithWaitPolicy(PolicyReject409))
	wrapped := guard.Wrap(handler)

	go func() {
		req := httptest.NewRequest(http.MethodPost, "/pay", bytes.NewBufferString(`{"key":"val"}`))
		req.Header.Set("Idempotency-Key", "policy-409-key")
		rec := httptest.NewRecorder()
		wrapped.ServeHTTP(rec, req)
	}()

	<-leaderStarted

	// Follower request during in-flight
	reqFollower := httptest.NewRequest(http.MethodPost, "/pay", bytes.NewBufferString(`{"key":"val"}`))
	reqFollower.Header.Set("Idempotency-Key", "policy-409-key")
	recFollower := httptest.NewRecorder()
	wrapped.ServeHTTP(recFollower, reqFollower)

	if recFollower.Code != http.StatusConflict {
		t.Fatalf("expected 409 Conflict under PolicyReject409, got %d", recFollower.Code)
	}
	if recFollower.Header().Get("Retry-After") != "1" {
		t.Fatalf("expected Retry-After: 1 header")
	}

	close(leaderRelease)
}

// I3: 페이로드 변조 차단 (Fingerprint Mismatch -> 422 Unprocessable Entity)
func TestSameKeyWithDifferentPayloadReturns422(t *testing.T) {
	store := NewMemoryStore(0)
	defer store.Close()

	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})

	guard := NewGuard(store)
	wrapped := guard.Wrap(handler)

	key := "tamper-check-key"

	// 1. Initial request with 10,000 KRW
	req1 := httptest.NewRequest(http.MethodPost, "/transfer", bytes.NewBufferString(`{"amount":10000,"currency":"KRW"}`))
	req1.Header.Set("Idempotency-Key", key)
	rec1 := httptest.NewRecorder()
	wrapped.ServeHTTP(rec1, req1)
	if rec1.Code != http.StatusOK {
		t.Fatalf("initial request failed: status=%v", rec1.Code)
	}

	// 2. Re-send with same key but altered payload (amount: 99999)
	req2 := httptest.NewRequest(http.MethodPost, "/transfer", bytes.NewBufferString(`{"amount":99999,"currency":"KRW"}`))
	req2.Header.Set("Idempotency-Key", key)
	rec2 := httptest.NewRecorder()
	wrapped.ServeHTTP(rec2, req2)

	if rec2.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422 Unprocessable Entity, got %d", rec2.Code)
	}
	if rec2.Header().Get("X-Idempotent-Error") != "fingerprint_mismatch" {
		t.Fatalf("expected X-Idempotent-Error: fingerprint_mismatch header")
	}

	// 3. Re-send with same key and same payload but different path -> 422
	req3 := httptest.NewRequest(http.MethodPost, "/refund", bytes.NewBufferString(`{"amount":10000,"currency":"KRW"}`))
	req3.Header.Set("Idempotency-Key", key)
	rec3 := httptest.NewRecorder()
	wrapped.ServeHTTP(rec3, req3)

	if rec3.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422 for path mismatch with same key, got %d", rec3.Code)
	}
}

// I4: 5xx 서버 오류 및 패닉 시 락 즉시 해제 (과도한 500 캐싱 방어)
func TestServerErrorAndPanicReleaseIdempotencyLock(t *testing.T) {
	store := NewMemoryStore(0)
	defer store.Close()

	var attemptCount atomic.Int32
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempt := attemptCount.Add(1)
		if attempt == 1 {
			// First call fails with 500
			http.Error(w, "transient database timeout", http.StatusInternalServerError)
			return
		}
		// Second call succeeds with 200
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"result":"recovered"}`))
	})

	guard := NewGuard(store)
	wrapped := guard.Wrap(handler)

	key := "transient-err-key"
	payload := `{"action":"deposit"}`

	// 1. First request gets 500
	req1 := httptest.NewRequest(http.MethodPost, "/deposit", bytes.NewBufferString(payload))
	req1.Header.Set("Idempotency-Key", key)
	rec1 := httptest.NewRecorder()
	wrapped.ServeHTTP(rec1, req1)
	if rec1.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", rec1.Code)
	}

	// Verify the lock was deleted: Get should return ErrNotFound
	if _, err := store.Get(context.Background(), key); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected lock to be deleted after 5xx error, but found record: %v", err)
	}

	// 2. Retry with same key succeeds and executes handler again
	req2 := httptest.NewRequest(http.MethodPost, "/deposit", bytes.NewBufferString(payload))
	req2.Header.Set("Idempotency-Key", key)
	rec2 := httptest.NewRecorder()
	wrapped.ServeHTTP(rec2, req2)

	if rec2.Code != http.StatusOK {
		t.Fatalf("expected retry to succeed with 200, got %d", rec2.Code)
	}
	if attemptCount.Load() != 2 {
		t.Fatalf("expected handler to execute twice, got %d", attemptCount.Load())
	}

	// Subtest: Panic recovery releases lock
	panicKey := "panic-key"
	var panicAttempt atomic.Int32
	panicHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if panicAttempt.Add(1) == 1 {
			panic("unexpected nil pointer dereference")
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"recovered":true}`))
	})

	// Custom wrapper with outer recover to prevent test runner crash
	wrappedPanicHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if r := recover(); r != nil {
				w.WriteHeader(http.StatusInternalServerError)
			}
		}()
		guard.Wrap(panicHandler).ServeHTTP(w, r)
	})

	reqPanic1 := httptest.NewRequest(http.MethodPost, "/panic", bytes.NewBufferString(`{}`))
	reqPanic1.Header.Set("Idempotency-Key", panicKey)
	recPanic1 := httptest.NewRecorder()
	wrappedPanicHandler.ServeHTTP(recPanic1, reqPanic1)

	// Ensure lock deleted on panic
	if _, err := store.Get(context.Background(), panicKey); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected lock to be deleted after panic")
	}

	// Retry succeeds
	reqPanic2 := httptest.NewRequest(http.MethodPost, "/panic", bytes.NewBufferString(`{}`))
	reqPanic2.Header.Set("Idempotency-Key", panicKey)
	recPanic2 := httptest.NewRecorder()
	wrappedPanicHandler.ServeHTTP(recPanic2, reqPanic2)

	if recPanic2.Code != http.StatusOK {
		t.Fatalf("expected retry after panic to succeed with 200, got %d", recPanic2.Code)
	}
}

// I5: TTL 만료 자동 수거 (Reaper 동작 후 재실행 가능성 검증)
func TestExpiredRecordsAreSweptAndReExecutable(t *testing.T) {
	store := NewMemoryStore(0)
	defer store.Close()

	var execCount atomic.Int32
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		execCount.Add(1)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"token":"abc"}`))
	})

	shortTTL := 50 * time.Millisecond
	guard := NewGuard(store, WithTTL(shortTTL))
	wrapped := guard.Wrap(handler)

	key := "ttl-expire-key"
	req1 := httptest.NewRequest(http.MethodPost, "/auth", bytes.NewBufferString(`{}`))
	req1.Header.Set("Idempotency-Key", key)
	rec1 := httptest.NewRecorder()
	wrapped.ServeHTTP(rec1, req1)

	if execCount.Load() != 1 {
		t.Fatalf("expected 1 execution")
	}

	// Immediate replay returns cached response
	req2 := httptest.NewRequest(http.MethodPost, "/auth", bytes.NewBufferString(`{}`))
	req2.Header.Set("Idempotency-Key", key)
	rec2 := httptest.NewRecorder()
	wrapped.ServeHTTP(rec2, req2)
	if execCount.Load() != 1 {
		t.Fatalf("expected cached response without re-executing handler")
	}

	// Wait past TTL and sweep
	time.Sleep(60 * time.Millisecond)
	store.SweepExpired(time.Now())

	// Request should re-execute
	req3 := httptest.NewRequest(http.MethodPost, "/auth", bytes.NewBufferString(`{}`))
	req3.Header.Set("Idempotency-Key", key)
	rec3 := httptest.NewRecorder()
	wrapped.ServeHTTP(rec3, req3)

	if execCount.Load() != 2 {
		t.Fatalf("expected re-execution after TTL expiration, got %d", execCount.Load())
	}
}

// Safe methods (GET, OPTIONS) bypass idempotency
func TestSafeMethodsBypass(t *testing.T) {
	store := NewMemoryStore(0)
	defer store.Close()

	var getExecCount atomic.Int32
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		getExecCount.Add(1)
		w.WriteHeader(http.StatusOK)
	})

	guard := NewGuard(store)
	wrapped := guard.Wrap(handler)

	for i := 0; i < 3; i++ {
		req := httptest.NewRequest(http.MethodGet, "/profile", nil)
		req.Header.Set("Idempotency-Key", "same-key-get")
		rec := httptest.NewRecorder()
		wrapped.ServeHTTP(rec, req)
	}

	if getExecCount.Load() != 3 {
		t.Fatalf("GET requests should bypass idempotency guard; expected 3 executions, got %d", getExecCount.Load())
	}
}

// Prometheus Metrics handler verification
func TestMetricsEndpoint(t *testing.T) {
	store := NewMemoryStore(0)
	defer store.Close()

	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	guard := NewGuard(store)
	wrapped := guard.Wrap(handler)

	// Execute an idempotent request
	req := httptest.NewRequest(http.MethodPost, "/pay", bytes.NewBufferString(`{"a":1}`))
	req.Header.Set("Idempotency-Key", "metrics-key")
	rec := httptest.NewRecorder()
	wrapped.ServeHTTP(rec, req)

	// Fetch metrics
	mReq := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	mRec := httptest.NewRecorder()
	guard.MetricsHandler().ServeHTTP(mRec, mReq)

	mStr := mRec.Body.String()
	if !bytes.Contains([]byte(mStr), []byte("idemguard_acquired_total 1")) {
		t.Fatalf("expected acquired_total 1 in metrics output:\n%s", mStr)
	}
}
