package main

import (
	"context"
	"errors"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/woopinbell/rolltrace/pkg/rolltrace"
)

func main() {
	cfg := rolltrace.DefaultConfig()

	flag.StringVar(&cfg.HTTPAddr, "http-addr", cfg.HTTPAddr, "HTTP server listen address")
	flag.StringVar(&cfg.HTTPAddr, "listen", cfg.HTTPAddr, "HTTP server listen address (alias for -http-addr)")
	flag.StringVar(&cfg.Service, "service", cfg.Service, "Default service name")
	flag.Int64Var(&cfg.TailSampler.LatencyThresholdMs, "latency-threshold", cfg.TailSampler.LatencyThresholdMs, "Anomaly latency threshold in ms")
	flag.IntVar(&cfg.TailSampler.ErrorStatusThreshold, "error-threshold", cfg.TailSampler.ErrorStatusThreshold, "Error status code threshold (e.g. 500)")
	flag.Float64Var(&cfg.TailSampler.BaseSampleRate, "base-sample-rate", cfg.TailSampler.BaseSampleRate, "Hash-based base sample rate (0.0 to 1.0)")
	flag.IntVar(&cfg.TailSampler.MaxBufferedTraces, "max-buffered-traces", cfg.TailSampler.MaxBufferedTraces, "Maximum traces kept in memory")
	flag.IntVar(&cfg.Canary.MinSampleCount, "min-sample-count", cfg.Canary.MinSampleCount, "Minimum samples required before evaluating SLO")
	flag.IntVar(&cfg.Canary.ConsecutiveBreaches, "consecutive-breaches", cfg.Canary.ConsecutiveBreaches, "Consecutive SLO breaches before automated rollback")

	flag.Parse()

	if err := cfg.Validate(); err != nil {
		log.Fatalf("invalid configuration: %v", err)
	}

	sampler := rolltrace.NewTailSampler(cfg.TailSampler)
	leaseMgr := rolltrace.NewLeaseManager(cfg.Lease)
	canaryCtrl := rolltrace.NewCanaryController(cfg.Canary, leaseMgr, sampler)
	srv := rolltrace.NewServer(cfg, sampler, leaseMgr, canaryCtrl)

	httpServer := &http.Server{
		Addr:         cfg.HTTPAddr,
		Handler:      srv.Handler(),
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go func() {
		log.Printf("rolltrace daemon starting on %s (service: %s)", cfg.HTTPAddr, cfg.Service)
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("server error: %v", err)
		}
	}()

	<-ctx.Done()
	log.Println("shutdown signal received; commencing graceful stop...")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		log.Printf("graceful shutdown failed: %v", err)
		_ = httpServer.Close()
	} else {
		log.Println("rolltrace daemon stopped cleanly")
	}
}
