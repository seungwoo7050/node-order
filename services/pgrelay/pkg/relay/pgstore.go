package relay

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

// PGStore implements the Store interface using PostgreSQL database/sql.
type PGStore struct {
	db *sql.DB
}

// NewPGStore creates a new PostgreSQL outbox store.
func NewPGStore(db *sql.DB) *PGStore {
	return &PGStore{db: db}
}

// DB returns the underlying database handle.
func (s *PGStore) DB() *sql.DB {
	return s.db
}

// Enqueue inserts a new event using the default database connection.
func (s *PGStore) Enqueue(ctx context.Context, event *Event) error {
	if s.db == nil {
		return errors.New("pgstore: database connection is nil")
	}
	return s.EnqueueTx(ctx, s.db, event)
}

// EnqueueTx inserts a new outbox event within an existing database transaction or connection.
func (s *PGStore) EnqueueTx(ctx context.Context, tx DBTx, event *Event) error {
	if tx == nil {
		return ErrTxRequired
	}
	if err := event.Validate(); err != nil {
		return fmt.Errorf("pgstore: validate event: %w", err)
	}

	headersJSON, err := json.Marshal(event.Headers)
	if err != nil {
		return fmt.Errorf("pgstore: marshal headers: %w", err)
	}

	query := `
		INSERT INTO outbox_events (
			id, topic, endpoint, payload, headers, status,
			attempts, max_attempts, next_attempt_at, created_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
	`
	_, err = tx.ExecContext(
		ctx,
		query,
		event.ID,
		event.Topic,
		event.Endpoint,
		[]byte(event.Payload),
		headersJSON,
		string(event.Status),
		event.Attempts,
		event.MaxAttempts,
		event.NextAttemptAt,
		event.CreatedAt,
	)
	if err != nil {
		return fmt.Errorf("pgstore: insert event: %w", err)
	}
	return nil
}

// ClaimBatch selects and locks up to batchSize pending events using FOR UPDATE SKIP LOCKED.
func (s *PGStore) ClaimBatch(ctx context.Context, workerID string, batchSize int) ([]*Event, error) {
	if s.db == nil {
		return nil, errors.New("pgstore: database connection is nil")
	}
	if batchSize <= 0 {
		batchSize = 10
	}
	now := time.Now()

	query := `
		WITH candidates AS (
			SELECT id
			FROM outbox_events
			WHERE status = 'pending' AND next_attempt_at <= $1
			ORDER BY next_attempt_at ASC, id ASC
			LIMIT $2
			FOR UPDATE SKIP LOCKED
		)
		UPDATE outbox_events e
		SET status = 'processing',
			locked_at = $3,
			locked_by = $4,
			attempts = e.attempts + 1
		FROM candidates c
		WHERE e.id = c.id
		RETURNING e.id, e.topic, e.endpoint, e.payload, e.headers, e.status,
		          e.attempts, e.max_attempts, e.next_attempt_at, e.locked_at,
		          e.locked_by, e.last_error, e.created_at, e.delivered_at
	`

	rows, err := s.db.QueryContext(ctx, query, now, batchSize, now, workerID)
	if err != nil {
		return nil, fmt.Errorf("pgstore: claim batch query: %w", err)
	}
	defer rows.Close()

	var events []*Event
	for rows.Next() {
		var (
			e           Event
			payloadRaw  []byte
			headersRaw  []byte
			statusStr   string
			lockedAt    sql.NullTime
			deliveredAt sql.NullTime
			lastError   sql.NullString
		)

		err := rows.Scan(
			&e.ID,
			&e.Topic,
			&e.Endpoint,
			&payloadRaw,
			&headersRaw,
			&statusStr,
			&e.Attempts,
			&e.MaxAttempts,
			&e.NextAttemptAt,
			&lockedAt,
			&e.LockedBy,
			&lastError,
			&e.CreatedAt,
			&deliveredAt,
		)
		if err != nil {
			return nil, fmt.Errorf("pgstore: scan claimed row: %w", err)
		}

		e.Payload = json.RawMessage(payloadRaw)
		e.Status = Status(statusStr)
		if len(headersRaw) > 0 {
			_ = json.Unmarshal(headersRaw, &e.Headers)
		}
		if lockedAt.Valid {
			e.LockedAt = &lockedAt.Time
		}
		if deliveredAt.Valid {
			e.DeliveredAt = &deliveredAt.Time
		}
		if lastError.Valid {
			e.LastError = lastError.String
		}

		events = append(events, &e)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("pgstore: rows iteration: %w", err)
	}
	return events, nil
}

// MarkDelivered marks an event as successfully delivered.
func (s *PGStore) MarkDelivered(ctx context.Context, eventID string) error {
	if s.db == nil {
		return errors.New("pgstore: database connection is nil")
	}
	now := time.Now()
	query := `
		UPDATE outbox_events
		SET status = 'delivered',
			delivered_at = $1,
			locked_at = NULL,
			locked_by = NULL
		WHERE id = $2
	`
	res, err := s.db.ExecContext(ctx, query, now, eventID)
	if err != nil {
		return fmt.Errorf("pgstore: mark delivered: %w", err)
	}
	rows, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return ErrEventNotFound
	}
	return nil
}

// MarkFailed updates the event after a delivery error.
// If attempts >= max_attempts, the status transitions to 'dead' (DLQ).
func (s *PGStore) MarkFailed(ctx context.Context, eventID string, nextAttempt time.Time, errText string) (Status, error) {
	if s.db == nil {
		return "", errors.New("pgstore: database connection is nil")
	}
	query := `
		UPDATE outbox_events
		SET status = CASE WHEN attempts >= max_attempts THEN 'dead' ELSE 'pending' END,
			next_attempt_at = $1,
			last_error = $2,
			locked_at = NULL,
			locked_by = NULL
		WHERE id = $3
		RETURNING status
	`
	var newStatus string
	err := s.db.QueryRowContext(ctx, query, nextAttempt, errText, eventID).Scan(&newStatus)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", ErrEventNotFound
		}
		return "", fmt.Errorf("pgstore: mark failed: %w", err)
	}
	return Status(newStatus), nil
}

// ReclaimStale resets processing events whose lease has expired back to pending status.
func (s *PGStore) ReclaimStale(ctx context.Context, leaseTimeout time.Duration) (int64, error) {
	if s.db == nil {
		return 0, errors.New("pgstore: database connection is nil")
	}
	staleThreshold := time.Now().Add(-leaseTimeout)
	query := `
		UPDATE outbox_events
		SET status = 'pending',
			locked_at = NULL,
			locked_by = NULL
		WHERE status = 'processing' AND locked_at < $1
	`
	res, err := s.db.ExecContext(ctx, query, staleThreshold)
	if err != nil {
		return 0, fmt.Errorf("pgstore: reclaim stale: %w", err)
	}
	return res.RowsAffected()
}

// Stats returns aggregated status counts.
func (s *PGStore) Stats(ctx context.Context) (StoreStats, error) {
	var stats StoreStats
	if s.db == nil {
		return stats, errors.New("pgstore: database connection is nil")
	}
	query := `
		SELECT status, COUNT(*)
		FROM outbox_events
		GROUP BY status
	`
	rows, err := s.db.QueryContext(ctx, query)
	if err != nil {
		return stats, fmt.Errorf("pgstore: stats: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var (
			st    string
			count int64
		)
		if err := rows.Scan(&st, &count); err != nil {
			return stats, err
		}
		switch Status(st) {
		case StatusPending:
			stats.PendingCount = count
		case StatusProcessing:
			stats.ProcessingCount = count
		case StatusDelivered:
			stats.DeliveredCount = count
		case StatusDead:
			stats.DeadCount = count
		}
	}
	return stats, rows.Err()
}

// Close closes the underlying database pool.
func (s *PGStore) Close() error {
	if s.db != nil {
		return s.db.Close()
	}
	return nil
}
