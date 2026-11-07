package relay

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

var (
	ErrEventNotFound = errors.New("event not found")
	ErrEventLocked   = errors.New("event is locked by another worker")
	ErrTxRequired    = errors.New("transaction is required")
)

// DBTx abstracts *sql.Tx or *sql.DB to allow EnqueueTx to work interchangeably
// with active transactions or standard SQL database handles.
type DBTx interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
}

// StoreStats holds summary counts of events in the outbox.
type StoreStats struct {
	PendingCount    int64 `json:"pending_count"`
	ProcessingCount int64 `json:"processing_count"`
	DeliveredCount  int64 `json:"delivered_count"`
	DeadCount       int64 `json:"dead_count"`
}

// Store defines the persistence contract for transactional outbox events.
type Store interface {
	// Enqueue inserts a new event into the outbox outside a caller transaction.
	Enqueue(ctx context.Context, event *Event) error

	// EnqueueTx inserts a new event into the outbox within the caller's active database transaction.
	EnqueueTx(ctx context.Context, tx DBTx, event *Event) error

	// ClaimBatch claims up to batchSize pending events ready for processing using SKIP LOCKED semantics.
	ClaimBatch(ctx context.Context, workerID string, batchSize int) ([]*Event, error)

	// MarkDelivered marks an event as successfully delivered.
	MarkDelivered(ctx context.Context, eventID string) error

	// MarkFailed records a delivery failure, increments attempts, and either reschedules or moves to DLQ (dead).
	MarkFailed(ctx context.Context, eventID string, nextAttempt time.Time, errText string) (Status, error)

	// ReclaimStale resets processing events whose lock has expired back to pending status.
	ReclaimStale(ctx context.Context, leaseTimeout time.Duration) (int64, error)

	// Stats returns aggregated event status counts.
	Stats(ctx context.Context) (StoreStats, error)

	// Close releases any resources held by the store.
	Close() error
}
