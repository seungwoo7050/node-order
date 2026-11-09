package rolltrace

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
)

var (
	ErrMalformedTraceParent = errors.New("malformed traceparent header")
	ErrUnsupportedVersion   = errors.New("unsupported traceparent version")
	ErrInvalidTraceID       = errors.New("invalid or all-zero trace id")
	ErrInvalidSpanID        = errors.New("invalid or all-zero span id")
	ErrInvalidFlags         = errors.New("invalid trace flags")
)

const (
	allZeroTraceID = "00000000000000000000000000000000"
	allZeroSpanID  = "0000000000000000"
)

type traceContextKey struct{}

// TraceContext models the W3C Trace Context representation.
type TraceContext struct {
	TraceID string `json:"trace_id"`
	SpanID  string `json:"span_id"`
	Sampled bool   `json:"sampled"`
	Raw     string `json:"raw"`
}

// Span holds a single distributed trace span for sampling and analytics.
type Span struct {
	TraceID      string            `json:"trace_id"`
	SpanID       string            `json:"span_id"`
	ParentSpanID string            `json:"parent_span_id,omitempty"`
	Service      string            `json:"service"`
	Operation    string            `json:"operation"`
	StatusCode   int               `json:"status_code"`
	DurationMs   int64             `json:"duration_ms"`
	Error        bool              `json:"error"`
	FallbackUsed bool              `json:"fallback_used"`
	Slot         string            `json:"slot"` // "stable" or "canary"
	Attributes   map[string]string `json:"attributes,omitempty"`
	Timestamp    time.Time         `json:"timestamp"`
}

// SpanIngester accepts spans for tail-based buffering and metric accounting.
type SpanIngester interface {
	IngestSpan(span *Span)
}

// ParseTraceParent parses a W3C traceparent string (00-<32hex>-<16hex>-<2hex>).
func ParseTraceParent(raw string) (TraceContext, error) {
	trimmed := strings.TrimSpace(raw)
	parts := strings.Split(trimmed, "-")
	if len(parts) != 4 {
		return TraceContext{}, ErrMalformedTraceParent
	}

	version := parts[0]
	traceID := strings.ToLower(parts[1])
	spanID := strings.ToLower(parts[2])
	flags := parts[3]

	if len(version) != 2 || len(traceID) != 32 || len(spanID) != 16 || len(flags) != 2 {
		return TraceContext{}, ErrMalformedTraceParent
	}
	if version != "00" {
		return TraceContext{}, ErrUnsupportedVersion
	}
	if traceID == allZeroTraceID {
		return TraceContext{}, ErrInvalidTraceID
	}
	if spanID == allZeroSpanID {
		return TraceContext{}, ErrInvalidSpanID
	}

	if _, err := hex.DecodeString(traceID); err != nil {
		return TraceContext{}, fmt.Errorf("%w: invalid hex trace id", ErrInvalidTraceID)
	}
	if _, err := hex.DecodeString(spanID); err != nil {
		return TraceContext{}, fmt.Errorf("%w: invalid hex span id", ErrInvalidSpanID)
	}
	flagBytes, err := hex.DecodeString(flags)
	if err != nil {
		return TraceContext{}, fmt.Errorf("%w: invalid hex flags", ErrInvalidFlags)
	}

	sampled := (flagBytes[0] & 0x01) == 0x01

	return TraceContext{
		TraceID: traceID,
		SpanID:  spanID,
		Sampled: sampled,
		Raw:     trimmed,
	}, nil
}

// NewTraceParent generates a fresh W3C TraceContext with cryptographically random IDs.
func NewTraceParent(sampled bool) TraceContext {
	var traceBytes [16]byte
	var spanBytes [8]byte

	for {
		if _, err := rand.Read(traceBytes[:]); err == nil {
			hexStr := hex.EncodeToString(traceBytes[:])
			if hexStr != allZeroTraceID {
				break
			}
		}
	}

	for {
		if _, err := rand.Read(spanBytes[:]); err == nil {
			hexStr := hex.EncodeToString(spanBytes[:])
			if hexStr != allZeroSpanID {
				break
			}
		}
	}

	tc := TraceContext{
		TraceID: hex.EncodeToString(traceBytes[:]),
		SpanID:  hex.EncodeToString(spanBytes[:]),
		Sampled: sampled,
	}
	tc.Raw = tc.String()
	return tc
}

// String serializes the TraceContext into standard W3C traceparent format.
func (tc TraceContext) String() string {
	flag := "00"
	if tc.Sampled {
		flag = "01"
	}
	return fmt.Sprintf("00-%s-%s-%s", tc.TraceID, tc.SpanID, flag)
}

// ChildSpan creates a downstream child context with a newly allocated span ID.
func (tc TraceContext) ChildSpan() TraceContext {
	var spanBytes [8]byte
	for {
		if _, err := rand.Read(spanBytes[:]); err == nil {
			hexStr := hex.EncodeToString(spanBytes[:])
			if hexStr != allZeroSpanID {
				break
			}
		}
	}
	child := TraceContext{
		TraceID: tc.TraceID,
		SpanID:  hex.EncodeToString(spanBytes[:]),
		Sampled: tc.Sampled,
	}
	child.Raw = child.String()
	return child
}

// ContextWithTrace injects the TraceContext into context.Context.
func ContextWithTrace(ctx context.Context, tc TraceContext) context.Context {
	return context.WithValue(ctx, traceContextKey{}, tc)
}

// TraceFromContext extracts the TraceContext from context.Context if present.
func TraceFromContext(ctx context.Context) (TraceContext, bool) {
	tc, ok := ctx.Value(traceContextKey{}).(TraceContext)
	return tc, ok
}

type statusCapturingResponseWriter struct {
	http.ResponseWriter
	statusCode int
	written    int64
}

func (w *statusCapturingResponseWriter) WriteHeader(code int) {
	w.statusCode = code
	w.ResponseWriter.WriteHeader(code)
}

func (w *statusCapturingResponseWriter) Write(b []byte) (int, error) {
	if w.statusCode == 0 {
		w.statusCode = http.StatusOK
	}
	n, err := w.ResponseWriter.Write(b)
	w.written += int64(n)
	return n, err
}

// PropagateMiddleware extracts or generates trace context, propagates W3C headers, and ingests spans.
func PropagateMiddleware(serviceName string, slot string, sampler SpanIngester, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		var (
			childTC      TraceContext
			parentSpanID string
		)

		incomingHeader := r.Header.Get("traceparent")
		if incomingHeader != "" {
			if parentTC, err := ParseTraceParent(incomingHeader); err == nil {
				parentSpanID = parentTC.SpanID
				childTC = parentTC.ChildSpan()
			} else {
				childTC = NewTraceParent(false)
			}
		} else {
			childTC = NewTraceParent(false)
		}

		w.Header().Set("traceparent", childTC.String())
		w.Header().Set("X-Trace-ID", childTC.TraceID)

		ctx := ContextWithTrace(r.Context(), childTC)
		wrapped := &statusCapturingResponseWriter{
			ResponseWriter: w,
			statusCode:     http.StatusOK,
		}

		next.ServeHTTP(wrapped, r.WithContext(ctx))

		durationMs := time.Since(start).Milliseconds()
		if durationMs < 0 {
			durationMs = 0
		}

		span := &Span{
			TraceID:      childTC.TraceID,
			SpanID:       childTC.SpanID,
			ParentSpanID: parentSpanID,
			Service:      serviceName,
			Operation:    r.Method + " " + r.URL.Path,
			StatusCode:   wrapped.statusCode,
			DurationMs:   durationMs,
			Error:        wrapped.statusCode >= 500,
			FallbackUsed: r.Header.Get("X-Fallback") == "true",
			Slot:         slot,
			Attributes: map[string]string{
				"http.method": r.Method,
				"http.path":   r.URL.Path,
			},
			Timestamp: start,
		}

		if sampler != nil {
			sampler.IngestSpan(span)
		}
	})
}
