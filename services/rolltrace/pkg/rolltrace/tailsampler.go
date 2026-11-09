package rolltrace

import (
	"sort"
	"strconv"
	"sync"
	"time"

	"github.com/cespare/xxhash/v2"
	"github.com/prometheus/client_golang/prometheus"
)

// SamplingDecision represents the disposition of a trace.
type SamplingDecision string

const (
	DecisionDrop        SamplingDecision = "drop"
	DecisionKeepAnomaly SamplingDecision = "keep_anomaly"
	DecisionKeepSampled SamplingDecision = "keep_sampled"
)

var (
	metricsOnce sync.Once

	spanRequestsTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "rolltrace_span_requests_total",
			Help: "Total number of ingested spans partitioned by service, slot, and status code.",
		},
		[]string{"service", "slot", "status_code"},
	)

	spanErrorsTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "rolltrace_span_errors_total",
			Help: "Total number of errored spans partitioned by service and slot.",
		},
		[]string{"service", "slot"},
	)

	spanDurationMs = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "rolltrace_span_duration_ms",
			Help:    "Execution duration of spans in milliseconds.",
			Buckets: []float64{5, 10, 25, 50, 100, 250, 500, 800, 1000, 2500, 5000},
		},
		[]string{"service", "slot"},
	)
)

func registerPrometheusMetrics() {
	metricsOnce.Do(func() {
		_ = prometheus.Register(spanRequestsTotal)
		_ = prometheus.Register(spanErrorsTotal)
		_ = prometheus.Register(spanDurationMs)
	})
}

// SlotMetrics summarizes real-time performance indicators for a slot.
type SlotMetrics struct {
	TotalRequests int64   `json:"total_requests"`
	ErrorCount    int64   `json:"error_count"`
	ErrorRate     float64 `json:"error_rate"`
	P99LatencyMs  float64 `json:"p99_latency_ms"`
}

type slotTracker struct {
	mu            sync.RWMutex
	totalRequests int64
	errorCount    int64
	latencies     []int64
}

func newSlotTracker() *slotTracker {
	return &slotTracker{
		latencies: make([]int64, 0, 1024),
	}
}

func (st *slotTracker) record(isError bool, latencyMs int64) {
	st.mu.Lock()
	defer st.mu.Unlock()

	st.totalRequests++
	if isError {
		st.errorCount++
	}
	st.latencies = append(st.latencies, latencyMs)
}

func (st *slotTracker) snapshot() SlotMetrics {
	st.mu.RLock()
	defer st.mu.RUnlock()

	var errorRate float64
	if st.totalRequests > 0 {
		errorRate = float64(st.errorCount) / float64(st.totalRequests)
	}

	p99 := 0.0
	if len(st.latencies) > 0 {
		sorted := make([]int64, len(st.latencies))
		copy(sorted, st.latencies)
		sort.Slice(sorted, func(i, j int) bool {
			return sorted[i] < sorted[j]
		})
		idx := int(float64(len(sorted)-1) * 0.99)
		if idx >= len(sorted) {
			idx = len(sorted) - 1
		}
		p99 = float64(sorted[idx])
	}

	return SlotMetrics{
		TotalRequests: st.totalRequests,
		ErrorCount:    st.errorCount,
		ErrorRate:     errorRate,
		P99LatencyMs:  p99,
	}
}

func (st *slotTracker) reset() {
	st.mu.Lock()
	defer st.mu.Unlock()

	st.totalRequests = 0
	st.errorCount = 0
	st.latencies = st.latencies[:0]
}

type bufferedTrace struct {
	traceID     string
	spans       []*Span
	hasAnomaly  bool
	firstSeen   time.Time
	lastUpdated time.Time
}

// TailSampler orchestrates tail-based sampling, RED metric extraction, and priority trace caching.
type TailSampler struct {
	mu           sync.RWMutex
	cfg          TailSampleConfig
	traces       map[string]*bufferedTrace
	stableSlot   *slotTracker
	canarySlot   *slotTracker
	customSlots  map[string]*slotTracker
	culpritMu    sync.RWMutex
	canaryErrors []string // FIFO list of culprit trace IDs
}

// NewTailSampler instantiates a TailSampler with the supplied configuration.
func NewTailSampler(cfg TailSampleConfig) *TailSampler {
	registerPrometheusMetrics()

	if cfg.MaxBufferedTraces <= 0 {
		cfg.MaxBufferedTraces = 2048
	}
	if cfg.MaxSpansPerTrace <= 0 {
		cfg.MaxSpansPerTrace = 128
	}
	if cfg.LatencyThresholdMs <= 0 {
		cfg.LatencyThresholdMs = 500
	}
	if cfg.ErrorStatusThreshold <= 0 {
		cfg.ErrorStatusThreshold = 500
	}

	return &TailSampler{
		cfg:          cfg,
		traces:       make(map[string]*bufferedTrace, cfg.MaxBufferedTraces),
		stableSlot:   newSlotTracker(),
		canarySlot:   newSlotTracker(),
		customSlots:  make(map[string]*slotTracker),
		canaryErrors: make([]string, 0, 128),
	}
}

// IngestSpan receives a span, extracts 100% RED metrics upfront, and buffers the span.
func (ts *TailSampler) IngestSpan(span *Span) {
	if span == nil || span.TraceID == "" {
		return
	}

	// 1. 100% Upfront RED SpanMetrics extraction
	slot := span.Slot
	if slot == "" {
		slot = "stable"
	}
	statusCodeStr := strconv.Itoa(span.StatusCode)
	spanRequestsTotal.WithLabelValues(span.Service, slot, statusCodeStr).Inc()
	spanDurationMs.WithLabelValues(span.Service, slot).Observe(float64(span.DurationMs))

	isError := span.Error || span.StatusCode >= ts.cfg.ErrorStatusThreshold
	if isError {
		spanErrorsTotal.WithLabelValues(span.Service, slot).Inc()
	}

	tracker := ts.getSlotTracker(slot)
	tracker.record(isError, span.DurationMs)

	// Anomaly evaluation for this span
	isAnomaly := isError ||
		span.DurationMs >= ts.cfg.LatencyThresholdMs ||
		span.FallbackUsed

	// If canary error/anomaly, record trace ID for quick culprit diagnostics
	if slot == "canary" && isAnomaly {
		ts.recordCulprit(span.TraceID)
	}

	// 2. Priority Eviction Buffering
	ts.mu.Lock()
	defer ts.mu.Unlock()

	trace, exists := ts.traces[span.TraceID]
	now := time.Now()

	if !exists {
		// If capacity is reached, perform priority eviction
		if len(ts.traces) >= ts.cfg.MaxBufferedTraces {
			ts.evictOneLocked()
		}

		trace = &bufferedTrace{
			traceID:     span.TraceID,
			spans:       make([]*Span, 0, 4),
			hasAnomaly:  isAnomaly,
			firstSeen:   now,
			lastUpdated: now,
		}
		ts.traces[span.TraceID] = trace
	} else {
		if isAnomaly {
			trace.hasAnomaly = true
		}
		trace.lastUpdated = now
	}

	if len(trace.spans) < ts.cfg.MaxSpansPerTrace {
		trace.spans = append(trace.spans, span)
	}
}

// evictOneLocked removes one trace from the buffer, favoring non-anomaly traces.
func (ts *TailSampler) evictOneLocked() {
	var oldestNormalKey string
	var oldestNormalTime time.Time

	var oldestAnomalyKey string
	var oldestAnomalyTime time.Time

	for k, t := range ts.traces {
		if !t.hasAnomaly {
			if oldestNormalKey == "" || t.firstSeen.Before(oldestNormalTime) {
				oldestNormalKey = k
				oldestNormalTime = t.firstSeen
			}
		} else {
			if oldestAnomalyKey == "" || t.firstSeen.Before(oldestAnomalyTime) {
				oldestAnomalyKey = k
				oldestAnomalyTime = t.firstSeen
			}
		}
	}

	// Evict normal trace first; protect anomaly traces unless completely full of anomalies.
	if oldestNormalKey != "" {
		delete(ts.traces, oldestNormalKey)
		return
	}
	if oldestAnomalyKey != "" {
		delete(ts.traces, oldestAnomalyKey)
	}
}

// EvaluateTrace computes whether a trace should be preserved or dropped.
func (ts *TailSampler) EvaluateTrace(traceID string) SamplingDecision {
	ts.mu.RLock()
	trace, exists := ts.traces[traceID]
	ts.mu.RUnlock()

	if exists && trace.hasAnomaly {
		return DecisionKeepAnomaly
	}

	// Deterministic base sampling on traceID hash
	hash := xxhash.Sum64String(traceID)
	ratio := float64(hash%1000000) / 1000000.0
	if ratio < ts.cfg.BaseSampleRate {
		return DecisionKeepSampled
	}
	return DecisionDrop
}

// GetTrace retrieves all buffered spans for a given trace ID if sampled or anomalous.
func (ts *TailSampler) GetTrace(traceID string) ([]*Span, bool) {
	ts.mu.RLock()
	defer ts.mu.RUnlock()

	trace, exists := ts.traces[traceID]
	if !exists {
		return nil, false
	}

	decision := ts.EvaluateTrace(traceID)
	if decision == DecisionDrop {
		return nil, false
	}

	res := make([]*Span, len(trace.spans))
	copy(res, trace.spans)
	return res, true
}

func (ts *TailSampler) recordCulprit(traceID string) {
	ts.culpritMu.Lock()
	defer ts.culpritMu.Unlock()

	for _, id := range ts.canaryErrors {
		if id == traceID {
			return
		}
	}
	ts.canaryErrors = append(ts.canaryErrors, traceID)
	if len(ts.canaryErrors) > 256 {
		ts.canaryErrors = ts.canaryErrors[1:]
	}
}

// GetCulpritTraceIDs returns recent anomaly trace IDs for the canary slot.
func (ts *TailSampler) GetCulpritTraceIDs(slot string, limit int) []string {
	if slot != "canary" {
		return nil
	}

	ts.culpritMu.RLock()
	defer ts.culpritMu.RUnlock()

	if len(ts.canaryErrors) == 0 {
		return nil
	}

	n := len(ts.canaryErrors)
	if limit <= 0 || limit > n {
		limit = n
	}

	out := make([]string, limit)
	for i := 0; i < limit; i++ {
		out[i] = ts.canaryErrors[n-1-i]
	}
	return out
}

func (ts *TailSampler) getSlotTracker(slot string) *slotTracker {
	switch slot {
	case "stable":
		return ts.stableSlot
	case "canary":
		return ts.canarySlot
	default:
		ts.mu.Lock()
		defer ts.mu.Unlock()
		st, ok := ts.customSlots[slot]
		if !ok {
			st = newSlotTracker()
			ts.customSlots[slot] = st
		}
		return st
	}
}

// GetSlotMetrics returns aggregated RED metrics for the specified slot.
func (ts *TailSampler) GetSlotMetrics(slot string) SlotMetrics {
	return ts.getSlotTracker(slot).snapshot()
}

// ResetSlotMetrics resets request, error, and latency metrics for the slot.
func (ts *TailSampler) ResetSlotMetrics(slot string) {
	ts.getSlotTracker(slot).reset()
}
