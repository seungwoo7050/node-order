package gate

import (
	"sync"
	"time"
)

// State represents the operational state of a circuit breaker.
type State int

const (
	// StateClosed indicates normal operation; requests are passed to upstream.
	StateClosed State = iota
	// StateHalfOpen indicates recovery probe mode; limited requests are admitted to test upstream health.
	StateHalfOpen
	// StateOpen indicates tripped state; all requests fail fast to prevent cascading failure.
	StateOpen
)

// String returns a human-readable representation of the breaker state.
func (s State) String() string {
	switch s {
	case StateClosed:
		return "Closed"
	case StateHalfOpen:
		return "HalfOpen"
	case StateOpen:
		return "Open"
	default:
		return "Unknown"
	}
}

// CircuitBreaker implements a 3-state circuit breaker with strict probe concurrency gating in Half-Open state.
type CircuitBreaker struct {
	mu sync.Mutex

	state                State
	consecutiveFailures  int
	openedAt             time.Time
	halfOpenProbesActive int

	cfg BreakerConfig
}

// NewCircuitBreaker creates a new CircuitBreaker with the given configuration.
func NewCircuitBreaker(cfg BreakerConfig) *CircuitBreaker {
	if cfg.FailureThreshold <= 0 {
		cfg.FailureThreshold = 3
	}
	if cfg.Cooldown <= 0 {
		cfg.Cooldown = 5 * time.Second
	}
	if cfg.MaxHalfOpenProbes <= 0 {
		cfg.MaxHalfOpenProbes = 1
	}
	return &CircuitBreaker{
		state: StateClosed,
		cfg:   cfg,
	}
}

// Allow evaluates whether a request may proceed based on the breaker's current state and wall-clock time.
// If allowed, it returns (true, doneFn) where doneFn must be invoked with true (success) or false (failure).
// If rejected, it returns (false, nil).
func (cb *CircuitBreaker) Allow(now time.Time) (bool, func(success bool)) {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	// 1. If Open, check if cooldown has elapsed to transition to Half-Open
	if cb.state == StateOpen {
		if !cb.openedAt.IsZero() && now.Sub(cb.openedAt) >= cb.cfg.Cooldown {
			cb.state = StateHalfOpen
			cb.halfOpenProbesActive = 0
		} else {
			return false, nil
		}
	}

	// 2. If Half-Open, strictly gate concurrent probe requests to MaxHalfOpenProbes
	if cb.state == StateHalfOpen {
		if cb.halfOpenProbesActive < cb.cfg.MaxHalfOpenProbes {
			cb.halfOpenProbesActive++
			var once sync.Once
			return true, func(success bool) {
				once.Do(func() {
					cb.onProbeResult(success, time.Now())
				})
			}
		}
		// Probe quota saturated; fast fail concurrent requests
		return false, nil
	}

	// 3. State is Closed; normal operation
	var once sync.Once
	return true, func(success bool) {
		once.Do(func() {
			cb.onClosedResult(success, time.Now())
		})
	}
}

func (cb *CircuitBreaker) onClosedResult(success bool, now time.Time) {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	if cb.state != StateClosed {
		return
	}

	if success {
		cb.consecutiveFailures = 0
	} else {
		cb.consecutiveFailures++
		if cb.consecutiveFailures >= cb.cfg.FailureThreshold {
			cb.state = StateOpen
			cb.openedAt = now
			cb.halfOpenProbesActive = 0
		}
	}
}

func (cb *CircuitBreaker) onProbeResult(success bool, now time.Time) {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	if cb.halfOpenProbesActive > 0 {
		cb.halfOpenProbesActive--
	}

	if cb.state != StateHalfOpen {
		return
	}

	if success {
		// Probe succeeded: recover to Closed
		cb.state = StateClosed
		cb.consecutiveFailures = 0
		cb.halfOpenProbesActive = 0
	} else {
		// Probe failed: trip back to Open for another Cooldown cycle
		cb.state = StateOpen
		cb.openedAt = now
		cb.halfOpenProbesActive = 0
	}
}

// State returns the current State, transitioning from Open to HalfOpen if Cooldown has elapsed.
func (cb *CircuitBreaker) State() State {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	if cb.state == StateOpen && !cb.openedAt.IsZero() && time.Since(cb.openedAt) >= cb.cfg.Cooldown {
		cb.state = StateHalfOpen
		cb.halfOpenProbesActive = 0
	}
	return cb.state
}

// Reset restores the breaker to StateClosed and clears failure counters.
func (cb *CircuitBreaker) Reset() {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	cb.state = StateClosed
	cb.consecutiveFailures = 0
	cb.halfOpenProbesActive = 0
	cb.openedAt = time.Time{}
}

// Trip forces the breaker into StateOpen immediately (useful for manual intervention or testing).
func (cb *CircuitBreaker) Trip(now time.Time) {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	cb.state = StateOpen
	cb.openedAt = now
	cb.halfOpenProbesActive = 0
}
