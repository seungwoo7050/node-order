package rolltrace

import (
	"errors"
	"fmt"
	"sync"
	"time"
)

// RolloutStatus represents the lifecycle phase of a canary release.
type RolloutStatus string

const (
	RolloutIdle       RolloutStatus = "idle"
	RolloutCanary     RolloutStatus = "canary"
	RolloutStable     RolloutStatus = "stable"
	RolloutRolledBack RolloutStatus = "rolled_back"
)

// CanaryAction indicates the operational action resulting from an evaluation.
type CanaryAction string

const (
	ActionHold     CanaryAction = "hold"
	ActionPromote  CanaryAction = "promote"
	ActionRollback CanaryAction = "rollback"
	ActionComplete CanaryAction = "complete"
)

// Evaluation reasons explain why an action was chosen.
const (
	ReasonInsufficientSamples = "insufficient_samples"
	ReasonHealthy             = "healthy"
	ReasonBreach              = "breach"
	ReasonConsecutiveBreaches = "consecutive_breaches"
	ReasonRolloutComplete     = "rollout_complete"
	ReasonManualRollback      = "manual_rollback"
)

var (
	ErrRolloutNotFound   = errors.New("rollout not found for service")
	ErrRolloutNotInProg  = errors.New("rollout is not currently in canary phase")
	ErrRolloutInProgress = errors.New("another rollout is already in progress for this service")
)

// RolloutState records the active progression of a deployment.
type RolloutState struct {
	Service          string        `json:"service"`
	Version          string        `json:"version"`
	HolderID         string        `json:"holder_id"`
	Status           RolloutStatus `json:"status"`
	CurrentStepIndex int           `json:"current_step_index"`
	CurrentWeight    int           `json:"current_weight"`
	BreachCount      int           `json:"breach_count"`
	CulpritTraceIDs  []string      `json:"culprit_trace_ids,omitempty"`
	StartedAt        time.Time     `json:"started_at"`
	UpdatedAt        time.Time     `json:"updated_at"`
}

// EvaluationResult details the outcome of an SLO evaluation cycle.
type EvaluationResult struct {
	Service         string       `json:"service"`
	Status          RolloutStatus `json:"status"`
	Action          CanaryAction `json:"action"`
	Reason          string       `json:"reason"`
	CurrentWeight   int          `json:"current_weight"`
	NextWeight      int          `json:"next_weight"`
	BreachCount     int          `json:"breach_count"`
	CulpritTraceIDs []string     `json:"culprit_trace_ids,omitempty"`
	ErrorRate       float64      `json:"error_rate"`
	P99LatencyMs    float64      `json:"p99_latency_ms"`
	TotalSamples    int64        `json:"total_samples"`
}

// CanaryController governs canary progression, SLO burn-rate evaluation, and automated rollback.
type CanaryController struct {
	mu       sync.RWMutex
	cfg      CanaryConfig
	leaseMgr *LeaseManager
	sampler  *TailSampler
	states   map[string]*RolloutState
}

// NewCanaryController constructs a canary coordinator wired to lease and sampling managers.
func NewCanaryController(cfg CanaryConfig, lm *LeaseManager, sampler *TailSampler) *CanaryController {
	if len(cfg.Steps) == 0 {
		cfg.Steps = []int{10, 50, 100}
	}
	if cfg.MinSampleCount <= 0 {
		cfg.MinSampleCount = 20
	}
	if cfg.ConsecutiveBreaches <= 0 {
		cfg.ConsecutiveBreaches = 2
	}
	if cfg.MaxErrorRate <= 0.0 {
		cfg.MaxErrorRate = 0.02
	}
	if cfg.MaxP99LatencyMs <= 0.0 {
		cfg.MaxP99LatencyMs = 800.0
	}

	return &CanaryController{
		cfg:      cfg,
		leaseMgr: lm,
		sampler:  sampler,
		states:   make(map[string]*RolloutState),
	}
}

// StartRollout acquires the deployment lease and initializes the canary progression.
func (cc *CanaryController) StartRollout(service, version, holderID string) (*RolloutState, error) {
	if service == "" {
		return nil, ErrInvalidServiceName
	}
	if holderID == "" {
		return nil, ErrInvalidHolderID
	}

	// 1. Acquire atomic lease to guard against concurrent rollouts
	if cc.leaseMgr != nil {
		if _, err := cc.leaseMgr.TryAcquire(service, holderID, 0); err != nil {
			return nil, fmt.Errorf("failed to acquire deployment lease: %w", err)
		}
	}

	cc.mu.Lock()
	defer cc.mu.Unlock()

	existing, exists := cc.states[service]
	if exists && existing.Status == RolloutCanary {
		return nil, ErrRolloutInProgress
	}

	now := time.Now()
	firstWeight := cc.cfg.Steps[0]

	state := &RolloutState{
		Service:          service,
		Version:          version,
		HolderID:         holderID,
		Status:           RolloutCanary,
		CurrentStepIndex: 0,
		CurrentWeight:    firstWeight,
		BreachCount:      0,
		StartedAt:        now,
		UpdatedAt:        now,
	}
	cc.states[service] = state

	if cc.sampler != nil {
		cc.sampler.ResetSlotMetrics("canary")
	}

	stateCopy := *state
	return &stateCopy, nil
}

// EvaluateCanary assesses current canary metrics against SLO thresholds.
func (cc *CanaryController) EvaluateCanary(service string, metrics SlotMetrics) (*EvaluationResult, error) {
	cc.mu.Lock()
	defer cc.mu.Unlock()

	state, exists := cc.states[service]
	if !exists {
		return nil, ErrRolloutNotFound
	}
	if state.Status != RolloutCanary {
		return nil, ErrRolloutNotInProg
	}

	now := time.Now()
	state.UpdatedAt = now

	// 1. Minimum Sample Count Gate to prevent early false positives
	if metrics.TotalRequests < int64(cc.cfg.MinSampleCount) {
		return &EvaluationResult{
			Service:         service,
			Status:          state.Status,
			Action:          ActionHold,
			Reason:          ReasonInsufficientSamples,
			CurrentWeight:   state.CurrentWeight,
			NextWeight:      state.CurrentWeight,
			BreachCount:     state.BreachCount,
			ErrorRate:       metrics.ErrorRate,
			P99LatencyMs:    metrics.P99LatencyMs,
			TotalSamples:    metrics.TotalRequests,
		}, nil
	}

	// 2. SLO Burn-Rate Breach Detection
	isBreach := metrics.ErrorRate > cc.cfg.MaxErrorRate || metrics.P99LatencyMs > cc.cfg.MaxP99LatencyMs

	if isBreach {
		state.BreachCount++

		// Consecutive breach threshold triggered: Automated Rollback
		if state.BreachCount >= cc.cfg.ConsecutiveBreaches {
			state.Status = RolloutRolledBack
			state.CurrentWeight = 0

			var culprits []string
			if cc.sampler != nil {
				culprits = cc.sampler.GetCulpritTraceIDs("canary", 10)
			}
			state.CulpritTraceIDs = culprits

			if cc.leaseMgr != nil {
				_ = cc.leaseMgr.Release(service, state.HolderID)
			}

			return &EvaluationResult{
				Service:         service,
				Status:          state.Status,
				Action:          ActionRollback,
				Reason:          ReasonConsecutiveBreaches,
				CurrentWeight:   state.CurrentWeight,
				NextWeight:      0,
				BreachCount:     state.BreachCount,
				CulpritTraceIDs: culprits,
				ErrorRate:       metrics.ErrorRate,
				P99LatencyMs:    metrics.P99LatencyMs,
				TotalSamples:    metrics.TotalRequests,
			}, nil
		}

		// First or intermediate breach: Hold and monitor
		return &EvaluationResult{
			Service:       service,
			Status:        state.Status,
			Action:        ActionHold,
			Reason:        ReasonBreach,
			CurrentWeight: state.CurrentWeight,
			NextWeight:    state.CurrentWeight,
			BreachCount:   state.BreachCount,
			ErrorRate:     metrics.ErrorRate,
			P99LatencyMs:  metrics.P99LatencyMs,
			TotalSamples:  metrics.TotalRequests,
		}, nil
	}

	// 3. Healthy: Reset breach counter and promote step
	state.BreachCount = 0

	// Check if this step was already at 100%
	if state.CurrentWeight >= 100 {
		state.Status = RolloutStable
		if cc.leaseMgr != nil {
			_ = cc.leaseMgr.Release(service, state.HolderID)
		}
		return &EvaluationResult{
			Service:       service,
			Status:        state.Status,
			Action:        ActionComplete,
			Reason:        ReasonRolloutComplete,
			CurrentWeight: 100,
			NextWeight:    100,
			BreachCount:   0,
			ErrorRate:     metrics.ErrorRate,
			P99LatencyMs:  metrics.P99LatencyMs,
			TotalSamples:  metrics.TotalRequests,
		}, nil
	}

	nextIndex := state.CurrentStepIndex + 1
	if nextIndex < len(cc.cfg.Steps) {
		state.CurrentStepIndex = nextIndex
		state.CurrentWeight = cc.cfg.Steps[nextIndex]

		if cc.sampler != nil {
			cc.sampler.ResetSlotMetrics("canary")
		}

		// If promoted to 100%, next evaluation or immediate completion
		if state.CurrentWeight == 100 {
			state.Status = RolloutStable
			if cc.leaseMgr != nil {
				_ = cc.leaseMgr.Release(service, state.HolderID)
			}
			return &EvaluationResult{
				Service:       service,
				Status:        state.Status,
				Action:        ActionComplete,
				Reason:        ReasonRolloutComplete,
				CurrentWeight: 100,
				NextWeight:    100,
				BreachCount:   0,
				ErrorRate:     metrics.ErrorRate,
				P99LatencyMs:  metrics.P99LatencyMs,
				TotalSamples:  metrics.TotalRequests,
			}, nil
		}

		return &EvaluationResult{
			Service:       service,
			Status:        state.Status,
			Action:        ActionPromote,
			Reason:        ReasonHealthy,
			CurrentWeight: state.CurrentWeight,
			NextWeight:    state.CurrentWeight,
			BreachCount:   0,
			ErrorRate:     metrics.ErrorRate,
			P99LatencyMs:  metrics.P99LatencyMs,
			TotalSamples:  metrics.TotalRequests,
		}, nil
	}

	// No more steps: Finalize rollout to stable
	state.Status = RolloutStable
	state.CurrentWeight = 100
	if cc.leaseMgr != nil {
		_ = cc.leaseMgr.Release(service, state.HolderID)
	}

	return &EvaluationResult{
		Service:       service,
		Status:        state.Status,
		Action:        ActionComplete,
		Reason:        ReasonRolloutComplete,
		CurrentWeight: 100,
		NextWeight:    100,
		BreachCount:   0,
		ErrorRate:     metrics.ErrorRate,
		P99LatencyMs:  metrics.P99LatencyMs,
		TotalSamples:  metrics.TotalRequests,
	}, nil
}

// ForceRollback manually aborts a rollout, sets weight to 0%, and releases the lease.
func (cc *CanaryController) ForceRollback(service, reason string) (*RolloutState, error) {
	cc.mu.Lock()
	defer cc.mu.Unlock()

	state, exists := cc.states[service]
	if !exists {
		return nil, ErrRolloutNotFound
	}

	state.Status = RolloutRolledBack
	state.CurrentWeight = 0
	state.UpdatedAt = time.Now()

	var culprits []string
	if cc.sampler != nil {
		culprits = cc.sampler.GetCulpritTraceIDs("canary", 10)
	}
	state.CulpritTraceIDs = culprits

	if cc.leaseMgr != nil {
		_ = cc.leaseMgr.Release(service, state.HolderID)
	}

	stateCopy := *state
	return &stateCopy, nil
}

// GetState retrieves the current rollout state for a service.
func (cc *CanaryController) GetState(service string) (*RolloutState, error) {
	cc.mu.RLock()
	defer cc.mu.RUnlock()

	state, exists := cc.states[service]
	if !exists {
		return nil, ErrRolloutNotFound
	}
	stateCopy := *state
	return &stateCopy, nil
}
