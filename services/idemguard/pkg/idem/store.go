package idem

import (
	"context"
	"time"
)

// Store defines the interface for distributed or local idempotency key persistence.
type Store interface {
	// TryAcquire attempts to lock the given idempotency key.
	// If the key is new or expired, it atomically registers an IN_FLIGHT record and returns Acquired=true.
	// If an IN_FLIGHT record already exists with the same fingerprint, it returns Acquired=false with a
	// WaitCh channel that closes when the leader finishes (either completed or deleted).
	// If a COMPLETED record exists with the same fingerprint, it returns Acquired=false and the cached Record.
	// If the existing record has a different fingerprint, it returns ErrFingerprintMismatch.
	TryAcquire(ctx context.Context, key string, fingerprint string, ttl time.Duration) (AcquireResult, error)

	// Complete transitions an IN_FLIGHT record to COMPLETED, stores the response payload,
	// updates the TTL, and notifies all waiting goroutines via channel broadcast.
	Complete(ctx context.Context, key string, statusCode int, headers map[string]string, body []byte, ttl time.Duration) error

	// Delete removes the idempotency record (e.g. when the leader encounters a 5xx error or panic).
	// Any pending in-flight waiter is unblocked so it does not hang.
	Delete(ctx context.Context, key string) error

	// Get retrieves the current record for key, returning ErrNotFound if absent or expired.
	Get(ctx context.Context, key string) (*Record, error)

	// SweepExpired purges all records that have passed their expiration timestamp.
	// Returns the count of deleted records.
	SweepExpired(now time.Time) int

	// Close releases any background worker resources (e.g. reaper ticker).
	Close() error
}
