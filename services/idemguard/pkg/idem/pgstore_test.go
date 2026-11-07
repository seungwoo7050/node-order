package idem

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"io"
	"strings"
	"sync"
	"testing"
	"time"
)

// Mock PG Driver to test PGStore in standard library without external network / database.

type mockRowData struct {
	key         string
	fingerprint string
	status      string
	statusCode  int
	headers     string
	body        []byte
	createdAt   time.Time
	expiresAt   time.Time
}

type mockPGDB struct {
	mu   sync.Mutex
	rows map[string]*mockRowData
}

var globalMockDB = &mockPGDB{
	rows: make(map[string]*mockRowData),
}

type mockConn struct {
	db *mockPGDB
}

func (c *mockConn) Prepare(query string) (driver.Stmt, error) {
	return &mockStmt{conn: c, query: query}, nil
}

func (c *mockConn) Close() error { return nil }
func (c *mockConn) Begin() (driver.Tx, error) {
	return nil, errors.New("tx not implemented")
}

func (c *mockConn) ExecContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	c.db.mu.Lock()
	defer c.db.mu.Unlock()

	trimmed := strings.TrimSpace(query)

	if strings.HasPrefix(trimmed, "CREATE TABLE") || strings.HasPrefix(trimmed, "CREATE INDEX") {
		return driver.RowsAffected(0), nil
	}

	if strings.Contains(trimmed, "INSERT INTO idempotency_keys") {
		key := args[0].Value.(string)
		fp := args[1].Value.(string)
		createdAt := args[2].Value.(time.Time)
		expiresAt := args[3].Value.(time.Time)

		if _, exists := c.db.rows[key]; exists {
			return driver.RowsAffected(0), nil
		}

		c.db.rows[key] = &mockRowData{
			key:         key,
			fingerprint: fp,
			status:      string(StatusInFlight),
			statusCode:  0,
			headers:     "{}",
			createdAt:   createdAt,
			expiresAt:   expiresAt,
		}
		return driver.RowsAffected(1), nil
	}

	if strings.Contains(trimmed, "UPDATE idempotency_keys") && strings.Contains(trimmed, "SET status = 'COMPLETED'") {
		statusCode := int(args[1].Value.(int64))
		headers := args[2].Value.(string)
		body, _ := args[3].Value.([]byte)
		expiresAt := args[4].Value.(time.Time)
		key := args[0].Value.(string)

		if row, exists := c.db.rows[key]; exists {
			row.status = string(StatusCompleted)
			row.statusCode = statusCode
			row.headers = headers
			row.body = body
			row.expiresAt = expiresAt
			return driver.RowsAffected(1), nil
		}
		return driver.RowsAffected(0), nil
	}

	if strings.Contains(trimmed, "UPDATE idempotency_keys") && strings.Contains(trimmed, "reclaim") || strings.Contains(trimmed, "expires_at <= $3") {
		fp := args[1].Value.(string)
		createdAt := args[2].Value.(time.Time)
		expiresAt := args[3].Value.(time.Time)
		key := args[0].Value.(string)

		if row, exists := c.db.rows[key]; exists && !row.expiresAt.After(createdAt) {
			row.fingerprint = fp
			row.status = string(StatusInFlight)
			row.statusCode = 0
			row.headers = "{}"
			row.body = nil
			row.createdAt = createdAt
			row.expiresAt = expiresAt
			return driver.RowsAffected(1), nil
		}
		return driver.RowsAffected(0), nil
	}

	if strings.Contains(trimmed, "DELETE FROM idempotency_keys WHERE idempotency_key = $1") {
		key := args[0].Value.(string)
		if _, exists := c.db.rows[key]; exists {
			delete(c.db.rows, key)
			return driver.RowsAffected(1), nil
		}
		return driver.RowsAffected(0), nil
	}

	if strings.Contains(trimmed, "DELETE FROM idempotency_keys WHERE expires_at <= $1") {
		t := args[0].Value.(time.Time)
		count := int64(0)
		for k, r := range c.db.rows {
			if !r.expiresAt.After(t) {
				delete(c.db.rows, k)
				count++
			}
		}
		return driver.RowsAffected(count), nil
	}

	return driver.RowsAffected(0), nil
}

func (c *mockConn) QueryContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	c.db.mu.Lock()
	defer c.db.mu.Unlock()

	if strings.Contains(query, "SELECT idempotency_key") {
		key := args[0].Value.(string)
		row, exists := c.db.rows[key]
		if !exists {
			return &mockRows{data: nil}, nil
		}
		return &mockRows{
			data: []*mockRowData{row},
		}, nil
	}

	return &mockRows{}, nil
}

type mockStmt struct {
	conn  *mockConn
	query string
}

func (s *mockStmt) Close() error { return nil }
func (s *mockStmt) NumInput() int { return -1 }
func (s *mockStmt) Exec(args []driver.Value) (driver.Result, error) {
	return nil, errors.New("use ExecContext")
}
func (s *mockStmt) Query(args []driver.Value) (driver.Rows, error) {
	return nil, errors.New("use QueryContext")
}

type mockRows struct {
	data []*mockRowData
	idx  int
}

func (r *mockRows) Columns() []string {
	return []string{"idempotency_key", "fingerprint", "status", "status_code", "headers", "body", "created_at", "expires_at"}
}

func (r *mockRows) Close() error { return nil }

func (r *mockRows) Next(dest []driver.Value) error {
	if r.idx >= len(r.data) {
		return io.EOF
	}
	row := r.data[r.idx]
	r.idx++

	dest[0] = row.key
	dest[1] = row.fingerprint
	dest[2] = row.status
	dest[3] = int64(row.statusCode)
	dest[4] = []byte(row.headers)
	dest[5] = row.body
	dest[6] = row.createdAt
	dest[7] = row.expiresAt
	return nil
}

type mockDriver struct{}

func (d *mockDriver) Open(name string) (driver.Conn, error) {
	return &mockConn{db: globalMockDB}, nil
}

func init() {
	sql.Register("idem_mock_pg", &mockDriver{})
}

func TestPGStore_LifecycleAndInvariants(t *testing.T) {
	db, err := sql.Open("idem_mock_pg", "mock")
	if err != nil {
		t.Fatalf("failed to open mock db: %v", err)
	}
	defer db.Close()

	store := NewPGStore(db, WithPollInterval(10*time.Millisecond))
	defer store.Close()

	ctx := context.Background()

	// 1. Init schema
	if err := store.InitSchema(ctx); err != nil {
		t.Fatalf("InitSchema failed: %v", err)
	}

	key := "tx-12345"
	fp := "sha256-abc"

	// 2. TryAcquire new key -> Acquired=true
	res, err := store.TryAcquire(ctx, key, fp, 1*time.Hour)
	if err != nil || !res.Acquired {
		t.Fatalf("expected acquire success, got res=%+v err=%v", res, err)
	}

	// 3. Concurrent acquire same key & fp -> Acquired=false, in-flight with WaitCh
	res2, err := store.TryAcquire(ctx, key, fp, 1*time.Hour)
	if err != nil || res2.Acquired {
		t.Fatalf("expected in-flight conflict, got res2=%+v err=%v", res2, err)
	}
	if res2.WaitCh == nil {
		t.Fatalf("expected non-nil WaitCh")
	}

	// 4. Mismatch fingerprint -> ErrFingerprintMismatch
	_, err = store.TryAcquire(ctx, key, "different-fp", 1*time.Hour)
	if !errors.Is(err, ErrFingerprintMismatch) {
		t.Fatalf("expected ErrFingerprintMismatch, got %v", err)
	}

	// 5. Complete leader -> unblocks WaitCh
	hdrs := map[string]string{"Content-Type": "application/json"}
	body := []byte(`{"status":"success"}`)
	err = store.Complete(ctx, key, 200, hdrs, body, 1*time.Hour)
	if err != nil {
		t.Fatalf("Complete failed: %v", err)
	}

	select {
	case <-res2.WaitCh:
		// success unblocked
	case <-time.After(500 * time.Millisecond):
		t.Fatalf("WaitCh did not unblock after Complete")
	}

	// 6. Get cached record
	rec, err := store.Get(ctx, key)
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}
	if rec.Status != StatusCompleted || rec.StatusCode != 200 {
		t.Fatalf("unexpected record: %+v", rec)
	}

	// 7. Delete record
	if err := store.Delete(ctx, key); err != nil {
		t.Fatalf("Delete failed: %v", err)
	}
	if _, err := store.Get(ctx, key); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound after Delete, got %v", err)
	}
}
