package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/woopinbell/aigate/pkg/gate"
)

func main() {
	listenAddr := flag.String("listen", ":8081", "TCP address to listen on")
	primaryURL := flag.String("primary", "", "Primary upstream URL (e.g. http://localhost:9001)")
	fallbackURL := flag.String("fallback", "", "Fallback upstream URL (e.g. http://localhost:9002)")
	primaryKey := flag.String("primary-key", "", "API key for primary provider")
	fallbackKey := flag.String("fallback-key", "", "API key for fallback provider")
	rps := flag.Float64("rps", 10.0, "Rate limit token refill rate (requests per second)")
	burst := flag.Float64("burst", 20.0, "Rate limit token bucket burst capacity")
	failureThreshold := flag.Int("failure-threshold", 3, "Circuit breaker consecutive failure threshold")
	cooldown := flag.Duration("cooldown", 5*time.Second, "Circuit breaker cooldown before half-open probe")
	flag.Parse()

	cfg := gate.DefaultConfig()
	cfg.RateLimit.RequestsPerSecond = *rps
	cfg.RateLimit.Burst = *burst
	cfg.Breaker.FailureThreshold = *failureThreshold
	cfg.Breaker.Cooldown = *cooldown

	var providers []gate.ProviderConfig
	if *primaryURL != "" {
		providers = append(providers, gate.ProviderConfig{
			Name:     "primary",
			BaseURL:  *primaryURL,
			APIKey:   *primaryKey,
			Priority: 1,
			Timeout:  30 * time.Second,
		})
	}
	if *fallbackURL != "" {
		providers = append(providers, gate.ProviderConfig{
			Name:     "fallback",
			BaseURL:  *fallbackURL,
			APIKey:   *fallbackKey,
			Priority: 2,
			Timeout:  30 * time.Second,
		})
	}

	if len(providers) == 0 {
		// Default mock upstream for standalone smoke testing if no flags provided
		providers = append(providers, gate.ProviderConfig{
			Name:     "default-upstream",
			BaseURL:  "https://api.openai.com",
			Priority: 1,
			Timeout:  30 * time.Second,
		})
	}
	cfg.Providers = providers

	gateway := gate.NewGateway(cfg)

	server := &http.Server{
		Addr:         *listenAddr,
		Handler:      gateway,
		ReadTimeout:  60 * time.Second,
		WriteTimeout: 120 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)

	go func() {
		log.Printf("[aigate] Starting resilience gateway on %s", *listenAddr)
		for _, p := range cfg.Providers {
			log.Printf("[aigate] Configured provider %q (Priority %d) -> %s", p.Name, p.Priority, p.BaseURL)
		}
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("[aigate] Server failed: %v", err)
		}
	}()

	<-stop
	log.Println("[aigate] Shutting down server gracefully...")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := server.Shutdown(shutdownCtx); err != nil {
		log.Fatalf("[aigate] Server forced to shutdown: %v", err)
	}

	log.Println("[aigate] Gateway stopped cleanly")
	fmt.Println()
}
