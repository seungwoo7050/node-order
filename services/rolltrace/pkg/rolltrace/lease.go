package rolltrace

import (
	"errors"
	"sync"
	"time"
)

var (
	ErrLeaseHeld           = errors.New("deployment lease is currently held by another worker")
	ErrLeaseNotFound       = errors.New("deployment lease not found")
	ErrUnauthorizedHolder  = errors.New("unauthorized lease holder")
	ErrInvalidHolderID     = errors.New("holder id cannot be empty")
	ErrInvalidServiceName  = errors.New("service name cannot be empty")
	ErrInvalidLeaseTTL     = errors.New("lease ttl must be greater than zero")
)

// Lease represents a time-bounded mutual exclusion lease on a deployment pipeline.
type Lease struct {
	Service    string    `json:"service"`
	HolderID   string    `json:"holder_id"`
	AcquiredAt time.Time `json:"acquired_at"`
	ExpiresAt  time.Time `json:"expires_at"`
	Version    int64     `json:"version"`
}

// IsExpired checks if the lease has passed its expiration time.
func (l *Lease) IsExpired(now time.Time) bool {
	return now.After(l.ExpiresAt) || now.Equal(l.ExpiresAt)
}

// LeaseManager coordinates atomic deployment leases to prevent split-brain rollouts.
type LeaseManager struct {
	mu     sync.RWMutex
	cfg    LeaseConfig
	leases map[string]*Lease
}

// NewLeaseManager creates an in-memory lease coordinator.
func NewLeaseManager(cfg LeaseConfig) *LeaseManager {
	if cfg.DefaultTTL <= 0 {
		cfg.DefaultTTL = 5 * time.Minute
	}
	return &LeaseManager{
		cfg:    cfg,
		leases: make(map[string]*Lease),
	}
}

// TryAcquire atomically attempts to acquire or renew a lease for a service.
func (lm *LeaseManager) TryAcquire(service, holderID string, ttl time.Duration) (*Lease, error) {
	if service == "" {
		return nil, ErrInvalidServiceName
	}
	if holderID == "" {
		return nil, ErrInvalidHolderID
	}
	if ttl <= 0 {
		ttl = lm.cfg.DefaultTTL
	}

	lm.mu.Lock()
	defer lm.mu.Unlock()

	now := time.Now()
	existing, found := lm.leases[service]

	if found && !existing.IsExpired(now) {
		if existing.HolderID == holderID {
			// Idempotent renewal by the same holder
			existing.ExpiresAt = now.Add(ttl)
			existing.Version++
			leaseCopy := *existing
			return &leaseCopy, nil
		}
		return nil, ErrLeaseHeld
	}

	// Lease does not exist or has expired; acquire freshly
	newLease := &Lease{
		Service:    service,
		HolderID:   holderID,
		AcquiredAt: now,
		ExpiresAt:  now.Add(ttl),
		Version:    1,
	}
	lm.leases[service] = newLease

	leaseCopy := *newLease
	return &leaseCopy, nil
}

// Renew extends an active lease if and only if the caller matches the holder ID.
func (lm *LeaseManager) Renew(service, holderID string, ttl time.Duration) (*Lease, error) {
	if service == "" {
		return nil, ErrInvalidServiceName
	}
	if holderID == "" {
		return nil, ErrInvalidHolderID
	}
	if ttl <= 0 {
		ttl = lm.cfg.DefaultTTL
	}

	lm.mu.Lock()
	defer lm.mu.Unlock()

	now := time.Now()
	existing, found := lm.leases[service]
	if !found || existing.IsExpired(now) {
		return nil, ErrLeaseNotFound
	}
	if existing.HolderID != holderID {
		return nil, ErrUnauthorizedHolder
	}

	existing.ExpiresAt = now.Add(ttl)
	existing.Version++
	leaseCopy := *existing
	return &leaseCopy, nil
}

// Release relinquishes the lease for the service if held by holderID.
func (lm *LeaseManager) Release(service, holderID string) error {
	if service == "" {
		return ErrInvalidServiceName
	}
	if holderID == "" {
		return ErrInvalidHolderID
	}

	lm.mu.Lock()
	defer lm.mu.Unlock()

	now := time.Now()
	existing, found := lm.leases[service]
	if !found {
		return ErrLeaseNotFound
	}
	if existing.IsExpired(now) {
		delete(lm.leases, service)
		return ErrLeaseNotFound
	}
	if existing.HolderID != holderID {
		return ErrUnauthorizedHolder
	}

	delete(lm.leases, service)
	return nil
}

// GetLease retrieves the active lease for a service, returning false if expired or missing.
func (lm *LeaseManager) GetLease(service string) (*Lease, bool) {
	lm.mu.RLock()
	defer lm.mu.RUnlock()

	existing, found := lm.leases[service]
	if !found || existing.IsExpired(time.Now()) {
		return nil, false
	}
	leaseCopy := *existing
	return &leaseCopy, true
}
