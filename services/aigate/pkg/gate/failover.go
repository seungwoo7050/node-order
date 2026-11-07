package gate

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
)

// upstreamProvider represents a single configured provider with its own circuit breaker and HTTP client.
type upstreamProvider struct {
	config  ProviderConfig
	breaker *CircuitBreaker
	client  *http.Client
}

// FailoverRouter manages multiple upstream providers, routing requests in priority order
// while respecting circuit breakers and recording failover attempts.
type FailoverRouter struct {
	providers     []*upstreamProvider
	maxBodyBytes  int64
	failoverTotal atomic.Uint64
}

// NewFailoverRouter creates a new FailoverRouter with the given providers and breaker configuration.
func NewFailoverRouter(providers []ProviderConfig, breakerCfg BreakerConfig, maxBodyBytes int64) *FailoverRouter {
	if maxBodyBytes <= 0 {
		maxBodyBytes = 10 * 1024 * 1024 // 10MB default
	}

	// Sort providers in ascending order of Priority (1 is primary)
	sorted := make([]ProviderConfig, len(providers))
	copy(sorted, providers)
	sort.Slice(sorted, func(i, j int) bool {
		return sorted[i].Priority < sorted[j].Priority
	})

	upstreams := make([]*upstreamProvider, len(sorted))
	for i, p := range sorted {
		timeout := p.Timeout
		if timeout <= 0 {
			timeout = 30 * time.Second
		}
		upstreams[i] = &upstreamProvider{
			config:  p,
			breaker: NewCircuitBreaker(breakerCfg),
			client: &http.Client{
				Timeout: timeout,
			},
		}
	}

	return &FailoverRouter{
		providers:    upstreams,
		maxBodyBytes: maxBodyBytes,
	}
}

// Providers returns the list of upstream provider configurations.
func (r *FailoverRouter) Providers() []ProviderConfig {
	res := make([]ProviderConfig, len(r.providers))
	for i, p := range r.providers {
		res[i] = p.config
	}
	return res
}

// GetProviderBreaker returns the CircuitBreaker for a named provider (used in tests and metrics).
func (r *FailoverRouter) GetProviderBreaker(name string) *CircuitBreaker {
	for _, p := range r.providers {
		if p.config.Name == name {
			return p.breaker
		}
	}
	return nil
}

// SetProviderTransport overrides the RoundTripper for a named provider (used for test mocks).
func (r *FailoverRouter) SetProviderTransport(name string, rt http.RoundTripper) {
	for _, p := range r.providers {
		if p.config.Name == name {
			p.client.Transport = rt
		}
	}
}

// FailoverCount returns the total number of failover attempts made.
func (r *FailoverRouter) FailoverCount() uint64 {
	return r.failoverTotal.Load()
}

// RoundTrip executes the request across configured providers in priority order.
// If a provider's circuit breaker is Open or Half-Open saturated, or if the request fails
// with a 5xx/429/network error, the router automatically fails over to the next provider.
func (r *FailoverRouter) RoundTrip(req *http.Request) (*http.Response, error) {
	if len(r.providers) == 0 {
		return nil, ErrAllProvidersFailed
	}

	// Ensure request body can be replayed across multiple providers
	var bodyBytes []byte
	if req.Body != nil && req.Body != http.NoBody {
		var err error
		bodyBytes, err = io.ReadAll(io.LimitReader(req.Body, r.maxBodyBytes))
		_ = req.Body.Close()
		if err != nil {
			return nil, err
		}
		req.GetBody = func() (io.ReadCloser, error) {
			return io.NopCloser(bytes.NewReader(bodyBytes)), nil
		}
		req.Body, _ = req.GetBody()
	}

	failovers := 0
	var lastErr error

	for _, p := range r.providers {
		// 1. Check circuit breaker allowance
		allowed, done := p.breaker.Allow(time.Now())
		if !allowed {
			// Breaker is open or probe saturated; skip this provider
			failovers++
			r.failoverTotal.Add(1)
			continue
		}

		// 2. Prepare cloned request for this provider
		outReq := req.Clone(req.Context())

		// URL rewriting if BaseURL is configured
		if p.config.BaseURL != "" {
			baseURL, err := url.Parse(p.config.BaseURL)
			if err == nil {
				outReq.URL.Scheme = baseURL.Scheme
				outReq.URL.Host = baseURL.Host
				outReq.Host = baseURL.Host
				if baseURL.Path != "" && baseURL.Path != "/" {
					outReq.URL.Path = singleJoiningSlash(baseURL.Path, outReq.URL.Path)
				}
			}
		}

		// Attach provider API key if specified
		if p.config.APIKey != "" {
			outReq.Header.Set("Authorization", "Bearer "+p.config.APIKey)
		}

		// Reset body for this attempt
		if req.GetBody != nil {
			outReq.Body, _ = req.GetBody()
		}

		// 3. Execute HTTP call to provider
		resp, err := p.client.Do(outReq)

		// 4. Evaluate outcome
		if err != nil {
			done(false)
			lastErr = err

			// If caller context was cancelled, do not attempt further failovers
			if req.Context().Err() != nil {
				return nil, req.Context().Err()
			}

			failovers++
			r.failoverTotal.Add(1)
			continue
		}

		// Check if response indicates upstream server failure or rate limit
		if resp.StatusCode >= 500 || resp.StatusCode == http.StatusTooManyRequests {
			done(false)
			_ = resp.Body.Close()
			lastErr = &httpError{statusCode: resp.StatusCode, status: resp.Status}

			failovers++
			r.failoverTotal.Add(1)
			continue
		}

		// Upstream succeeded (2xx, 3xx, or 4xx non-429)
		done(true)
		resp.Header.Set("X-AIGate-Provider", p.config.Name)
		resp.Header.Set("X-AIGate-Failover-Count", strconv.Itoa(failovers))
		return resp, nil
	}

	if lastErr != nil {
		return nil, fmt.Errorf("%w: %v", ErrAllProvidersFailed, lastErr)
	}
	return nil, ErrAllProvidersFailed
}

type httpError struct {
	statusCode int
	status     string
}

func (e *httpError) Error() string {
	return "upstream error: " + e.status
}

func singleJoiningSlash(a, b string) string {
	aslash := strings.HasSuffix(a, "/")
	bslash := strings.HasPrefix(b, "/")
	switch {
	case aslash && bslash:
		return a + b[1:]
	case !aslash && !bslash:
		return a + "/" + b
	}
	return a + b
}
