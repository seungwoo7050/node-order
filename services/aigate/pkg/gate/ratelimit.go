package gate

import (
	"sync"
	"time"
)

type tokenBucket struct {
	tokens     float64
	capacity   float64
	refillRate float64 // tokens per second
	lastRefill time.Time
	lastAccess time.Time
}

// TokenBucketLimiter implements a thread-safe token bucket rate limiter keyed by tenant identifier.
type TokenBucketLimiter struct {
	mu      sync.Mutex
	cfg     RateLimitConfig
	buckets map[string]*tokenBucket
}

// NewTokenBucketLimiter creates a TokenBucketLimiter with the specified configuration.
func NewTokenBucketLimiter(cfg RateLimitConfig) *TokenBucketLimiter {
	if cfg.RequestsPerSecond <= 0 {
		cfg.RequestsPerSecond = 10.0
	}
	if cfg.Burst <= 0 {
		cfg.Burst = cfg.RequestsPerSecond
	}
	if cfg.IdleTTL <= 0 {
		cfg.IdleTTL = 10 * time.Minute
	}
	return &TokenBucketLimiter{
		cfg:     cfg,
		buckets: make(map[string]*tokenBucket),
	}
}

// Take attempts to consume one token for the given tenantKey at the specified time.
// It returns allowed (true if token was consumed), retryAfter (wait duration before next token is available if rejected),
// and remaining (tokens remaining in bucket after this operation).
func (l *TokenBucketLimiter) Take(tenantKey string, now time.Time) (bool, time.Duration, float64) {
	if tenantKey == "" {
		tenantKey = "default"
	}

	l.mu.Lock()
	defer l.mu.Unlock()

	b, exists := l.buckets[tenantKey]
	if !exists {
		b = &tokenBucket{
			tokens:     l.cfg.Burst,
			capacity:   l.cfg.Burst,
			refillRate: l.cfg.RequestsPerSecond,
			lastRefill: now,
			lastAccess: now,
		}
		l.buckets[tenantKey] = b
	}

	// Refill tokens based on elapsed wall time
	if !b.lastRefill.IsZero() {
		elapsed := now.Sub(b.lastRefill).Seconds()
		if elapsed > 0 {
			b.tokens += elapsed * b.refillRate
			if b.tokens > b.capacity {
				b.tokens = b.capacity
			}
			b.lastRefill = now
		}
	} else {
		b.lastRefill = now
	}
	b.lastAccess = now

	if b.tokens >= 1.0 {
		b.tokens -= 1.0
		return true, 0, b.tokens
	}

	// Rate limit exceeded; calculate retry-after duration
	deficit := 1.0 - b.tokens
	waitSec := deficit / b.refillRate
	retryAfter := time.Duration(waitSec * float64(time.Second))
	if retryAfter < time.Millisecond {
		retryAfter = time.Millisecond
	}

	return false, retryAfter, b.tokens
}

// SweepIdle evicts tenant buckets that have been inactive longer than IdleTTL.
// Returns the number of evicted buckets.
func (l *TokenBucketLimiter) SweepIdle(now time.Time) int {
	l.mu.Lock()
	defer l.mu.Unlock()

	evicted := 0
	for key, b := range l.buckets {
		if now.Sub(b.lastAccess) > l.cfg.IdleTTL {
			delete(l.buckets, key)
			evicted++
		}
	}
	return evicted
}

// BucketCount returns the current number of tracked tenant buckets (used for diagnostics and tests).
func (l *TokenBucketLimiter) BucketCount() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.buckets)
}
