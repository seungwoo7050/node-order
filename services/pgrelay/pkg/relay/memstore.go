package relay

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"sort"
	"sync"
	"time"
)

// MemStore is a thread-safe, deterministic in-memory implementation of Store.
// It faithfully simulates PostgreSQL's SKIP LOCKED row locking, lease timeouts,
// and transactional rollback behavior for unit testing and demo mode.
type MemStore struct {
	mu     sync.Mutex
	events map[string]*Event
	closed bool
}

// NewMemStore creates a new in-memory Store.
func NewMemStore() *MemStore {
	return &MemStore{
		events: make(map[string]*Event),
	}
}

// MemTx simulates a database transaction for MemStore.
type MemTx struct {
	store     *MemStore
	mu        sync.Mutex
	staged    []*Event
	committed bool
	rolledBack bool
}

// BeginTx starts a simulated transaction on the memory store.
func (s *MemStore) BeginTx() *MemTx {
	return &MemTx{
		store: s,
	}
}

// Commit applies all staged events to the memory store.
func (tx *MemTx) Commit() error {
	tx.mu.Lock()
	defer tx.mu.Unlock()

	if tx.committed || tx.rolledBack {
		return errors.New("memtx: transaction already completed")
	}
	tx.committed = true

	tx.store.mu.Lock()
	defer tx.store.mu.Unlock()

	for _, e := range tx.staged {
		tx.store.events[e.ID] = cloneEvent(e)
	}
	tx.staged = nil
	return nil
}

// Rollback discards all staged events.
func (tx *MemTx) Rollback() error {
	tx.mu.Lock()
	defer tx.mu.Unlock()

	if tx.committed || tx.rolledBack {
		return errors.New("memtx: transaction already completed")
	}
	tx.rolledBack = true
	tx.staged = nil
	return nil
}

// ExecContext satisfies DBTx.
func (tx *MemTx) ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error) {
	return nil, nil
}

// QueryRowContext satisfies DBTx.
func (tx *MemTx) QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row {
	return nil
}

// QueryContext satisfies DBTx.
func (tx *MemTx) QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error) {
	return nil, nil
}

// Enqueue inserts a new event into the store.
func (s *MemStore) Enqueue(ctx context.Context, event *Event) error {
	return s.EnqueueTx(ctx, nil, event)
}

// EnqueueTx inserts a new outbox event. If tx is a *MemTx, the event is staged
// until tx.Commit() is called.
func (s *MemStore) EnqueueTx(ctx context.Context, tx DBTx, event *Event) error {
	if err := event.Validate(); err != nil {
		return err
	}

	cloned := cloneEvent(event)

	if tx != nil {
		if mtx, ok := tx.(*MemTx); ok {
			mtx.mu.Lock()
			defer mtx.mu.Unlock()
			if mtx.committed || mtx.rolledBack {
				return errors.New("memstore: transaction already completed")
			}
			mtx.staged = append(mtx.staged, cloned)
			return nil
		}
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return errors.New("memstore: store is closed")
	}

	s.events[cloned.ID] = cloned
	return nil
}

// ClaimBatch simulates FOR UPDATE SKIP LOCKED by atomically selecting and locking
// pending events whose next_attempt_at is due.
func (s *MemStore) ClaimBatch(ctx context.Context, workerID string, batchSize int) ([]*Event, error) {
	if batchSize <= 0 {
		batchSize = 10
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if s.closed {
		return nil, errors.New("memstore: store is closed")
	}

	now := time.Now()
	var candidates []*Event

	for _, e := range s.events {
		if e.Status == StatusPending && !e.NextAttemptAt.After(now) {
			candidates = append(candidates, e)
		}
	}

	// Sort deterministically: NextAttemptAt ascending, then ID ascending
	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].NextAttemptAt.Equal(candidates[j].NextAttemptAt) {
			return candidates[i].ID < candidates[j].ID
		}
		return candidates[i].NextAttemptAt.Before(candidates[j].NextAttemptAt)
	})

	if len(candidates) > batchSize {
		candidates = candidates[:batchSize]
	}

	claimed := make([]*Event, 0, len(candidates))
	for _, e := range candidates {
		e.Status = StatusProcessing
		lockTime := now
		e.LockedAt = &lockTime
		e.LockedBy = workerID
		e.Attempts++
		claimed = append(claimed, cloneEvent(e))
	}

	return claimed, nil
}

// MarkDelivered marks an event as delivered.
func (s *MemStore) MarkDelivered(ctx context.Context, eventID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	e, ok := s.events[eventID]
	if !ok {
		return ErrEventNotFound
	}

	now := time.Now()
	e.Status = StatusDelivered
	e.DeliveredAt = &now
	e.LockedAt = nil
	e.LockedBy = ""
	return nil
}

// MarkFailed updates the event after a delivery error.
// If attempts >= max_attempts, status becomes StatusDead (DLQ).
func (s *MemStore) MarkFailed(ctx context.Context, eventID string, nextAttempt time.Time, errText string) (Status, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	e, ok := s.events[eventID]
	if !ok {
		return "", ErrEventNotFound
	}

	e.LastError = errText
	e.LockedAt = nil
	e.LockedBy = ""

	if e.Attempts >= e.MaxAttempts {
		e.Status = StatusDead
	} else {
		e.Status = StatusPending
		e.NextAttemptAt = nextAttempt
	}

	return e.Status, nil
}

// ReclaimStale resets processing events whose lease expired back to pending status.
func (s *MemStore) ReclaimStale(ctx context.Context, leaseTimeout time.Duration) (int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now()
	var count int64

	for _, e := range s.events {
		if e.Status == StatusProcessing && e.LockedAt != nil {
			if now.Sub(*e.LockedAt) >= leaseTimeout {
				e.Status = StatusPending
				e.LockedAt = nil
				e.LockedBy = ""
				count++
			}
		}
	}

	return count, nil
}

// Stats returns aggregated status counts.
func (s *MemStore) Stats(ctx context.Context) (StoreStats, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	var stats StoreStats
	for _, e := range s.events {
		switch e.Status {
		case StatusPending:
			stats.PendingCount++
		case StatusProcessing:
			stats.ProcessingCount++
		case StatusDelivered:
			stats.DeliveredCount++
		case StatusDead:
			stats.DeadCount++
		}
	}
	return stats, nil
}

// Close closes the memory store.
func (s *MemStore) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.closed = true
	return nil
}

// cloneEvent produces a deep copy of an Event.
func cloneEvent(e *Event) *Event {
	if e == nil {
		return nil
	}
	c := *e
	if len(e.Payload) > 0 {
		c.Payload = make(json.RawMessage, len(e.Payload))
		copy(c.Payload, e.Payload)
	}
	if e.Headers != nil {
		c.Headers = make(map[string]string, len(e.Headers))
		for k, v := range e.Headers {
			c.Headers[k] = v
		}
	}
	if e.LockedAt != nil {
		t := *e.LockedAt
		c.LockedAt = &t
	}
	if e.DeliveredAt != nil {
		t := *e.DeliveredAt
		c.DeliveredAt = &t
	}
	return &c
}
