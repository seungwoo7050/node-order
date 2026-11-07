-- Outbox events table for transactional outbox pattern
CREATE TABLE IF NOT EXISTS outbox_events (
    id VARCHAR(64) PRIMARY KEY,
    topic VARCHAR(255) NOT NULL,
    endpoint TEXT NOT NULL,
    payload JSONB NOT NULL,
    headers JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(32) NOT NULL DEFAULT 'pending',
    attempts INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 5,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    locked_at TIMESTAMPTZ,
    locked_by VARCHAR(128),
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    delivered_at TIMESTAMPTZ
);

-- Partial index for fast pending event polling and priority ordering
CREATE INDEX IF NOT EXISTS idx_outbox_pending
ON outbox_events (next_attempt_at, id)
WHERE status = 'pending';

-- Partial index for stale lock reaper sweep
CREATE INDEX IF NOT EXISTS idx_outbox_processing
ON outbox_events (locked_at)
WHERE status = 'processing';
