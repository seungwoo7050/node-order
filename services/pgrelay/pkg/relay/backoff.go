package relay

import (
	"math"
	"math/rand"
	"sync"
	"time"
)

// BackoffPolicy configures exponential backoff with optional Full Jitter.
type BackoffPolicy struct {
	BaseDelay time.Duration
	MaxDelay  time.Duration
	Factor    float64
	Jitter    bool

	mu  *sync.Mutex
	rng *rand.Rand
}

// DefaultBackoffPolicy returns a production-ready Full Jitter exponential backoff policy.
// Base delay: 1s, Max delay: 60s, Factor: 2.0, Full Jitter enabled.
func DefaultBackoffPolicy() BackoffPolicy {
	return BackoffPolicy{
		BaseDelay: 1 * time.Second,
		MaxDelay:  60 * time.Second,
		Factor:    2.0,
		Jitter:    true,
		mu:        &sync.Mutex{},
		rng:       rand.New(rand.NewSource(time.Now().UnixNano())),
	}
}

// Compute calculates the backoff duration for the given attempt count (1-indexed).
// When Jitter is true, it implements AWS Full Jitter:
// sleep = random(0, min(MaxDelay, BaseDelay * Factor^(attempt-1)))
func (p *BackoffPolicy) Compute(attempt int) time.Duration {
	if attempt <= 0 {
		attempt = 1
	}

	base := float64(p.BaseDelay)
	if base <= 0 {
		base = float64(100 * time.Millisecond)
	}

	factor := p.Factor
	if factor < 1.0 {
		factor = 2.0
	}

	maxDelay := float64(p.MaxDelay)
	if maxDelay <= 0 {
		maxDelay = float64(60 * time.Second)
	}

	// Calculate exponential delay: BaseDelay * Factor^(attempt-1)
	expDelay := base * math.Pow(factor, float64(attempt-1))
	if expDelay > maxDelay || expDelay < 0 {
		expDelay = maxDelay
	}

	if !p.Jitter {
		return time.Duration(expDelay)
	}

	// Full Jitter: random duration in [0, expDelay]
	var ratio float64
	if p.mu != nil && p.rng != nil {
		p.mu.Lock()
		ratio = p.rng.Float64()
		p.mu.Unlock()
	} else {
		ratio = rand.Float64()
	}

	return time.Duration(ratio * expDelay)
}
