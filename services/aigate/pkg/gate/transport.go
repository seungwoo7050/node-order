package gate

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"math"
	"net/http"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
)

type bufferedResponse struct {
	resp *http.Response
	body []byte
}

// Gateway implements both http.RoundTripper (for client SDK injection) and http.Handler (for reverse proxy mode).
// It coordinates RateLimiting -> SingleFlight coalescing -> Failover Routing -> CircuitBreaker -> SSE Passthrough.
type Gateway struct {
	cfg          Config
	rateLimiter  *TokenBucketLimiter
	singleFlight *Group
	failover     *FailoverRouter

	requestsTotal    atomic.Uint64
	coalescedTotal   atomic.Uint64
	rateLimitedTotal atomic.Uint64
}

// NewGateway creates and initializes a Gateway with the specified configuration.
func NewGateway(cfg Config) *Gateway {
	if cfg.DefaultTimeout <= 0 {
		cfg.DefaultTimeout = 30 * time.Second
	}
	if cfg.MaxBodyBytes <= 0 {
		cfg.MaxBodyBytes = 10 * 1024 * 1024
	}

	return &Gateway{
		cfg:          cfg,
		rateLimiter:  NewTokenBucketLimiter(cfg.RateLimit),
		singleFlight: NewGroup(),
		failover:     NewFailoverRouter(cfg.Providers, cfg.Breaker, cfg.MaxBodyBytes),
	}
}

// RateLimiter returns the gateway's token bucket rate limiter.
func (g *Gateway) RateLimiter() *TokenBucketLimiter {
	return g.rateLimiter
}

// SingleFlight returns the gateway's context-isolated single-flight group.
func (g *Gateway) SingleFlight() *Group {
	return g.singleFlight
}

// Failover returns the gateway's failover router.
func (g *Gateway) Failover() *FailoverRouter {
	return g.failover
}

// Metrics returns the snapshot of core observability counters.
func (g *Gateway) Metrics() (requests, coalesced, rateLimited, failovers uint64) {
	return g.requestsTotal.Load(), g.coalescedTotal.Load(), g.rateLimitedTotal.Load(), g.failover.FailoverCount()
}

// RoundTrip executes a single HTTP request through the gateway resilience pipeline.
func (g *Gateway) RoundTrip(req *http.Request) (*http.Response, error) {
	g.requestsTotal.Add(1)

	// 1. Rate Limiting Check
	tenantKey := req.Header.Get("X-Tenant-ID")
	if tenantKey == "" {
		auth := req.Header.Get("Authorization")
		if strings.HasPrefix(auth, "Bearer ") {
			tenantKey = strings.TrimPrefix(auth, "Bearer ")
		} else {
			tenantKey = "default"
		}
	}

	allowed, retryAfter, _ := g.rateLimiter.Take(tenantKey, time.Now())
	if !allowed {
		g.rateLimitedTotal.Add(1)

		retrySec := int(math.Ceil(retryAfter.Seconds()))
		if retrySec < 1 {
			retrySec = 1
		}

		resp := &http.Response{
			StatusCode: http.StatusTooManyRequests,
			Status:     "429 Too Many Requests",
			Proto:      "HTTP/1.1",
			ProtoMajor: 1,
			ProtoMinor: 1,
			Header:     make(http.Header),
			Body:       io.NopCloser(strings.NewReader(`{"error":{"message":"rate limit exceeded","type":"rate_limit_error"}}`)),
			Request:    req,
		}
		resp.Header.Set("Retry-After", strconv.Itoa(retrySec))
		resp.Header.Set("Content-Type", "application/json")
		return resp, nil
	}

	// 2. Buffer request body for single-flight hashing and failover replay
	var bodyBytes []byte
	if req.Body != nil && req.Body != http.NoBody {
		var err error
		bodyBytes, err = io.ReadAll(io.LimitReader(req.Body, g.cfg.MaxBodyBytes))
		_ = req.Body.Close()
		if err != nil {
			return nil, err
		}
		req.GetBody = func() (io.ReadCloser, error) {
			return io.NopCloser(bytes.NewReader(bodyBytes)), nil
		}
		req.Body, _ = req.GetBody()
	}

	// 3. Streaming Passthrough: If SSE is requested, bypass Single-Flight to preserve TTFT
	if IsSSERequest(req, bodyBytes) {
		return g.failover.RoundTrip(req)
	}

	// 4. Non-Streaming Request: Coalesce duplicate requests via Single-Flight
	key := RequestKey(req.Method, req.URL.Path, bodyBytes)

	val, err, shared := g.singleFlight.Do(req.Context(), key, func(execCtx context.Context) (any, error) {
		execReq := req.Clone(execCtx)
		if len(bodyBytes) > 0 {
			execReq.Body = io.NopCloser(bytes.NewReader(bodyBytes))
			execReq.GetBody = func() (io.ReadCloser, error) {
				return io.NopCloser(bytes.NewReader(bodyBytes)), nil
			}
		}

		resp, roundTripErr := g.failover.RoundTrip(execReq)
		if roundTripErr != nil {
			return nil, roundTripErr
		}

		// Buffer response body so all coalesced followers get independent streams
		defer resp.Body.Close()
		respBodyBytes, readErr := io.ReadAll(resp.Body)
		if readErr != nil {
			return nil, readErr
		}

		return &bufferedResponse{
			resp: resp,
			body: respBodyBytes,
		}, nil
	})

	if err != nil {
		return nil, err
	}

	if shared {
		g.coalescedTotal.Add(1)
	}

	bufResp, ok := val.(*bufferedResponse)
	if !ok {
		return nil, fmt.Errorf("unexpected singleflight response type: %T", val)
	}

	return cloneResponse(bufResp.resp, bufResp.body, req), nil
}

func cloneResponse(orig *http.Response, bodyBytes []byte, req *http.Request) *http.Response {
	cloned := *orig
	cloned.Header = orig.Header.Clone()
	cloned.Trailer = orig.Trailer.Clone()
	cloned.Body = io.NopCloser(bytes.NewReader(bodyBytes))
	cloned.Request = req
	cloned.ContentLength = int64(len(bodyBytes))
	return &cloned
}

// ServeHTTP implements http.Handler, exposing /healthz, /metrics, and reverse proxying all other routes.
func (g *Gateway) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	if req.URL.Path == "/healthz" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
		return
	}

	if req.URL.Path == "/metrics" {
		w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		g.writeMetrics(w)
		return
	}

	// Reverse proxy handling
	resp, err := g.RoundTrip(req)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadGateway)
		_, _ = fmt.Fprintf(w, `{"error":{"message":%q,"type":"gateway_error"}}`, err.Error())
		return
	}

	// If upstream returned an SSE stream, proxy unbuffered chunks
	if IsSSEResponse(resp) {
		_ = ProxyStream(w, resp)
		return
	}

	// Standard response passthrough
	for k, vv := range resp.Header {
		for _, v := range vv {
			w.Header().Add(k, v)
		}
	}
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
	_ = resp.Body.Close()
}

func (g *Gateway) writeMetrics(w io.Writer) {
	fmt.Fprintf(w, "# HELP aigate_requests_total Total number of processed requests\n")
	fmt.Fprintf(w, "# TYPE aigate_requests_total counter\n")
	fmt.Fprintf(w, "aigate_requests_total %d\n", g.requestsTotal.Load())

	fmt.Fprintf(w, "# HELP aigate_coalesced_total Total number of requests coalesced via Single-Flight\n")
	fmt.Fprintf(w, "# TYPE aigate_coalesced_total counter\n")
	fmt.Fprintf(w, "aigate_coalesced_total %d\n", g.coalescedTotal.Load())

	fmt.Fprintf(w, "# HELP aigate_rate_limited_total Total number of rate-limited requests\n")
	fmt.Fprintf(w, "# TYPE aigate_rate_limited_total counter\n")
	fmt.Fprintf(w, "aigate_rate_limited_total %d\n", g.rateLimitedTotal.Load())

	fmt.Fprintf(w, "# HELP aigate_failover_total Total number of provider failover attempts\n")
	fmt.Fprintf(w, "# TYPE aigate_failover_total counter\n")
	fmt.Fprintf(w, "aigate_failover_total %d\n", g.failover.FailoverCount())

	fmt.Fprintf(w, "# HELP aigate_circuit_state Upstream circuit breaker state (0=Closed, 1=HalfOpen, 2=Open)\n")
	fmt.Fprintf(w, "# TYPE aigate_circuit_state gauge\n")
	for _, p := range g.failover.Providers() {
		state := 0
		if b := g.failover.GetProviderBreaker(p.Name); b != nil {
			state = int(b.State())
		}
		fmt.Fprintf(w, "aigate_circuit_state{provider=%q} %d\n", p.Name, state)
	}
}
