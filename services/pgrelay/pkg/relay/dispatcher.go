package relay

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"
)

const (
	// DefaultMaxResponseBytes bounds the response body read to avoid memory exhaustion.
	DefaultMaxResponseBytes = 64 * 1024 // 64 KB
	// DefaultHTTPTimeout is the default delivery request timeout.
	DefaultHTTPTimeout = 10 * time.Second

	HeaderEventID   = "X-PGRelay-Event-ID"
	HeaderTopic     = "X-PGRelay-Topic"
	HeaderTimestamp = "X-PGRelay-Timestamp"
	HeaderSignature = "X-PGRelay-Signature"
)

// Dispatcher delivers an outbox event to its target endpoint.
type Dispatcher interface {
	Dispatch(ctx context.Context, event *Event) error
}

// DeliveryError represents an HTTP or network delivery failure.
type DeliveryError struct {
	StatusCode int
	Body       string
	Retryable  bool
	Err        error
}

func (e *DeliveryError) Error() string {
	if e.Err != nil {
		return fmt.Sprintf("delivery network error (retryable=%t): %v", e.Retryable, e.Err)
	}
	return fmt.Sprintf("delivery http error %d (retryable=%t): %s", e.StatusCode, e.Retryable, e.Body)
}

func (e *DeliveryError) Unwrap() error {
	return e.Err
}

// IsRetryable returns true if the error qualifies for retry backoff.
func (e *DeliveryError) IsRetryable() bool {
	return e.Retryable
}

// CheckRetryable inspects an error to determine whether it is retryable.
func CheckRetryable(err error) bool {
	if err == nil {
		return false
	}
	var delErr *DeliveryError
	if errors.As(err, &delErr) {
		return delErr.IsRetryable()
	}
	// Unknown errors default to retryable for resilience
	return true
}

// HTTPDispatcher delivers outbox events over HTTP POST with optional HMAC signing.
type HTTPDispatcher struct {
	client           *http.Client
	signer           *Signer
	maxResponseBytes int64
}

// NewHTTPDispatcher creates a new HTTPDispatcher.
func NewHTTPDispatcher(client *http.Client, signer *Signer) *HTTPDispatcher {
	if client == nil {
		client = &http.Client{
			Timeout: DefaultHTTPTimeout,
		}
	}
	return &HTTPDispatcher{
		client:           client,
		signer:           signer,
		maxResponseBytes: DefaultMaxResponseBytes,
	}
}

// WithMaxResponseBytes sets the response read limit.
func (d *HTTPDispatcher) WithMaxResponseBytes(limit int64) *HTTPDispatcher {
	if limit > 0 {
		d.maxResponseBytes = limit
	}
	return d
}

// Dispatch executes a POST request delivering the event payload to its endpoint.
func (d *HTTPDispatcher) Dispatch(ctx context.Context, event *Event) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, event.Endpoint, bytes.NewReader(event.Payload))
	if err != nil {
		return &DeliveryError{
			Err:       err,
			Retryable: false, // Invalid request formation is non-retryable
		}
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(HeaderEventID, event.ID)
	req.Header.Set(HeaderTopic, event.Topic)

	now := time.Now().UTC()
	req.Header.Set(HeaderTimestamp, strconv.FormatInt(now.Unix(), 10))

	if d.signer != nil {
		sig := d.signer.Sign(now, event.Payload)
		req.Header.Set(HeaderSignature, sig)
	}

	for k, v := range event.Headers {
		req.Header.Set(k, v)
	}

	resp, err := d.client.Do(req)
	if err != nil {
		return &DeliveryError{
			Err:       err,
			Retryable: true,
		}
	}
	defer resp.Body.Close()

	bodyBytes, _ := io.ReadAll(io.LimitReader(resp.Body, d.maxResponseBytes))
	bodyStr := string(bodyBytes)

	// 2xx Success: Delivered
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return nil
	}

	// 429 Too Many Requests or 5xx Server Errors: Retryable with backoff
	if resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500 {
		return &DeliveryError{
			StatusCode: resp.StatusCode,
			Body:       bodyStr,
			Retryable:  true,
		}
	}

	// 4xx Client Errors (except 429): Non-retryable permanent failure
	return &DeliveryError{
		StatusCode: resp.StatusCode,
		Body:       bodyStr,
		Retryable:  false,
	}
}
