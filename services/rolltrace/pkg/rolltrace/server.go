package rolltrace

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/tidwall/gjson"
)

// Server encapsulates the HTTP management API, ingestion pipeline, and canary controllers.
type Server struct {
	cfg        Config
	sampler    *TailSampler
	leaseMgr   *LeaseManager
	canaryCtrl *CanaryController
	mux        *http.ServeMux
	startTime  time.Time
}

// NewServer wires up dependencies and registers HTTP routes.
func NewServer(cfg Config, sampler *TailSampler, lm *LeaseManager, canary *CanaryController) *Server {
	s := &Server{
		cfg:        cfg,
		sampler:    sampler,
		leaseMgr:   lm,
		canaryCtrl: canary,
		mux:        http.NewServeMux(),
		startTime:  time.Now(),
	}
	s.routes()
	return s
}

// Handler returns the underlying http.Handler.
func (s *Server) Handler() http.Handler {
	return s.mux
}

func (s *Server) routes() {
	s.mux.HandleFunc("/v1/traces", s.handleTraces)
	s.mux.HandleFunc("/v1/traces/", s.handleTraceByID)
	s.mux.HandleFunc("/v1/rollouts/start", s.handleRolloutStart)
	s.mux.HandleFunc("/v1/rollouts/evaluate", s.handleRolloutEvaluate)
	s.mux.HandleFunc("/v1/argo/analysis", s.handleArgoAnalysis)
	s.mux.HandleFunc("/healthz", s.handleHealthz)
	s.mux.Handle("/metrics", promhttp.Handler())
}

func (s *Server) handleHealthz(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	uptime := int64(time.Since(s.startTime).Seconds())
	resp := map[string]interface{}{
		"status":     "ok",
		"service":    s.cfg.Service,
		"uptime_sec": uptime,
	}
	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) handleTraces(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "failed to read body", http.StatusBadRequest)
		return
	}
	defer r.Body.Close()

	if len(body) == 0 {
		http.Error(w, "empty payload", http.StatusBadRequest)
		return
	}

	spans := s.parseSpans(body)
	if len(spans) == 0 {
		http.Error(w, "no valid spans parsed", http.StatusBadRequest)
		return
	}

	for _, span := range spans {
		s.sampler.IngestSpan(span)
	}

	writeJSON(w, http.StatusAccepted, map[string]interface{}{
		"status":   "accepted",
		"ingested": len(spans),
	})
}

func (s *Server) parseSpans(body []byte) []*Span {
	var spans []*Span

	// 1. Check for standard OTLP JSON (resourceSpans)
	resourceSpans := gjson.GetBytes(body, "resourceSpans")
	if resourceSpans.Exists() && resourceSpans.IsArray() {
		resourceSpans.ForEach(func(_, resVal gjson.Result) bool {
			serviceName := resVal.Get("resource.attributes.#(key==\"service.name\").value.stringValue").String()
			if serviceName == "" {
				serviceName = s.cfg.Service
			}
			slot := resVal.Get("resource.attributes.#(key==\"deployment.slot\").value.stringValue").String()
			if slot == "" {
				slot = "stable"
			}

			scopeSpans := resVal.Get("scopeSpans")
			scopeSpans.ForEach(func(_, scopeVal gjson.Result) bool {
				scopeVal.Get("spans").ForEach(func(_, spanVal gjson.Result) bool {
					traceID := spanVal.Get("traceId").String()
					spanID := spanVal.Get("spanId").String()
					parentSpanID := spanVal.Get("parentSpanId").String()
					name := spanVal.Get("name").String()
					statusCode := int(spanVal.Get("status.code").Int())
					startNano := spanVal.Get("startTimeUnixNano").Int()
					endNano := spanVal.Get("endTimeUnixNano").Int()
					var durationMs int64
					if endNano > startNano {
						durationMs = (endNano - startNano) / 1000000
					}

					fallbackUsed := spanVal.Get("attributes.#(key==\"fallback\").value.boolValue").Bool()
					isErr := statusCode == 2 || spanVal.Get("status.code").String() == "STATUS_CODE_ERROR"

					span := &Span{
						TraceID:      traceID,
						SpanID:       spanID,
						ParentSpanID: parentSpanID,
						Service:      serviceName,
						Operation:    name,
						StatusCode:   statusCode,
						DurationMs:   durationMs,
						Error:        isErr,
						FallbackUsed: fallbackUsed,
						Slot:         slot,
						Timestamp:    time.Now(),
					}
					spans = append(spans, span)
					return true
				})
				return true
			})
			return true
		})
		return spans
	}

	// 2. Custom or flat JSON payload (array or single object)
	parsed := gjson.ParseBytes(body)
	if parsed.IsArray() {
		parsed.ForEach(func(_, item gjson.Result) bool {
			if span := parseSingleSpan(item, s.cfg.Service); span != nil {
				spans = append(spans, span)
			}
			return true
		})
	} else if parsed.IsObject() {
		if span := parseSingleSpan(parsed, s.cfg.Service); span != nil {
			spans = append(spans, span)
		}
	}

	return spans
}

func parseSingleSpan(r gjson.Result, defaultService string) *Span {
	traceID := r.Get("trace_id").String()
	if traceID == "" {
		traceID = r.Get("traceId").String()
	}
	if traceID == "" {
		return nil
	}

	spanID := r.Get("span_id").String()
	if spanID == "" {
		spanID = r.Get("spanId").String()
	}

	parentSpanID := r.Get("parent_span_id").String()
	if parentSpanID == "" {
		parentSpanID = r.Get("parentSpanId").String()
	}

	service := r.Get("service").String()
	if service == "" {
		service = defaultService
	}

	operation := r.Get("operation").String()
	if operation == "" {
		operation = r.Get("name").String()
	}

	statusCode := int(r.Get("status_code").Int())
	if statusCode == 0 {
		statusCode = int(r.Get("statusCode").Int())
	}
	if statusCode == 0 {
		statusCode = http.StatusOK
	}

	durationMs := r.Get("duration_ms").Int()
	if durationMs == 0 {
		durationMs = r.Get("durationMs").Int()
	}

	slot := r.Get("slot").String()
	if slot == "" {
		slot = "stable"
	}

	return &Span{
		TraceID:      traceID,
		SpanID:       spanID,
		ParentSpanID: parentSpanID,
		Service:      service,
		Operation:    operation,
		StatusCode:   statusCode,
		DurationMs:   durationMs,
		Error:        r.Get("error").Bool() || statusCode >= 500,
		FallbackUsed: r.Get("fallback_used").Bool() || r.Get("fallbackUsed").Bool(),
		Slot:         slot,
		Timestamp:    time.Now(),
	}
}

func (s *Server) handleTraceByID(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	traceID := strings.TrimPrefix(r.URL.Path, "/v1/traces/")
	traceID = strings.TrimSpace(traceID)
	if traceID == "" {
		http.Error(w, "missing trace id", http.StatusBadRequest)
		return
	}

	spans, found := s.sampler.GetTrace(traceID)
	if !found {
		writeJSON(w, http.StatusNotFound, map[string]interface{}{
			"error":    "trace not found or dropped by tail-sampling",
			"trace_id": traceID,
		})
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"trace_id": traceID,
		"spans":    spans,
		"count":    len(spans),
	})
}

type startRolloutRequest struct {
	Service  string `json:"service"`
	Version  string `json:"version"`
	HolderID string `json:"holder_id"`
}

func (s *Server) handleRolloutStart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req startRolloutRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request json", http.StatusBadRequest)
		return
	}

	if req.Service == "" {
		req.Service = s.cfg.Service
	}

	state, err := s.canaryCtrl.StartRollout(req.Service, req.Version, req.HolderID)
	if err != nil {
		if errors.Is(err, ErrLeaseHeld) || errors.Is(err, ErrRolloutInProgress) {
			writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
			return
		}
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	writeJSON(w, http.StatusOK, state)
}

type evaluateRolloutRequest struct {
	Service string `json:"service"`
}

func (s *Server) handleRolloutEvaluate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req evaluateRolloutRequest
	if r.Body != nil {
		_ = json.NewDecoder(r.Body).Decode(&req)
	}
	if req.Service == "" {
		req.Service = r.URL.Query().Get("service")
	}
	if req.Service == "" {
		req.Service = s.cfg.Service
	}

	metrics := s.sampler.GetSlotMetrics("canary")
	result, err := s.canaryCtrl.EvaluateCanary(req.Service, metrics)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	writeJSON(w, http.StatusOK, result)
}

// handleArgoAnalysis processes Argo Rollouts Webhook Analysis metric queries.
func (s *Server) handleArgoAnalysis(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req evaluateRolloutRequest
	if r.Body != nil {
		_ = json.NewDecoder(r.Body).Decode(&req)
	}
	if req.Service == "" {
		req.Service = r.URL.Query().Get("service")
	}
	if req.Service == "" {
		req.Service = s.cfg.Service
	}

	metrics := s.sampler.GetSlotMetrics("canary")
	result, err := s.canaryCtrl.EvaluateCanary(req.Service, metrics)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{
			"phase":   "Error",
			"message": err.Error(),
		})
		return
	}

	switch result.Action {
	case ActionRollback:
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"phase":             "Failed",
			"message":           "SLO breach threshold reached; triggered automated rollback",
			"culprit_trace_ids": result.CulpritTraceIDs,
			"error_rate":        result.ErrorRate,
			"p99_latency_ms":    result.P99LatencyMs,
		})
	case ActionComplete:
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"phase":   "Successful",
			"message": "Canary progression reached 100% stable promotion",
		})
	default:
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"phase":        "Running",
			"action":       result.Action,
			"reason":       result.Reason,
			"weight":       result.NextWeight,
			"error_rate":   result.ErrorRate,
			"p99_latency":  result.P99LatencyMs,
			"total_sample": result.TotalSamples,
		})
	}
}

func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}
