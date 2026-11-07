package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/woopinbell/idemguard/pkg/idem"
)

func main() {
	listenAddr := flag.String("listen", ":8082", "HTTP listen address")
	upstreamStr := flag.String("upstream", "http://localhost:8080", "Upstream target server URL")
	waitPolicyStr := flag.String("wait-policy", "wait", "In-flight concurrency policy (wait or reject)")
	ttl := flag.Duration("ttl", 24*time.Hour, "Idempotency key cache time-to-live")
	waitTimeout := flag.Duration("wait-timeout", 5*time.Second, "Maximum wait time for in-flight requests")
	maxCaptureBytes := flag.Int("max-capture-bytes", 1024*1024, "Maximum response body bytes to cache")
	flag.Parse()

	upstreamURL, err := url.Parse(*upstreamStr)
	if err != nil || upstreamURL.Host == "" {
		log.Fatalf("invalid upstream URL %q: %v", *upstreamStr, err)
	}

	policy := idem.PolicyWaitAndReplay
	if *waitPolicyStr == "reject" {
		policy = idem.PolicyReject409
	}

	// Memory store with 1-minute expiration reaper
	store := idem.NewMemoryStore(1 * time.Minute)
	defer store.Close()

	guard := idem.NewGuard(
		store,
		idem.WithWaitPolicy(policy),
		idem.WithWaitTimeout(*waitTimeout),
		idem.WithTTL(*ttl),
		idem.WithMaxCaptureBytes(*maxCaptureBytes),
	)

	proxy := httputil.NewSingleHostReverseProxy(upstreamURL)

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		w.WriteHeader(http.StatusOK)
		_, _ = fmt.Fprintln(w, "ok")
	})
	mux.Handle("/metrics", guard.MetricsHandler())
	mux.Handle("/", guard.Wrap(proxy))

	server := &http.Server{
		Addr:         *listenAddr,
		Handler:      mux,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 60 * time.Second,
	}

	stopCh := make(chan os.Signal, 1)
	signal.Notify(stopCh, os.Interrupt, syscall.SIGTERM)

	go func() {
		log.Printf("idemguard listening on %s -> upstream %s (policy=%s, ttl=%v)", *listenAddr, *upstreamStr, policy, *ttl)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server listen error: %v", err)
		}
	}()

	<-stopCh
	log.Println("shutting down idemguard server gracefully...")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := server.Shutdown(shutdownCtx); err != nil {
		log.Printf("server graceful shutdown error: %v", err)
	} else {
		log.Println("idemguard server stopped cleanly")
	}
}
