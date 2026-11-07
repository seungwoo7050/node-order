package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/woopinbell/pgrelay/pkg/relay"
)

func main() {
	var (
		listenAddr    = flag.String("listen", ":8080", "HTTP server listen address")
		workerCount   = flag.Int("workers", 4, "Number of concurrent delivery workers")
		batchSize     = flag.Int("batch-size", 16, "Maximum batch size to claim per poll")
		pollInterval  = flag.Duration("poll-interval", 500*time.Millisecond, "Outbox polling interval")
		leaseTimeout  = flag.Duration("lease-timeout", 30*time.Second, "Worker lock lease timeout")
		reapInterval  = flag.Duration("reap-interval", 10*time.Second, "Stale lock reaper interval")
		signingSecret = flag.String("signing-secret", "pgrelay-default-secret", "HMAC-SHA256 webhook signing secret")
		postgresDSN   = flag.String("postgres-dsn", "", "PostgreSQL connection DSN (if empty, runs in demo mode)")
		demoMode      = flag.Bool("demo", false, "Force in-memory demo mode without PostgreSQL")
	)
	flag.Parse()

	startTime := time.Now()
	useDemo := *demoMode || *postgresDSN == ""

	var store relay.Store
	if useDemo {
		log.Println("[pgrelay] Running in standalone demo mode with thread-safe MemStore")
		store = relay.NewMemStore()
	} else {
		log.Printf("[pgrelay] Connecting to PostgreSQL...")
		db, err := sql.Open("postgres", *postgresDSN)
		if err != nil {
			log.Fatalf("[pgrelay] Failed to open PostgreSQL connection: %v", err)
		}
		defer db.Close()
		store = relay.NewPGStore(db)
	}

	var signer *relay.Signer
	if *signingSecret != "" {
		signer = relay.NewSigner([]byte(*signingSecret))
	}
	dispatcher := relay.NewHTTPDispatcher(http.DefaultClient, signer)

	engine, err := relay.NewEngine(relay.EngineConfig{
		Store:        store,
		Dispatcher:   dispatcher,
		WorkerCount:  *workerCount,
		BatchSize:    *batchSize,
		PollInterval: *pollInterval,
		LeaseTimeout: *leaseTimeout,
		ReapInterval: *reapInterval,
		Backoff:      relay.DefaultBackoffPolicy(),
	})
	if err != nil {
		log.Fatalf("[pgrelay] Failed to initialize engine: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	if err := engine.Start(ctx); err != nil {
		log.Fatalf("[pgrelay] Failed to start engine: %v", err)
	}

	mux := http.NewServeMux()

	// Health check endpoint
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"status":   "ok",
			"workers":  *workerCount,
			"demo":     useDemo,
			"uptime_s": int(time.Since(startTime).Seconds()),
		})
	})

	// Prometheus metrics endpoint
	mux.Handle("/metrics", engine.PrometheusHandler())

	// Enqueue & query events endpoint
	mux.HandleFunc("/v1/events", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodPost:
			var req struct {
				ID       string            `json:"id"`
				Topic    string            `json:"topic"`
				Endpoint string            `json:"endpoint"`
				Payload  json.RawMessage   `json:"payload"`
				Headers  map[string]string `json:"headers"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, fmt.Sprintf(`{"error":"invalid json body: %v"}`, err), http.StatusBadRequest)
				return
			}
			if req.ID == "" {
				req.ID = generateEventID()
			}

			event := &relay.Event{
				ID:       req.ID,
				Topic:    req.Topic,
				Endpoint: req.Endpoint,
				Payload:  req.Payload,
				Headers:  req.Headers,
			}

			if err := engine.Enqueue(r.Context(), event); err != nil {
				http.Error(w, fmt.Sprintf(`{"error":"failed to enqueue: %v"}`, err), http.StatusBadRequest)
				return
			}

			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"id":     event.ID,
				"status": string(relay.StatusPending),
			})

		case http.MethodGet:
			stats, err := store.Stats(r.Context())
			if err != nil {
				http.Error(w, fmt.Sprintf(`{"error":"failed to get stats: %v"}`, err), http.StatusInternalServerError)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(stats)

		default:
			http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		}
	})

	server := &http.Server{
		Addr:    *listenAddr,
		Handler: mux,
	}

	go func() {
		log.Printf("[pgrelay] Daemon listening on %s (metrics: /metrics, health: /healthz)", *listenAddr)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("[pgrelay] Server error: %v", err)
		}
	}()

	// Graceful shutdown handling
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)
	sig := <-sigCh
	log.Printf("[pgrelay] Caught signal %s, draining workers and stopping daemon...", sig)

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()

	if err := server.Shutdown(shutdownCtx); err != nil {
		log.Printf("[pgrelay] HTTP shutdown warning: %v", err)
	}

	if err := engine.Stop(); err != nil {
		log.Printf("[pgrelay] Engine shutdown error: %v", err)
	}

	_ = store.Close()
	log.Println("[pgrelay] Stopped cleanly.")
}

func generateEventID() string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return fmt.Sprintf("evt_%s", hex.EncodeToString(b))
}
