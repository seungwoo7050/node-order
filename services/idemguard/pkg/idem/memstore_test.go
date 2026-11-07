package idem

import (
	"context"
	"sync"
	"testing"
	"time"
)

func TestMemoryStore_AcquireCompleteAndReplay(t *testing.T) {
	ms := NewMemoryStore(0)
	defer ms.Close()

	ctx := context.Background()
	key := "order-100"
	fp := "hash123"
	ttl := 1 * time.Hour

	// 1. First acquire succeeds
	res1, err := ms.TryAcquire(ctx, key, fp, ttl)
	if err != nil || !res1.Acquired {
		t.Fatalf("expected successful acquire, got res=%+v err=%v", res1, err)
	}
	if res1.Record.Status != StatusInFlight {
		t.Fatalf("expected IN_FLIGHT status, got %s", res1.Record.Status)
	}

	// 2. Second acquire while in flight returns Acquired=false with WaitCh
	res2, err := ms.TryAcquire(ctx, key, fp, ttl)
	if err != nil || res2.Acquired {
		t.Fatalf("expected failed acquire while in flight, got res=%+v err=%v", res2, err)
	}
	if res2.WaitCh == nil {
		t.Fatalf("expected non-nil WaitCh for in-flight request")
	}

	// 3. Complete the leader
	headers := map[string]string{"Content-Type": "application/json"}
	body := []byte(`{"order_id":"100","status":"created"}`)
	err = ms.Complete(ctx, key, 201, headers, body, ttl)
	if err != nil {
		t.Fatalf("complete failed: %v", err)
	}

	// 4. WaitCh should be closed
	select {
	case <-res2.WaitCh:
		// success
	case <-time.After(100 * time.Millisecond):
		t.Fatalf("WaitCh was not closed after Complete")
	}

	// 5. Third acquire after completion returns cached record
	res3, err := ms.TryAcquire(ctx, key, fp, ttl)
	if err != nil || res3.Acquired {
		t.Fatalf("expected Acquired=false on completed key, got res=%+v err=%v", res3, err)
	}
	if res3.Record.Status != StatusCompleted || res3.Record.StatusCode != 201 {
		t.Fatalf("expected cached status 201 COMPLETED, got %+v", res3.Record)
	}
}

func TestMemoryStore_FingerprintMismatch(t *testing.T) {
	ms := NewMemoryStore(0)
	defer ms.Close()

	ctx := context.Background()
	key := "key-mismatch"

	_, err := ms.TryAcquire(ctx, key, "fpA", time.Hour)
	if err != nil {
		t.Fatalf("first acquire failed: %v", err)
	}

	_, err = ms.TryAcquire(ctx, key, "fpB", time.Hour)
	if err != ErrFingerprintMismatch {
		t.Fatalf("expected ErrFingerprintMismatch, got %v", err)
	}
}

func TestMemoryStore_DeleteUnblocksWaiters(t *testing.T) {
	ms := NewMemoryStore(0)
	defer ms.Close()

	ctx := context.Background()
	key := "key-delete"

	res1, err := ms.TryAcquire(ctx, key, "fp", time.Hour)
	if err != nil || !res1.Acquired {
		t.Fatalf("acquire failed: %v", err)
	}

	res2, err := ms.TryAcquire(ctx, key, "fp", time.Hour)
	if err != nil || res2.WaitCh == nil {
		t.Fatalf("expected wait channel")
	}

	// Delete key (simulating leader failure)
	err = ms.Delete(ctx, key)
	if err != nil {
		t.Fatalf("delete failed: %v", err)
	}

	select {
	case <-res2.WaitCh:
		// channel closed
	case <-time.After(100 * time.Millisecond):
		t.Fatalf("WaitCh not unblocked on Delete")
	}

	// Should be absent from store now
	_, err = ms.Get(ctx, key)
	if err != ErrNotFound {
		t.Fatalf("expected ErrNotFound after Delete, got %v", err)
	}
}

func TestMemoryStore_SweepExpired(t *testing.T) {
	ms := NewMemoryStore(0)
	defer ms.Close()

	ctx := context.Background()
	shortTTL := 50 * time.Millisecond

	_, err := ms.TryAcquire(ctx, "k1", "fp1", shortTTL)
	if err != nil {
		t.Fatalf("k1 acquire failed: %v", err)
	}
	_, err = ms.TryAcquire(ctx, "k2", "fp2", 1*time.Hour)
	if err != nil {
		t.Fatalf("k2 acquire failed: %v", err)
	}

	time.Sleep(60 * time.Millisecond)

	swept := ms.SweepExpired(time.Now())
	if swept != 1 {
		t.Fatalf("expected 1 swept record, got %d", swept)
	}

	// k1 should be gone, k2 should still exist
	if _, err := ms.Get(ctx, "k1"); err != ErrNotFound {
		t.Fatalf("expected k1 not found, got %v", err)
	}
	if _, err := ms.Get(ctx, "k2"); err != nil {
		t.Fatalf("expected k2 found, got %v", err)
	}
}

func TestMemoryStore_ConcurrentHighContention(t *testing.T) {
	ms := NewMemoryStore(0)
	defer ms.Close()

	ctx := context.Background()
	key := "contended-key"
	fp := "same-hash"

	var wg sync.WaitGroup
	numCallers := 50
	acquireCount := 0
	var mu sync.Mutex

	for i := 0; i < numCallers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			res, err := ms.TryAcquire(ctx, key, fp, time.Hour)
			if err != nil {
				return
			}
			if res.Acquired {
				mu.Lock()
				acquireCount++
				mu.Unlock()
			}
		}()
	}

	wg.Wait()

	if acquireCount != 1 {
		t.Fatalf("expected exactly 1 caller to acquire, got %d", acquireCount)
	}
}
