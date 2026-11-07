package relay

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"sync"
	"sync/atomic"
	"time"
)

// EngineMetrics tracks runtime operational statistics atomically.
type EngineMetrics struct {
	EnqueuedTotal  uint64
	DeliveredTotal uint64
	RetriedTotal   uint64
	DeadTotal      uint64
	ReclaimedTotal uint64
}

// EngineConfig configures the transactional outbox processing engine.
type EngineConfig struct {
	Store         Store
	Dispatcher    Dispatcher
	Notifier      Notifier
	WorkerCount   int
	BatchSize     int
	PollInterval  time.Duration
	LeaseTimeout  time.Duration
	ReapInterval  time.Duration
	Backoff       BackoffPolicy
	WorkerID      string
}

// Engine orchestrates batch claiming, worker dispatching, stale lock reclaiming,
// and runtime metrics reporting.
type Engine struct {
	config  EngineConfig
	metrics EngineMetrics

	ctx       context.Context
	cancel    context.CancelFunc
	jobs      chan *Event
	wg        sync.WaitGroup
	running   atomic.Bool
	stopOnce  sync.Once
}

// NewEngine creates a new outbox delivery engine.
func NewEngine(cfg EngineConfig) (*Engine, error) {
	if cfg.Store == nil {
		return nil, errors.New("engine: store is required")
	}
	if cfg.Dispatcher == nil {
		return nil, errors.New("engine: dispatcher is required")
	}
	if cfg.WorkerCount <= 0 {
		cfg.WorkerCount = 4
	}
	if cfg.BatchSize <= 0 {
		cfg.BatchSize = 16
	}
	if cfg.PollInterval <= 0 {
		cfg.PollInterval = 500 * time.Millisecond
	}
	if cfg.LeaseTimeout <= 0 {
		cfg.LeaseTimeout = 30 * time.Second
	}
	if cfg.ReapInterval <= 0 {
		cfg.ReapInterval = 10 * time.Second
	}
	if cfg.Notifier == nil {
		cfg.Notifier = NewBroadcastNotifier(cfg.PollInterval)
	}
	if cfg.WorkerID == "" {
		hostname, _ := os.Hostname()
		cfg.WorkerID = fmt.Sprintf("%s-%d", hostname, os.Getpid())
	}
	if cfg.Backoff.BaseDelay == 0 && cfg.Backoff.MaxDelay == 0 {
		cfg.Backoff = DefaultBackoffPolicy()
	}

	return &Engine{
		config: cfg,
		jobs:   make(chan *Event, cfg.BatchSize*2),
	}, nil
}

// Metrics returns a snapshot of current engine metrics.
func (e *Engine) Metrics() EngineMetrics {
	return EngineMetrics{
		EnqueuedTotal:  atomic.LoadUint64(&e.metrics.EnqueuedTotal),
		DeliveredTotal: atomic.LoadUint64(&e.metrics.DeliveredTotal),
		RetriedTotal:   atomic.LoadUint64(&e.metrics.RetriedTotal),
		DeadTotal:      atomic.LoadUint64(&e.metrics.DeadTotal),
		ReclaimedTotal: atomic.LoadUint64(&e.metrics.ReclaimedTotal),
	}
}

// Enqueue inserts an event into the store and alerts waiting workers.
func (e *Engine) Enqueue(ctx context.Context, event *Event) error {
	if err := e.config.Store.Enqueue(ctx, event); err != nil {
		return err
	}
	atomic.AddUint64(&e.metrics.EnqueuedTotal, 1)
	if e.config.Notifier != nil {
		_ = e.config.Notifier.Notify(ctx)
	}
	return nil
}

// EnqueueTx inserts an event within a caller transaction and alerts workers on success.
func (e *Engine) EnqueueTx(ctx context.Context, tx DBTx, event *Event) error {
	if err := e.config.Store.EnqueueTx(ctx, tx, event); err != nil {
		return err
	}
	atomic.AddUint64(&e.metrics.EnqueuedTotal, 1)
	if e.config.Notifier != nil {
		_ = e.config.Notifier.Notify(ctx)
	}
	return nil
}

// Start launches the engine background worker pool, polling loop, and stale reaper.
func (e *Engine) Start(parentCtx context.Context) error {
	if !e.running.CompareAndSwap(false, true) {
		return errors.New("engine: already running")
	}

	e.ctx, e.cancel = context.WithCancel(parentCtx)

	// Launch worker pool
	for i := 0; i < e.config.WorkerCount; i++ {
		e.wg.Add(1)
		go e.worker(i)
	}

	// Launch stale lock reaper loop
	e.wg.Add(1)
	go e.runReaper()

	// Launch event poller loop
	e.wg.Add(1)
	go e.pollLoop()

	return nil
}

// Stop gracefully shuts down the engine, waiting for in-flight deliveries to complete.
func (e *Engine) Stop() error {
	var err error
	e.stopOnce.Do(func() {
		if !e.running.Load() {
			return
		}
		if e.cancel != nil {
			e.cancel()
		}
		e.wg.Wait()
		close(e.jobs)
		if e.config.Notifier != nil {
			_ = e.config.Notifier.Close()
		}
		e.running.Store(false)
	})
	return err
}

// pollLoop continuously claims pending batches and queues them to workers.
func (e *Engine) pollLoop() {
	defer e.wg.Done()

	for {
		select {
		case <-e.ctx.Done():
			return
		default:
		}

		events, err := e.config.Store.ClaimBatch(e.ctx, e.config.WorkerID, e.config.BatchSize)
		if err != nil {
			if errors.Is(err, context.Canceled) {
				return
			}
			// Transient store error, wait briefly before retrying
			select {
			case <-e.ctx.Done():
				return
			case <-time.After(100 * time.Millisecond):
			}
			continue
		}

		if len(events) == 0 {
			// No events claimed; wait for wakeup signal or poll interval
			select {
			case <-e.ctx.Done():
				return
			case <-e.config.Notifier.Wait(e.ctx):
			}
			continue
		}

		for _, ev := range events {
			select {
			case <-e.ctx.Done():
				return
			case e.jobs <- ev:
			}
		}

		// If a full batch was claimed, immediately query again without waiting
		if len(events) < e.config.BatchSize {
			select {
			case <-e.ctx.Done():
				return
			case <-e.config.Notifier.Wait(e.ctx):
			}
		}
	}
}

// worker consumes events from the job channel and executes delivery.
func (e *Engine) worker(id int) {
	defer e.wg.Done()

	for {
		select {
		case <-e.ctx.Done():
			return
		case ev, ok := <-e.jobs:
			if !ok {
				return
			}
			e.processEvent(ev)
		}
	}
}

// processEvent dispatches a single event and updates the store and metrics accordingly.
func (e *Engine) processEvent(ev *Event) {
	deliveryCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	err := e.config.Dispatcher.Dispatch(deliveryCtx, ev)
	if err == nil {
		if markErr := e.config.Store.MarkDelivered(deliveryCtx, ev.ID); markErr == nil {
			atomic.AddUint64(&e.metrics.DeliveredTotal, 1)
		}
		return
	}

	// Delivery failed
	isRetryable := CheckRetryable(err)
	if !isRetryable || ev.Attempts >= ev.MaxAttempts {
		// Non-retryable error or exhausted max attempts -> DLQ (dead)
		status, _ := e.config.Store.MarkFailed(deliveryCtx, ev.ID, time.Now(), err.Error())
		if status == StatusDead {
			atomic.AddUint64(&e.metrics.DeadTotal, 1)
		} else {
			atomic.AddUint64(&e.metrics.RetriedTotal, 1)
		}
		return
	}

	// Retryable failure -> calculate exponential backoff with jitter
	backoffDuration := e.config.Backoff.Compute(ev.Attempts)
	nextAttempt := time.Now().Add(backoffDuration)

	status, _ := e.config.Store.MarkFailed(deliveryCtx, ev.ID, nextAttempt, err.Error())
	if status == StatusDead {
		atomic.AddUint64(&e.metrics.DeadTotal, 1)
	} else {
		atomic.AddUint64(&e.metrics.RetriedTotal, 1)
	}
}

// runReaper periodically recovers stale locked events abandoned by crashed workers.
func (e *Engine) runReaper() {
	defer e.wg.Done()

	ticker := time.NewTicker(e.config.ReapInterval)
	defer ticker.Stop()

	for {
		select {
		case <-e.ctx.Done():
			return
		case <-ticker.C:
			reapCtx, cancel := context.WithTimeout(e.ctx, 10*time.Second)
			reclaimed, err := e.config.Store.ReclaimStale(reapCtx, e.config.LeaseTimeout)
			cancel()
			if err == nil && reclaimed > 0 {
				atomic.AddUint64(&e.metrics.ReclaimedTotal, uint64(reclaimed))
				if e.config.Notifier != nil {
					_ = e.config.Notifier.Notify(e.ctx)
				}
			}
		}
	}
}

// PrometheusHandler returns an http.Handler that serves Prometheus metrics in text format.
func (e *Engine) PrometheusHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		m := e.Metrics()
		w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
		fmt.Fprintf(w, "# HELP pgrelay_enqueued_total Total number of enqueued events\n")
		fmt.Fprintf(w, "# TYPE pgrelay_enqueued_total counter\n")
		fmt.Fprintf(w, "pgrelay_enqueued_total %d\n", m.EnqueuedTotal)

		fmt.Fprintf(w, "# HELP pgrelay_delivered_total Total number of delivered events\n")
		fmt.Fprintf(w, "# TYPE pgrelay_delivered_total counter\n")
		fmt.Fprintf(w, "pgrelay_delivered_total %d\n", m.DeliveredTotal)

		fmt.Fprintf(w, "# HELP pgrelay_retried_total Total number of retried events\n")
		fmt.Fprintf(w, "# TYPE pgrelay_retried_total counter\n")
		fmt.Fprintf(w, "pgrelay_retried_total %d\n", m.RetriedTotal)

		fmt.Fprintf(w, "# HELP pgrelay_dead_total Total number of dead-lettered events\n")
		fmt.Fprintf(w, "# TYPE pgrelay_dead_total counter\n")
		fmt.Fprintf(w, "pgrelay_dead_total %d\n", m.DeadTotal)

		fmt.Fprintf(w, "# HELP pgrelay_reclaimed_total Total number of reclaimed stale events\n")
		fmt.Fprintf(w, "# TYPE pgrelay_reclaimed_total counter\n")
		fmt.Fprintf(w, "pgrelay_reclaimed_total %d\n", m.ReclaimedTotal)
	})
}
