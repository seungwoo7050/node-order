package idem

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync/atomic"
	"time"
)

// Default configurations
const (
	DefaultHeaderName   = "Idempotency-Key"
	DefaultTenantHeader = "X-Tenant-ID"
	DefaultWaitTimeout  = 5 * time.Second
	DefaultTTL          = 24 * time.Hour
)

// Metrics holds Prometheus-compatible lock-free counters.
type Metrics struct {
	AcquiredTotal        atomic.Uint64
	ReplayedTotal        atomic.Uint64
	ConflictTotal        atomic.Uint64
	MismatchTotal        atomic.Uint64
	ReleasedOnErrorTotal atomic.Uint64
}

// Option configures Guard settings.
type Option func(*Guard)

// WithHeaderName sets the HTTP header inspected for idempotency keys.
func WithHeaderName(name string) Option {
	return func(g *Guard) {
		if name != "" {
			g.headerName = name
		}
	}
}

// WithTenantHeader sets the header used to scope keys across tenants.
func WithTenantHeader(name string) Option {
	return func(g *Guard) {
		if name != "" {
			g.tenantHeader = name
		}
	}
}

// WithEnforceTenant requires tenant header presence for idempotency keys.
func WithEnforceTenant(enforce bool) Option {
	return func(g *Guard) {
		g.enforceTenant = enforce
	}
}

// WithWaitPolicy specifies the behavior for concurrent in-flight followers (reject vs wait).
func WithWaitPolicy(policy WaitPolicy) Option {
	return func(g *Guard) {
		g.waitPolicy = policy
	}
}

// WithWaitTimeout sets the maximum wait duration under PolicyWaitAndReplay.
func WithWaitTimeout(timeout time.Duration) Option {
	return func(g *Guard) {
		if timeout > 0 {
			g.waitTimeout = timeout
		}
	}
}

// WithTTL sets the lifetime of completed idempotency records.
func WithTTL(ttl time.Duration) Option {
	return func(g *Guard) {
		if ttl > 0 {
			g.ttl = ttl
		}
	}
}

// WithMaxCaptureBytes sets the maximum response body capture threshold.
func WithMaxCaptureBytes(bytes int) Option {
	return func(g *Guard) {
		if bytes > 0 {
			g.maxCaptureBytes = bytes
		}
	}
}

// Guard is an HTTP middleware enforcing distributed idempotency semantics.
type Guard struct {
	store           Store
	headerName      string
	tenantHeader    string
	enforceTenant   bool
	waitPolicy      WaitPolicy
	waitTimeout     time.Duration
	ttl             time.Duration
	maxCaptureBytes int
	metrics         *Metrics
}

// NewGuard creates a new Guard instance wrapping store.
func NewGuard(store Store, opts ...Option) *Guard {
	g := &Guard{
		store:           store,
		headerName:      DefaultHeaderName,
		tenantHeader:    DefaultTenantHeader,
		enforceTenant:   false,
		waitPolicy:      PolicyWaitAndReplay,
		waitTimeout:     DefaultWaitTimeout,
		ttl:             DefaultTTL,
		maxCaptureBytes: DefaultMaxCaptureBytes,
		metrics:         &Metrics{},
	}

	for _, opt := range opts {
		opt(g)
	}

	return g
}

// Metrics returns the active metrics collector.
func (g *Guard) Metrics() *Metrics {
	return g.metrics
}

// MetricsHandler returns an HTTP handler serving Prometheus text format metrics.
func (g *Guard) MetricsHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
		fmt.Fprintf(w, "# HELP idemguard_acquired_total Total number of newly acquired idempotency keys\n")
		fmt.Fprintf(w, "# TYPE idemguard_acquired_total counter\n")
		fmt.Fprintf(w, "idemguard_acquired_total %d\n", g.metrics.AcquiredTotal.Load())

		fmt.Fprintf(w, "# HELP idemguard_replayed_total Total number of replayed cached responses\n")
		fmt.Fprintf(w, "# TYPE idemguard_replayed_total counter\n")
		fmt.Fprintf(w, "idemguard_replayed_total %d\n", g.metrics.ReplayedTotal.Load())

		fmt.Fprintf(w, "# HELP idemguard_conflict_total Total number of 409 conflict responses\n")
		fmt.Fprintf(w, "# TYPE idemguard_conflict_total counter\n")
		fmt.Fprintf(w, "idemguard_conflict_total %d\n", g.metrics.ConflictTotal.Load())

		fmt.Fprintf(w, "# HELP idemguard_mismatch_total Total number of 422 fingerprint mismatch errors\n")
		fmt.Fprintf(w, "# TYPE idemguard_mismatch_total counter\n")
		fmt.Fprintf(w, "idemguard_mismatch_total %d\n", g.metrics.MismatchTotal.Load())

		fmt.Fprintf(w, "# HELP idemguard_released_on_error_total Total number of locks released due to 5xx or panic\n")
		fmt.Fprintf(w, "# TYPE idemguard_released_on_error_total counter\n")
		fmt.Fprintf(w, "idemguard_released_on_error_total %d\n", g.metrics.ReleasedOnErrorTotal.Load())
	}
}

// Wrap returns an http.Handler that wraps next with idempotency enforcement.
func (g *Guard) Wrap(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		// 1. Safe methods bypass idempotency
		if req.Method == http.MethodGet || req.Method == http.MethodHead || req.Method == http.MethodOptions {
			next.ServeHTTP(w, req)
			return
		}

		// 2. Extract Idempotency-Key
		rawKey := strings.TrimSpace(req.Header.Get(g.headerName))
		if rawKey == "" {
			next.ServeHTTP(w, req)
			return
		}

		// 3. Resolve tenant-scoped key
		scopedKey := rawKey
		tenant := strings.TrimSpace(req.Header.Get(g.tenantHeader))
		if tenant != "" {
			scopedKey = tenant + ":" + rawKey
		} else if g.enforceTenant {
			http.Error(w, "missing required tenant header for idempotent request", http.StatusBadRequest)
			return
		}

		// 4. Read and restore request body
		var bodyBytes []byte
		if req.Body != nil {
			var err error
			bodyBytes, err = io.ReadAll(req.Body)
			if err != nil {
				http.Error(w, "failed to read request body", http.StatusBadRequest)
				return
			}
			req.Body = io.NopCloser(bytes.NewReader(bodyBytes))
		}

		// 5. Compute SHA-256 fingerprint
		fp := ComputeFingerprint(req.Method, req.URL.Path, bodyBytes)

		// 6. TryAcquire
		res, err := g.store.TryAcquire(req.Context(), scopedKey, fp, g.ttl)
		if err != nil {
			if err == ErrFingerprintMismatch || (res.Record != nil && res.Record.Fingerprint != fp) {
				g.metrics.MismatchTotal.Add(1)
				w.Header().Set("X-Idempotent-Error", "fingerprint_mismatch")
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusUnprocessableEntity)
				_, _ = w.Write([]byte(`{"error":"idempotency key payload mismatch"}`))
				return
			}
			http.Error(w, "internal idempotency store error", http.StatusInternalServerError)
			return
		}

		// 7. Follower request handling (not acquired)
		if !res.Acquired {
			if res.Record != nil && res.Record.Status == StatusCompleted {
				g.replayResponse(w, res.Record)
				g.metrics.ReplayedTotal.Add(1)
				return
			}

			if res.Record != nil && res.Record.Status == StatusInFlight {
				if g.waitPolicy == PolicyReject409 {
					g.metrics.ConflictTotal.Add(1)
					w.Header().Set("Retry-After", "1")
					w.Header().Set("X-Idempotent-Status", "in_flight")
					http.Error(w, "conflict: in-flight request pending", http.StatusConflict)
					return
				}

				// PolicyWaitAndReplay
				waitCh := res.WaitCh
				if waitCh == nil {
					g.metrics.ConflictTotal.Add(1)
					w.Header().Set("Retry-After", "1")
					http.Error(w, "conflict: in-flight request pending", http.StatusConflict)
					return
				}

				select {
				case <-waitCh:
					// Leader finished: re-query store
					rec, err := g.store.Get(req.Context(), scopedKey)
					if err != nil {
						// Leader failed (deleted on 5xx or panic)
						g.metrics.ConflictTotal.Add(1)
						http.Error(w, "upstream leader failed, please retry", http.StatusServiceUnavailable)
						return
					}
					g.replayResponse(w, rec)
					g.metrics.ReplayedTotal.Add(1)
					return
				case <-req.Context().Done():
					return
				case <-time.After(g.waitTimeout):
					g.metrics.ConflictTotal.Add(1)
					http.Error(w, "idempotency wait timeout", http.StatusGatewayTimeout)
					return
				}
			}
		}

		// 8. Leader request execution
		defer func() {
			if r := recover(); r != nil {
				_ = g.store.Delete(context.Background(), scopedKey)
				g.metrics.ReleasedOnErrorTotal.Add(1)
				panic(r)
			}
		}()

		rec := NewResponseRecorder(w, g.maxCaptureBytes)
		next.ServeHTTP(rec, req)

		statusCode := rec.StatusCode()
		if statusCode >= 500 {
			// Never cache 5xx server errors; release lock so clients can retry
			_ = g.store.Delete(context.Background(), scopedKey)
			g.metrics.ReleasedOnErrorTotal.Add(1)
		} else {
			// Cache 2xx, 3xx, 4xx responses
			hdrs := rec.CapturedHeaders()
			body := rec.CapturedBody()
			_ = g.store.Complete(context.Background(), scopedKey, statusCode, hdrs, body, g.ttl)
			g.metrics.AcquiredTotal.Add(1)
		}
	})
}

func (g *Guard) replayResponse(w http.ResponseWriter, rec *Record) {
	for k, v := range rec.Headers {
		w.Header().Set(k, v)
	}
	w.Header().Set("X-Idempotent-Replayed", "true")
	w.WriteHeader(rec.StatusCode)
	if len(rec.Body) > 0 {
		_, _ = w.Write(rec.Body)
	}
}
