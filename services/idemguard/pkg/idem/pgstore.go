package idem

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"sync"
	"time"
)

// PostgresSchema defines the DDL for the distributed idempotency storage table.
const PostgresSchema = `
CREATE TABLE IF NOT EXISTS idempotency_keys (
    idempotency_key VARCHAR(255) PRIMARY KEY,
    fingerprint VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL,
    status_code INT NOT NULL DEFAULT 0,
    headers JSONB NOT NULL DEFAULT '{}'::jsonb,
    body BYTEA,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_idempotency_keys_expires_at ON idempotency_keys (expires_at);
`

// PGStore implements Store backed by PostgreSQL via database/sql.
// It leverages PostgreSQL's ON CONFLICT DO NOTHING for atomic distributed locking.
type PGStore struct {
	db           *sql.DB
	pollInterval time.Duration
	stopCh       chan struct{}
	closeOnce    sync.Once
}

// PGOption configures PGStore behaviors.
type PGOption func(*PGStore)

// WithPollInterval sets the polling interval used when waiting for in-flight completions.
func WithPollInterval(interval time.Duration) PGOption {
	return func(s *PGStore) {
		if interval > 0 {
			s.pollInterval = interval
		}
	}
}

// NewPGStore creates a new PostgreSQL-backed Store.
func NewPGStore(db *sql.DB, opts ...PGOption) *PGStore {
	store := &PGStore{
		db:           db,
		pollInterval: 50 * time.Millisecond,
		stopCh:       make(chan struct{}),
	}
	for _, opt := range opts {
		opt(store)
	}
	return store
}

// InitSchema applies the idempotency_keys table and index migration.
func (s *PGStore) InitSchema(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, PostgresSchema)
	return err
}

// TryAcquire atomically attempts to register an IN_FLIGHT record.
// If the key already exists, it inspects whether it is expired (reclaiming it),
// matches the fingerprint, or is currently in flight.
func (s *PGStore) TryAcquire(ctx context.Context, key string, fingerprint string, ttl time.Duration) (AcquireResult, error) {
	now := time.Now().UTC()
	expiresAt := now.Add(ttl)

	const insertQuery = `
INSERT INTO idempotency_keys (idempotency_key, fingerprint, status, created_at, expires_at)
VALUES ($1, $2, 'IN_FLIGHT', $3, $4)
ON CONFLICT (idempotency_key) DO NOTHING;
`

	res, err := s.db.ExecContext(ctx, insertQuery, key, fingerprint, now, expiresAt)
	if err != nil {
		return AcquireResult{}, err
	}

	rows, err := res.RowsAffected()
	if err != nil {
		return AcquireResult{}, err
	}

	if rows == 1 {
		// Successfully acquired distributed lock
		return AcquireResult{
			Acquired: true,
			Record: &Record{
				Key:         key,
				Fingerprint: fingerprint,
				Status:      StatusInFlight,
				CreatedAt:   now,
				ExpiresAt:   expiresAt,
			},
		}, nil
	}

	// Key already exists; query existing row
	rec, err := s.queryRecord(ctx, key)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			// Row disappeared between insert and query (e.g. swept or deleted on 5xx)
			// Recursive retry once
			return s.TryAcquire(ctx, key, fingerprint, ttl)
		}
		return AcquireResult{}, err
	}

	// Check if existing record has expired or is stale in-flight
	if rec.IsExpired(now) {
		const reclaimQuery = `
UPDATE idempotency_keys
SET fingerprint = $2, status = 'IN_FLIGHT', status_code = 0, headers = '{}'::jsonb, body = NULL, created_at = $3, expires_at = $4
WHERE idempotency_key = $1 AND expires_at <= $3;
`
		reclaimRes, err := s.db.ExecContext(ctx, reclaimQuery, key, fingerprint, now, expiresAt)
		if err == nil {
			if reclaimed, _ := reclaimRes.RowsAffected(); reclaimed == 1 {
				return AcquireResult{
					Acquired: true,
					Record: &Record{
						Key:         key,
						Fingerprint: fingerprint,
						Status:      StatusInFlight,
						CreatedAt:   now,
						ExpiresAt:   expiresAt,
					},
				}, nil
			}
		}
	}

	// Payload tampering detection
	if rec.Fingerprint != fingerprint {
		return AcquireResult{
			Acquired: false,
			Record:   rec,
		}, ErrFingerprintMismatch
	}

	// In-flight follower: spawn lightweight polling channel
	if rec.Status == StatusInFlight {
		waitCh := s.watchCompletion(ctx, key)
		return AcquireResult{
			Acquired: false,
			Record:   rec,
			WaitCh:   waitCh,
		}, nil
	}

	// Completed
	return AcquireResult{
		Acquired: false,
		Record:   rec,
	}, nil
}

// Complete updates the row with the captured response and marks status as COMPLETED.
func (s *PGStore) Complete(ctx context.Context, key string, statusCode int, headers map[string]string, body []byte, ttl time.Duration) error {
	now := time.Now().UTC()
	expiresAt := now.Add(ttl)

	headersJSON, err := json.Marshal(headers)
	if err != nil {
		headersJSON = []byte("{}")
	}

	const updateQuery = `
UPDATE idempotency_keys
SET status = 'COMPLETED', status_code = $2, headers = $3, body = $4, expires_at = $5
WHERE idempotency_key = $1;
`

	_, err = s.db.ExecContext(ctx, updateQuery, key, statusCode, string(headersJSON), body, expiresAt)
	return err
}

// Delete removes the idempotency record.
func (s *PGStore) Delete(ctx context.Context, key string) error {
	const deleteQuery = `DELETE FROM idempotency_keys WHERE idempotency_key = $1;`
	_, err := s.db.ExecContext(ctx, deleteQuery, key)
	return err
}

// Get retrieves the active record for key.
func (s *PGStore) Get(ctx context.Context, key string) (*Record, error) {
	rec, err := s.queryRecord(ctx, key)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	if rec.IsExpired(time.Now().UTC()) {
		return nil, ErrNotFound
	}
	return rec, nil
}

// SweepExpired deletes all rows whose expires_at is older than or equal to now.
func (s *PGStore) SweepExpired(now time.Time) int {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	const sweepQuery = `DELETE FROM idempotency_keys WHERE expires_at <= $1;`
	res, err := s.db.ExecContext(ctx, sweepQuery, now.UTC())
	if err != nil {
		return 0
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return 0
	}
	return int(affected)
}

// Close closes the store channel.
func (s *PGStore) Close() error {
	s.closeOnce.Do(func() {
		close(s.stopCh)
	})
	return nil
}

func (s *PGStore) queryRecord(ctx context.Context, key string) (*Record, error) {
	const selectQuery = `
SELECT idempotency_key, fingerprint, status, status_code, headers, body, created_at, expires_at
FROM idempotency_keys
WHERE idempotency_key = $1;
`
	var (
		rec         Record
		headersData []byte
	)

	err := s.db.QueryRowContext(ctx, selectQuery, key).Scan(
		&rec.Key,
		&rec.Fingerprint,
		&rec.Status,
		&rec.StatusCode,
		&headersData,
		&rec.Body,
		&rec.CreatedAt,
		&rec.ExpiresAt,
	)
	if err != nil {
		return nil, err
	}

	if len(headersData) > 0 {
		_ = json.Unmarshal(headersData, &rec.Headers)
	}
	if rec.Headers == nil {
		rec.Headers = make(map[string]string)
	}

	return &rec, nil
}

func (s *PGStore) watchCompletion(ctx context.Context, key string) <-chan struct{} {
	ch := make(chan struct{})
	go func() {
		ticker := time.NewTicker(s.pollInterval)
		defer ticker.Stop()
		defer close(ch)

		for {
			select {
			case <-s.stopCh:
				return
			case <-ctx.Done():
				return
			case <-ticker.C:
				rec, err := s.queryRecord(ctx, key)
				if err != nil {
					// Row deleted (e.g. 5xx failure) or query failed
					return
				}
				if rec.Status == StatusCompleted || rec.IsExpired(time.Now().UTC()) {
					return
				}
			}
		}
	}()
	return ch
}
