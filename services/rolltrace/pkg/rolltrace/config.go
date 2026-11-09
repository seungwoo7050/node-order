package rolltrace

import (
	"errors"
	"fmt"
	"time"
)

var (
	ErrInvalidSampleRate    = errors.New("base sample rate must be between 0.0 and 1.0")
	ErrInvalidThreshold     = errors.New("thresholds must be positive values")
	ErrInvalidBufferSize    = errors.New("max buffered traces and spans must be greater than zero")
	ErrInvalidCanarySteps   = errors.New("canary steps must be non-empty and monotonically increasing between 1 and 100")
	ErrInvalidTTL           = errors.New("lease default TTL must be positive")
	ErrInvalidBreachConfig  = errors.New("consecutive breaches and min sample count must be positive")
)

// TailSampleConfig defines rules for tail-based sampling and trace buffering.
type TailSampleConfig struct {
	LatencyThresholdMs   int64         `json:"latency_threshold_ms"`
	ErrorStatusThreshold int           `json:"error_status_threshold"`
	BaseSampleRate       float64       `json:"base_sample_rate"`
	MaxBufferedTraces    int           `json:"max_buffered_traces"`
	MaxSpansPerTrace     int           `json:"max_spans_per_trace"`
	DecisionWait         time.Duration `json:"decision_wait"`
}

// CanaryConfig defines SLO burn rate thresholds and step progression.
type CanaryConfig struct {
	Steps               []int   `json:"steps"`
	MaxErrorRate        float64 `json:"max_error_rate"`
	MaxP99LatencyMs     float64 `json:"max_p99_latency_ms"`
	MinSampleCount      int     `json:"min_sample_count"`
	ConsecutiveBreaches int     `json:"consecutive_breaches"`
}

// LeaseConfig controls the atomic deployment lock duration.
type LeaseConfig struct {
	DefaultTTL time.Duration `json:"default_ttl"`
}

// Config bundles all subsystem configurations.
type Config struct {
	Service     string           `json:"service"`
	HTTPAddr    string           `json:"http_addr"`
	TailSampler TailSampleConfig `json:"tail_sampler"`
	Canary      CanaryConfig     `json:"canary"`
	Lease       LeaseConfig      `json:"lease"`
}

// DefaultTailSampleConfig returns sensible defaults for tail sampling.
func DefaultTailSampleConfig() TailSampleConfig {
	return TailSampleConfig{
		LatencyThresholdMs:   500,
		ErrorStatusThreshold: 500,
		BaseSampleRate:       0.05,
		MaxBufferedTraces:    2048,
		MaxSpansPerTrace:     128,
		DecisionWait:         2 * time.Second,
	}
}

// DefaultCanaryConfig returns default thresholds for canary health evaluation.
func DefaultCanaryConfig() CanaryConfig {
	return CanaryConfig{
		Steps:               []int{10, 50, 100},
		MaxErrorRate:        0.02,
		MaxP99LatencyMs:     800.0,
		MinSampleCount:      20,
		ConsecutiveBreaches: 2,
	}
}

// DefaultLeaseConfig returns the default lease duration.
func DefaultLeaseConfig() LeaseConfig {
	return LeaseConfig{
		DefaultTTL: 5 * time.Minute,
	}
}

// DefaultConfig aggregates default settings across all components.
func DefaultConfig() Config {
	return Config{
		Service:     "rolltrace",
		HTTPAddr:    ":8080",
		TailSampler: DefaultTailSampleConfig(),
		Canary:      DefaultCanaryConfig(),
		Lease:       DefaultLeaseConfig(),
	}
}

// Validate validates configuration sanity across all subsystems.
func (c *Config) Validate() error {
	if c.TailSampler.BaseSampleRate < 0.0 || c.TailSampler.BaseSampleRate > 1.0 {
		return ErrInvalidSampleRate
	}
	if c.TailSampler.LatencyThresholdMs <= 0 || c.TailSampler.ErrorStatusThreshold <= 0 {
		return ErrInvalidThreshold
	}
	if c.TailSampler.MaxBufferedTraces <= 0 || c.TailSampler.MaxSpansPerTrace <= 0 {
		return ErrInvalidBufferSize
	}
	if len(c.Canary.Steps) == 0 {
		return ErrInvalidCanarySteps
	}
	prev := 0
	for _, step := range c.Canary.Steps {
		if step <= prev || step > 100 {
			return fmt.Errorf("%w: invalid step %d", ErrInvalidCanarySteps, step)
		}
		prev = step
	}
	if c.Canary.MinSampleCount <= 0 || c.Canary.ConsecutiveBreaches <= 0 {
		return ErrInvalidBreachConfig
	}
	if c.Canary.MaxErrorRate < 0.0 || c.Canary.MaxP99LatencyMs <= 0.0 {
		return ErrInvalidThreshold
	}
	if c.Lease.DefaultTTL <= 0 {
		return ErrInvalidTTL
	}
	return nil
}
