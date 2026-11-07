package gate

import (
	"bytes"
	"errors"
	"io"
	"net/http"
	"strings"
)

// IsSSERequest checks if an incoming HTTP request requests Server-Sent Events streaming,
// either via the Accept header or JSON body containing `"stream": true`.
func IsSSERequest(req *http.Request, body []byte) bool {
	accept := req.Header.Get("Accept")
	if strings.Contains(strings.ToLower(accept), "text/event-stream") {
		return true
	}
	if len(body) > 0 {
		lowerBody := bytes.ToLower(body)
		if bytes.Contains(lowerBody, []byte(`"stream":true`)) || bytes.Contains(lowerBody, []byte(`"stream": true`)) {
			return true
		}
	}
	return false
}

// IsSSEResponse checks if an upstream HTTP response is a Server-Sent Events stream.
func IsSSEResponse(resp *http.Response) bool {
	if resp == nil {
		return false
	}
	contentType := resp.Header.Get("Content-Type")
	return strings.Contains(strings.ToLower(contentType), "text/event-stream")
}

// ProxyStream streams Server-Sent Events from the upstream response to the downstream ResponseWriter
// with immediate chunk flushing via http.Flusher to minimize Time-To-First-Token (TTFT).
func ProxyStream(w http.ResponseWriter, resp *http.Response) error {
	defer resp.Body.Close()

	// Copy upstream response headers
	for k, vv := range resp.Header {
		for _, v := range vv {
			w.Header().Add(k, v)
		}
	}

	// Ensure essential streaming headers are present
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	w.WriteHeader(resp.StatusCode)

	flusher, hasFlusher := w.(http.Flusher)
	if hasFlusher {
		flusher.Flush()
	}

	buf := make([]byte, 4096)
	for {
		n, err := resp.Body.Read(buf)
		if n > 0 {
			if _, writeErr := w.Write(buf[:n]); writeErr != nil {
				return writeErr
			}
			if hasFlusher {
				flusher.Flush()
			}
		}
		if err != nil {
			if errors.Is(err, io.EOF) {
				return nil
			}
			return err
		}
	}
}
