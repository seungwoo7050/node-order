package idem

import (
	"bytes"
	"net/http"
	"strings"
)

// DefaultMaxCaptureBytes limits response body buffering to 1MB.
const DefaultMaxCaptureBytes = 1024 * 1024

// ResponseRecorder wraps http.ResponseWriter to intercept and capture
// status code, response headers, and response body up to MaxCaptureBytes.
// It implements http.Flusher and Go 1.20+ Unwrap.
type ResponseRecorder struct {
	underlying      http.ResponseWriter
	statusCode      int
	writtenHeader   bool
	body            bytes.Buffer
	maxCaptureBytes int
	overflow        bool
}

// NewResponseRecorder wraps w and limits captured body bytes to maxCaptureBytes.
func NewResponseRecorder(w http.ResponseWriter, maxCaptureBytes int) *ResponseRecorder {
	if maxCaptureBytes <= 0 {
		maxCaptureBytes = DefaultMaxCaptureBytes
	}
	return &ResponseRecorder{
		underlying:      w,
		statusCode:      http.StatusOK,
		maxCaptureBytes: maxCaptureBytes,
	}
}

// Header returns the header map from the underlying ResponseWriter.
func (r *ResponseRecorder) Header() http.Header {
	return r.underlying.Header()
}

// WriteHeader records the status code and forwards it to the underlying ResponseWriter.
func (r *ResponseRecorder) WriteHeader(code int) {
	if !r.writtenHeader {
		r.statusCode = code
		r.writtenHeader = true
		r.underlying.WriteHeader(code)
	}
}

// Write captures data in memory (up to maxCaptureBytes) and forwards bytes to underlying writer.
func (r *ResponseRecorder) Write(p []byte) (int, error) {
	if !r.writtenHeader {
		r.WriteHeader(http.StatusOK)
	}

	if !r.overflow {
		remaining := r.maxCaptureBytes - r.body.Len()
		if remaining >= len(p) {
			r.body.Write(p)
		} else {
			if remaining > 0 {
				r.body.Write(p[:remaining])
			}
			r.overflow = true
		}
	}

	return r.underlying.Write(p)
}

// Flush forwards flush requests to the underlying writer if it implements http.Flusher.
func (r *ResponseRecorder) Flush() {
	if flusher, ok := r.underlying.(http.Flusher); ok {
		flusher.Flush()
	}
}

// Unwrap returns the underlying ResponseWriter.
func (r *ResponseRecorder) Unwrap() http.ResponseWriter {
	return r.underlying
}

// StatusCode returns the captured HTTP status code.
func (r *ResponseRecorder) StatusCode() int {
	return r.statusCode
}

// CapturedBody returns a copy of the captured response body bytes.
func (r *ResponseRecorder) CapturedBody() []byte {
	return r.body.Bytes()
}

// IsOverflow reports whether the response body exceeded MaxCaptureBytes.
func (r *ResponseRecorder) IsOverflow() bool {
	return r.overflow
}

// CapturedHeaders extracts single-value headers suitable for idempotency persistence,
// filtering out hop-by-hop transport headers.
func (r *ResponseRecorder) CapturedHeaders() map[string]string {
	h := r.underlying.Header()
	out := make(map[string]string, len(h))
	for k, vals := range h {
		lower := strings.ToLower(k)
		if lower == "connection" || lower == "transfer-encoding" || lower == "trailer" || lower == "upgrade" {
			continue
		}
		if len(vals) > 0 {
			out[k] = strings.Join(vals, ", ")
		}
	}
	return out
}
