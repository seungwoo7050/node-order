package idem

import (
	"errors"
	"time"
)

// Status represents the lifecycle state of an idempotency record.
type Status string

const (
	// StatusInFlight indicates the request is currently being processed by the leader.
	StatusInFlight Status = "IN_FLIGHT"
	// StatusCompleted indicates the request has finished and its response is cached.
	StatusCompleted Status = "COMPLETED"
)

var (
	// ErrNotFound is returned when an idempotency key does not exist.
	ErrNotFound = errors.New("idempotency record not found")
	// ErrConflict is returned when another request with the same key is already in flight.
	ErrConflict = errors.New("idempotency conflict: request currently in flight")
	// ErrFingerprintMismatch is returned when an idempotency key is reused with a different payload.
	ErrFingerprintMismatch = errors.New("idempotency fingerprint mismatch: request payload differs from original")
	// ErrExpired is returned when a record has passed its TTL.
	ErrExpired = errors.New("idempotency record expired")
	// ErrPayloadTooLarge is returned when a response exceeds the maximum capture limit.
	ErrPayloadTooLarge = errors.New("response payload exceeds max capture limit")
)

// WaitPolicy determines how follower requests behave when encountering an in-flight leader.
type WaitPolicy string

const (
	// PolicyReject409 immediately rejects concurrent requests with HTTP 409 Conflict.
	PolicyReject409 WaitPolicy = "reject"
	// PolicyWaitAndReplay pauses concurrent requests until the leader completes, then replays the response.
	PolicyWaitAndReplay WaitPolicy = "wait"
)

// Record holds the state, fingerprint, and cached HTTP response for an idempotency key.
type Record struct {
	Key         string            `json:"key"`
	Fingerprint string            `json:"fingerprint"`
	Status      Status            `json:"status"`
	StatusCode  int               `json:"status_code"`
	Headers     map[string]string `json:"headers"`
	Body        []byte            `json:"body"`
	CreatedAt   time.Time         `json:"created_at"`
	ExpiresAt   time.Time         `json:"expires_at"`
}

// IsExpired reports whether the record has passed the given timestamp.
func (r *Record) IsExpired(now time.Time) bool {
	if r == nil || r.ExpiresAt.IsZero() {
		return false
	}
	return !r.ExpiresAt.After(now)
}

// Clone returns a deep copy of the Record.
func (r *Record) Clone() *Record {
	if r == nil {
		return nil
	}
	cp := *r
	if r.Headers != nil {
		cp.Headers = make(map[string]string, len(r.Headers))
		for k, v := range r.Headers {
			cp.Headers[k] = v
		}
	}
	if len(r.Body) > 0 {
		cp.Body = make([]byte, len(r.Body))
		copy(cp.Body, r.Body)
	}
	return &cp
}

// AcquireResult contains the outcome of an idempotency key acquisition attempt.
type AcquireResult struct {
	Acquired bool
	Record   *Record
	WaitCh   <-chan struct{}
}
