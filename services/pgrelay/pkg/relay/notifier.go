package relay

import (
	"context"
	"sync"
	"time"
)

// Notifier defines the interface for waking up workers when new events are available.
type Notifier interface {
	// Wait returns a channel that receives a signal when a new event may be ready.
	Wait(ctx context.Context) <-chan struct{}

	// Notify signals to waiting listeners that a new event is available.
	Notify(ctx context.Context) error

	// Close releases any resources held by the notifier.
	Close() error
}

// BroadcastNotifier provides an in-memory notification mechanism with a fallback ticker.
type BroadcastNotifier struct {
	mu       sync.Mutex
	ch       chan struct{}
	interval time.Duration
	closed   bool
}

// NewBroadcastNotifier creates an in-memory notifier with a fallback polling interval.
func NewBroadcastNotifier(fallbackInterval time.Duration) *BroadcastNotifier {
	if fallbackInterval <= 0 {
		fallbackInterval = 500 * time.Millisecond
	}
	return &BroadcastNotifier{
		ch:       make(chan struct{}, 1),
		interval: fallbackInterval,
	}
}

// Notify triggers an immediate wakeup for listeners.
func (n *BroadcastNotifier) Notify(ctx context.Context) error {
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.closed {
		return nil
	}

	select {
	case n.ch <- struct{}{}:
	default:
		// Notification already pending; avoid blocking
	}
	return nil
}

// Wait returns a channel that signals upon either an explicit Notify call,
// the fallback ticker duration, or context cancellation.
func (n *BroadcastNotifier) Wait(ctx context.Context) <-chan struct{} {
	out := make(chan struct{}, 1)

	go func() {
		ticker := time.NewTicker(n.interval)
		defer ticker.Stop()

		select {
		case <-ctx.Done():
			return
		case <-n.ch:
			select {
			case out <- struct{}{}:
			default:
			}
		case <-ticker.C:
			select {
			case out <- struct{}{}:
			default:
			}
		}
	}()

	return out
}

// Close closes the notifier.
func (n *BroadcastNotifier) Close() error {
	n.mu.Lock()
	defer n.mu.Unlock()
	if !n.closed {
		n.closed = true
		close(n.ch)
	}
	return nil
}

// PGNotifierSQL generates PostgreSQL LISTEN / NOTIFY SQL statements.
const (
	// DefaultChannelName is the PostgreSQL NOTIFY channel for outbox events.
	DefaultChannelName = "pgrelay_outbox_events"
)

// NotifySQL returns the PostgreSQL NOTIFY command.
func NotifySQL(channel string) string {
	if channel == "" {
		channel = DefaultChannelName
	}
	return "NOTIFY " + channel
}

// ListenSQL returns the PostgreSQL LISTEN command.
func ListenSQL(channel string) string {
	if channel == "" {
		channel = DefaultChannelName
	}
	return "LISTEN " + channel
}
