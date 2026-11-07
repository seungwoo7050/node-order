package relay

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// Invariant I1: Atomic Enqueue
// Proves that when EnqueueTx is used within a database transaction,
// rolling back the transaction completely removes the event from the store.
func TestEnqueueTxRollbackRemovesEvent(t *testing.T) {
	ctx := context.Background()
	store := NewMemStore()

	tx := store.BeginTx()
	ev := &Event{
		ID:       "evt_tx_rollback",
		Topic:    "order.created",
		Endpoint: "http://example.com/webhook",
		Payload:  json.RawMessage(`{"order_id": "ord_101"}`),
	}

	if err := store.EnqueueTx(ctx, tx, ev); err != nil {
		t.Fatalf("unexpected EnqueueTx error: %v", err)
	}

	// Before commit, event must not be claimable
	claimedPre, err := store.ClaimBatch(ctx, "worker-1", 10)
	if err != nil {
		t.Fatalf("unexpected ClaimBatch error: %v", err)
	}
	if len(claimedPre) != 0 {
		t.Fatalf("expected 0 claimed events before commit, got %d", len(claimedPre))
	}

	// Rollback transaction
	if err := tx.Rollback(); err != nil {
		t.Fatalf("failed to rollback tx: %v", err)
	}

	// After rollback, event must not exist in store
	claimedPost, err := store.ClaimBatch(ctx, "worker-1", 10)
	if err != nil {
		t.Fatalf("unexpected ClaimBatch error: %v", err)
	}
	if len(claimedPost) != 0 {
		t.Fatalf("expected 0 claimed events after rollback, got %d", len(claimedPost))
	}

	// Verify Commit path works as expected
	tx2 := store.BeginTx()
	ev2 := &Event{
		ID:       "evt_tx_commit",
		Topic:    "order.paid",
		Endpoint: "http://example.com/webhook",
		Payload:  json.RawMessage(`{"order_id": "ord_102"}`),
	}
	if err := store.EnqueueTx(ctx, tx2, ev2); err != nil {
		t.Fatalf("unexpected EnqueueTx error: %v", err)
	}
	if err := tx2.Commit(); err != nil {
		t.Fatalf("failed to commit tx2: %v", err)
	}

	claimedCommitted, err := store.ClaimBatch(ctx, "worker-1", 10)
	if err != nil {
		t.Fatalf("unexpected ClaimBatch error: %v", err)
	}
	if len(claimedCommitted) != 1 || claimedCommitted[0].ID != "evt_tx_commit" {
		t.Fatalf("expected evt_tx_commit to be claimed, got %v", claimedCommitted)
	}
}

// Invariant I2: No Double Claim under high contention
// Proves that multiple concurrent workers calling ClaimBatch never claim the same event.
func TestConcurrentWorkersNeverClaimSameEvent(t *testing.T) {
	ctx := context.Background()
	store := NewMemStore()

	const totalEvents = 100
	const workerCount = 10

	for i := 0; i < totalEvents; i++ {
		ev := &Event{
			ID:       fmt.Sprintf("evt_concurrent_%03d", i),
			Topic:    "payment.completed",
			Endpoint: "http://example.com/webhook",
			Payload:  json.RawMessage(`{"amount": 5000}`),
		}
		if err := store.Enqueue(ctx, ev); err != nil {
			t.Fatalf("failed to enqueue event %d: %v", i, err)
		}
	}

	var mu sync.Mutex
	claimedMap := make(map[string]string) // eventID -> workerID
	var duplicateCount atomic.Int64

	var wg sync.WaitGroup
	wg.Add(workerCount)

	for w := 0; w < workerCount; w++ {
		workerID := fmt.Sprintf("worker-%d", w)
		go func(wid string) {
			defer wg.Done()
			for {
				batch, err := store.ClaimBatch(ctx, wid, 5)
				if err != nil || len(batch) == 0 {
					return
				}

				mu.Lock()
				for _, ev := range batch {
					if existingWorker, exists := claimedMap[ev.ID]; exists {
						duplicateCount.Add(1)
						t.Errorf("DOUBLE CLAIM DETECTED: event %s claimed by %s and %s", ev.ID, existingWorker, wid)
					}
					claimedMap[ev.ID] = wid
				}
				mu.Unlock()
			}
		}(workerID)
	}

	wg.Wait()

	if duplicateCount.Load() != 0 {
		t.Fatalf("detected %d double claims!", duplicateCount.Load())
	}
	if len(claimedMap) != totalEvents {
		t.Fatalf("expected all %d events to be claimed, got %d", totalEvents, len(claimedMap))
	}
}

// Invariant I3: Stale Lock Recovery
// Proves that if a worker crashes during processing, ReclaimStale returns
// the abandoned event back to pending status after the lease timeout expires.
func TestStaleProcessingEventReclaimedAfterLeaseExpiry(t *testing.T) {
	ctx := context.Background()
	store := NewMemStore()

	ev := &Event{
		ID:       "evt_crashed_worker",
		Topic:    "user.registered",
		Endpoint: "http://example.com/webhook",
		Payload:  json.RawMessage(`{"user_id": "u_999"}`),
	}
	if err := store.Enqueue(ctx, ev); err != nil {
		t.Fatalf("failed to enqueue: %v", err)
	}

	// Worker 1 claims the event
	claimed, err := store.ClaimBatch(ctx, "crashed-worker", 1)
	if err != nil || len(claimed) != 1 {
		t.Fatalf("expected 1 claimed event, got %d (err: %v)", len(claimed), err)
	}

	// While lease is fresh, ReclaimStale should do nothing
	reclaimedCount, err := store.ReclaimStale(ctx, 30*time.Second)
	if err != nil {
		t.Fatalf("unexpected ReclaimStale error: %v", err)
	}
	if reclaimedCount != 0 {
		t.Fatalf("expected 0 reclaimed events before lease expiry, got %d", reclaimedCount)
	}

	// Simulate passage of time by artificially aging the lock
	store.mu.Lock()
	staleTime := time.Now().Add(-35 * time.Second)
	store.events[ev.ID].LockedAt = &staleTime
	store.mu.Unlock()

	// Reclaim stale locks with 30s lease timeout
	reclaimedCount, err = store.ReclaimStale(ctx, 30*time.Second)
	if err != nil {
		t.Fatalf("reclaim stale failed: %v", err)
	}
	if reclaimedCount != 1 {
		t.Fatalf("expected 1 event reclaimed, got %d", reclaimedCount)
	}

	// Verify the event is back in pending and can be claimed by a healthy worker
	healthyClaimed, err := store.ClaimBatch(ctx, "healthy-worker", 1)
	if err != nil || len(healthyClaimed) != 1 {
		t.Fatalf("expected healthy worker to claim reclaimed event, got %d", len(healthyClaimed))
	}
	if healthyClaimed[0].ID != ev.ID || healthyClaimed[0].LockedBy != "healthy-worker" {
		t.Fatalf("claimed event metadata unexpected: %+v", healthyClaimed[0])
	}
}

// Invariant I4: Max Attempts and Dead-Letter Queue (DLQ)
// Proves that when retry attempts reach max_attempts, the event status transitions
// to 'dead' and is never picked up by ClaimBatch again.
func TestMaxAttemptsMovesEventToDeadLetter(t *testing.T) {
	ctx := context.Background()
	store := NewMemStore()

	ev := &Event{
		ID:          "evt_flaky_service",
		Topic:       "invoice.generated",
		Endpoint:    "http://example.com/webhook",
		Payload:     json.RawMessage(`{"invoice_id": "inv_12"}`),
		MaxAttempts: 3,
	}
	if err := store.Enqueue(ctx, ev); err != nil {
		t.Fatalf("failed to enqueue: %v", err)
	}

	// Attempt 1: claim and fail
	claimed1, _ := store.ClaimBatch(ctx, "worker-1", 1)
	if len(claimed1) != 1 {
		t.Fatalf("attempt 1: expected 1 claimed event")
	}
	status1, err := store.MarkFailed(ctx, ev.ID, time.Now().Add(-1*time.Second), "503 Service Unavailable")
	if err != nil || status1 != StatusPending {
		t.Fatalf("attempt 1: expected StatusPending, got %s (err: %v)", status1, err)
	}

	// Attempt 2: claim and fail
	claimed2, _ := store.ClaimBatch(ctx, "worker-1", 1)
	if len(claimed2) != 1 {
		t.Fatalf("attempt 2: expected 1 claimed event")
	}
	status2, err := store.MarkFailed(ctx, ev.ID, time.Now().Add(-1*time.Second), "503 Service Unavailable")
	if err != nil || status2 != StatusPending {
		t.Fatalf("attempt 2: expected StatusPending, got %s (err: %v)", status2, err)
	}

	// Attempt 3: claim and fail (attempts == max_attempts == 3)
	claimed3, _ := store.ClaimBatch(ctx, "worker-1", 1)
	if len(claimed3) != 1 {
		t.Fatalf("attempt 3: expected 1 claimed event")
	}
	status3, err := store.MarkFailed(ctx, ev.ID, time.Now().Add(-1*time.Second), "503 Service Unavailable")
	if err != nil || status3 != StatusDead {
		t.Fatalf("attempt 3: expected StatusDead, got %s (err: %v)", status3, err)
	}

	// Subsequent ClaimBatch must NOT return the dead event
	claimedPostDead, err := store.ClaimBatch(ctx, "worker-1", 10)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(claimedPostDead) != 0 {
		t.Fatalf("expected 0 events claimed from DLQ, got %d", len(claimedPostDead))
	}

	// Check Stats
	stats, err := store.Stats(ctx)
	if err != nil {
		t.Fatalf("failed to fetch stats: %v", err)
	}
	if stats.DeadCount != 1 || stats.PendingCount != 0 {
		t.Fatalf("expected DeadCount=1, got %+v", stats)
	}
}

// Invariant I5: HMAC-SHA256 Integrity and Replay Defense
// Proves that signatures match the canonical digest and outside the tolerance window
// requests are rejected as expired.
func TestSignatureVerificationAndReplayWindow(t *testing.T) {
	secret := []byte("super-secret-key-42")
	signer := NewSigner(secret).WithTolerance(5 * time.Minute)

	payload := []byte(`{"event": "refund.created", "amount": 1000}`)
	now := time.Now().UTC()

	// 1. Valid signature verifies successfully
	sig := signer.Sign(now, payload)
	if err := signer.Verify(sig, now, payload); err != nil {
		t.Fatalf("expected signature verification to succeed: %v", err)
	}

	// 2. Tampered payload is rejected
	tamperedPayload := []byte(`{"event": "refund.created", "amount": 999999}`)
	if err := signer.Verify(sig, now, tamperedPayload); err == nil {
		t.Fatalf("expected verification failure on tampered payload, but succeeded")
	}

	// 3. Replay attack past tolerance window is rejected
	staleTimestamp := now.Add(-10 * time.Minute)
	staleSig := signer.Sign(staleTimestamp, payload)
	if err := signer.Verify(staleSig, staleTimestamp, payload); err != ErrSignatureExpired {
		t.Fatalf("expected ErrSignatureExpired, got: %v", err)
	}

	// 4. Future timestamp past tolerance window is rejected
	futureTimestamp := now.Add(10 * time.Minute)
	futureSig := signer.Sign(futureTimestamp, payload)
	if err := signer.Verify(futureSig, futureTimestamp, payload); err != ErrSignatureExpired {
		t.Fatalf("expected ErrSignatureExpired for future timestamp, got: %v", err)
	}
}

// RoundTripFunc allows using a function as an http.RoundTripper for in-memory HTTP testing.
type RoundTripFunc func(req *http.Request) (*http.Response, error)

func (f RoundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

// End-to-end integration test: Webhook HTTP delivery and Prometheus metrics
func TestEngineEndToEndWebhookDeliveryAndMetrics(t *testing.T) {
	var deliveredCount atomic.Int64
	var lastReceivedBody []byte
	var lastReceivedSignature string
	var mu sync.Mutex

	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		mu.Lock()
		lastReceivedBody = body
		lastReceivedSignature = r.Header.Get(HeaderSignature)
		mu.Unlock()
		deliveredCount.Add(1)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"received": true}`))
	})

	httpClient := &http.Client{
		Transport: RoundTripFunc(func(req *http.Request) (*http.Response, error) {
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)
			return rec.Result(), nil
		}),
	}

	store := NewMemStore()
	secret := []byte("test-secret-123")
	signer := NewSigner(secret)
	dispatcher := NewHTTPDispatcher(httpClient, signer)

	engine, err := NewEngine(EngineConfig{
		Store:        store,
		Dispatcher:   dispatcher,
		WorkerCount:  2,
		BatchSize:    4,
		PollInterval: 50 * time.Millisecond,
		LeaseTimeout: 5 * time.Second,
		ReapInterval: 1 * time.Second,
		WorkerID:     "test-engine",
	})
	if err != nil {
		t.Fatalf("failed to create engine: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	if err := engine.Start(ctx); err != nil {
		t.Fatalf("failed to start engine: %v", err)
	}
	defer func() { _ = engine.Stop() }()

	// Enqueue test event
	payload := []byte(`{"order_id": "ord_e2e_001", "status": "shipped"}`)
	ev := &Event{
		ID:       "evt_e2e_01",
		Topic:    "order.shipped",
		Endpoint: "http://webhook.internal/events",
		Payload:  json.RawMessage(payload),
	}
	if err := engine.Enqueue(ctx, ev); err != nil {
		t.Fatalf("failed to enqueue: %v", err)
	}

	// Wait for delivery
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if deliveredCount.Load() >= 1 {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}

	if deliveredCount.Load() != 1 {
		t.Fatalf("expected 1 webhook delivery, got %d", deliveredCount.Load())
	}

	// Verify signature on receiver side
	mu.Lock()
	sig := lastReceivedSignature
	body := lastReceivedBody
	mu.Unlock()

	if sig == "" {
		t.Fatalf("expected %s header, but got empty", HeaderSignature)
	}
	if err := signer.Verify(sig, time.Now(), body); err != nil {
		t.Fatalf("receiver signature validation failed: %v", err)
	}

	// Test Prometheus metrics endpoint
	req := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	rr := httptest.NewRecorder()
	engine.PrometheusHandler().ServeHTTP(rr, req)

	metricsBody := rr.Body.String()
	if rr.Code != http.StatusOK {
		t.Fatalf("metrics endpoint returned code %d", rr.Code)
	}
	expectedMetric := "pgrelay_delivered_total 1"
	if !containsString(metricsBody, expectedMetric) {
		t.Fatalf("expected metrics to contain '%s', got:\n%s", expectedMetric, metricsBody)
	}
}

func containsString(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || searchString(s, substr))
}

func searchString(s, substr string) bool {
	for i := 0; i+len(substr) <= len(s); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
