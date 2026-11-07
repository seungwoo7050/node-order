package relay

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"
)

// Status represents the processing lifecycle status of an outbox event.
type Status string

const (
	StatusPending    Status = "pending"
	StatusProcessing Status = "processing"
	StatusDelivered  Status = "delivered"
	StatusDead       Status = "dead"
)

var (
	ErrEmptyID       = errors.New("event id cannot be empty")
	ErrEmptyTopic    = errors.New("event topic cannot be empty")
	ErrEmptyEndpoint = errors.New("event endpoint cannot be empty")
	ErrInvalidURL    = errors.New("event endpoint must be a valid http or https URL")
	ErrEmptyPayload  = errors.New("event payload cannot be empty")
	ErrInvalidStatus = errors.New("invalid event status")
)

// Event is the transactional outbox record.
type Event struct {
	ID            string            `json:"id"`
	Topic         string            `json:"topic"`
	Endpoint      string            `json:"endpoint"`
	Payload       json.RawMessage   `json:"payload"`
	Headers       map[string]string `json:"headers,omitempty"`
	Status        Status            `json:"status"`
	Attempts      int               `json:"attempts"`
	MaxAttempts   int               `json:"max_attempts"`
	NextAttemptAt time.Time         `json:"next_attempt_at"`
	LockedAt      *time.Time        `json:"locked_at,omitempty"`
	LockedBy      string            `json:"locked_by,omitempty"`
	LastError     string            `json:"last_error,omitempty"`
	CreatedAt     time.Time         `json:"created_at"`
	DeliveredAt   *time.Time        `json:"delivered_at,omitempty"`
}

// Validate checks whether the event has valid fields before persistence.
func (e *Event) Validate() error {
	if strings.TrimSpace(e.ID) == "" {
		return ErrEmptyID
	}
	if strings.TrimSpace(e.Topic) == "" {
		return ErrEmptyTopic
	}
	if strings.TrimSpace(e.Endpoint) == "" {
		return ErrEmptyEndpoint
	}
	parsed, err := url.ParseRequestURI(e.Endpoint)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return fmt.Errorf("%w: %s", ErrInvalidURL, e.Endpoint)
	}
	if len(e.Payload) == 0 {
		return ErrEmptyPayload
	}
	if !json.Valid(e.Payload) {
		return errors.New("event payload must be valid JSON")
	}
	if e.MaxAttempts <= 0 {
		e.MaxAttempts = 5
	}
	if e.Headers == nil {
		e.Headers = make(map[string]string)
	}
	if e.Status == "" {
		e.Status = StatusPending
	}
	if e.NextAttemptAt.IsZero() {
		e.NextAttemptAt = time.Now()
	}
	if e.CreatedAt.IsZero() {
		e.CreatedAt = time.Now()
	}
	return nil
}
