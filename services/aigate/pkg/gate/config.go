package gate

import (
	"errors"
	"time"
)

var (
	// ErrRateLimited is returned when a tenant exceeds their token bucket quota.
	ErrRateLimited = errors.New("rate limit exceeded")

	// ErrCircuitOpen is returned when an upstream provider's circuit breaker is in the Open state.
	ErrCircuitOpen = errors.New("circuit breaker is open")

	// ErrAllProvidersFailed is returned when every configured provider fails to handle the request.
	ErrAllProvidersFailed = errors.New("all upstream providers failed")

	// ErrHalfOpenSaturated is returned when the maximum probe concurrency in Half-Open state is reached.
	ErrHalfOpenSaturated = errors.New("half-open probe capacity saturated")
)

// ProviderConfig configures an individual upstream AI/API provider.
type ProviderConfig struct {
	Name     string
	BaseURL  string
	APIKey   string
	Timeout  time.Duration
	Priority int // Lower number indicates higher priority (1 is primary)
}

// RateLimitConfig configures the per-tenant token bucket rate limiter.
type RateLimitConfig struct {
	RequestsPerSecond float64
	Burst             float64
	IdleTTL           time.Duration
}

// BreakerConfig configures the 3-state circuit breaker.
type BreakerConfig struct {
	FailureThreshold  int           // Consecutive failures to trip to Open
	Cooldown          time.Duration // Duration to remain Open before entering Half-Open
	MaxHalfOpenProbes int           // Maximum concurrent probe requests in Half-Open (default 1)
}

// Config configures the gateway transport and reverse proxy.
type Config struct {
	Providers      []ProviderConfig
	RateLimit      RateLimitConfig
	Breaker        BreakerConfig
	DefaultTimeout time.Duration
	MaxBodyBytes   int64 // Max request body size in bytes to buffer for failover/hashing (default 10MB)
}

// DefaultConfig provides sensible defaults for gateway configuration.
func DefaultConfig() Config {
	return Config{
		RateLimit: RateLimitConfig{
			RequestsPerSecond: 10.0,
			Burst:             20.0,
			IdleTTL:           10 * time.Minute,
		},
		Breaker: BreakerConfig{
			FailureThreshold:  3,
			Cooldown:          5 * time.Second,
			MaxHalfOpenProbes: 1,
		},
		DefaultTimeout: 30 * time.Second,
		MaxBodyBytes:   10 * 1024 * 1024, // 10MB
	}
}
