package idem

import (
	"context"
	"sync"
	"time"
)

type memEntry struct {
	record *Record
	done   chan struct{}
	closed bool
}

// MemoryStore provides a thread-safe in-memory implementation of Store.
// In-flight requests create a notification channel that broadcasts completion
// to all concurrent waiting callers via close(done).
type MemoryStore struct {
	mu      sync.Mutex
	entries map[string]*memEntry
	stopCh  chan struct{}
	closeOnce sync.Once
}

// NewMemoryStore initializes a MemoryStore and optionally spawns a background reaper.
// If reaperInterval <= 0, background sweeping is disabled and can be triggered manually.
func NewMemoryStore(reaperInterval time.Duration) *MemoryStore {
	ms := &MemoryStore{
		entries: make(map[string]*memEntry),
		stopCh:  make(chan struct{}),
	}

	if reaperInterval > 0 {
		go ms.reaperLoop(reaperInterval)
	}

	return ms
}

func (m *MemoryStore) reaperLoop(interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-m.stopCh:
			return
		case now := <-ticker.C:
			m.SweepExpired(now)
		}
	}
}

// TryAcquire atomically attempts to register an IN_FLIGHT record.
func (m *MemoryStore) TryAcquire(ctx context.Context, key string, fingerprint string, ttl time.Duration) (AcquireResult, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	now := time.Now()
	entry, exists := m.entries[key]

	// If entry exists but has passed TTL, purge it and treat as brand new
	if exists && entry.record.IsExpired(now) {
		if !entry.closed {
			close(entry.done)
			entry.closed = true
		}
		delete(m.entries, key)
		exists = false
		entry = nil
	}

	if !exists {
		rec := &Record{
			Key:         key,
			Fingerprint: fingerprint,
			Status:      StatusInFlight,
			CreatedAt:   now,
			ExpiresAt:   now.Add(ttl),
		}
		newEntry := &memEntry{
			record: rec,
			done:   make(chan struct{}),
		}
		m.entries[key] = newEntry
		return AcquireResult{
			Acquired: true,
			Record:   rec.Clone(),
		}, nil
	}

	// Payload tampering detection
	if entry.record.Fingerprint != fingerprint {
		return AcquireResult{
			Acquired: false,
			Record:   entry.record.Clone(),
		}, ErrFingerprintMismatch
	}

	// Key is currently in-flight: return wait channel for broadcast unblocking
	if entry.record.Status == StatusInFlight {
		return AcquireResult{
			Acquired: false,
			Record:   entry.record.Clone(),
			WaitCh:   entry.done,
		}, nil
	}

	// Already completed
	return AcquireResult{
		Acquired: false,
		Record:   entry.record.Clone(),
	}, nil
}

// Complete updates an IN_FLIGHT entry to COMPLETED and unblocks all waiting goroutines.
func (m *MemoryStore) Complete(ctx context.Context, key string, statusCode int, headers map[string]string, body []byte, ttl time.Duration) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	entry, exists := m.entries[key]
	if !exists {
		return ErrNotFound
	}

	entry.record.Status = StatusCompleted
	entry.record.StatusCode = statusCode
	entry.record.Headers = headers
	entry.record.Body = body
	entry.record.ExpiresAt = time.Now().Add(ttl)

	if !entry.closed {
		close(entry.done)
		entry.closed = true
	}

	return nil
}

// Delete removes a record and unblocks any in-flight waiters so they do not deadlock.
func (m *MemoryStore) Delete(ctx context.Context, key string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	entry, exists := m.entries[key]
	if !exists {
		return nil
	}

	if !entry.closed {
		close(entry.done)
		entry.closed = true
	}

	delete(m.entries, key)
	return nil
}

// Get fetches the current record if present and unexpired.
func (m *MemoryStore) Get(ctx context.Context, key string) (*Record, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	entry, exists := m.entries[key]
	if !exists || entry.record.IsExpired(time.Now()) {
		return nil, ErrNotFound
	}

	return entry.record.Clone(), nil
}

// SweepExpired removes all entries whose expiration timestamp is at or before now.
func (m *MemoryStore) SweepExpired(now time.Time) int {
	m.mu.Lock()
	defer m.mu.Unlock()

	swept := 0
	for key, entry := range m.entries {
		if entry.record.IsExpired(now) {
			if !entry.closed {
				close(entry.done)
				entry.closed = true
			}
			delete(m.entries, key)
			swept++
		}
	}
	return swept
}

// Close stops the background reaper goroutine.
func (m *MemoryStore) Close() error {
	m.closeOnce.Do(func() {
		close(m.stopCh)
	})
	return nil
}
