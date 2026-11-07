package gate

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sync"
)

// Result holds the return value of a coalesced call.
type Result struct {
	Val    any
	Err    error
	Shared bool
}

// call represents an in-flight or completed single-flight execution.
type call struct {
	key        string
	val        any
	err        error
	done       chan struct{}
	cancelExec context.CancelFunc // Cancels upstream execution context when all subscribers cancel

	mu          sync.Mutex
	subscribers int // Number of active waiting callers
}

// Group represents a single-flight group that isolates caller context cancellations.
// Unlike standard singleflight, cancelling the first caller's context will NOT abort the
// upstream call as long as at least one waiting caller's context remains active.
type Group struct {
	mu    sync.Mutex
	calls map[string]*call
}

// NewGroup creates an initialized single-flight group.
func NewGroup() *Group {
	return &Group{
		calls: make(map[string]*call),
	}
}

// RequestKey computes a deduplication hash key from the HTTP method, path, and request body.
func RequestKey(method, path string, body []byte) string {
	h := sha256.New()
	h.Write(body)
	return method + " " + path + "#" + hex.EncodeToString(h.Sum(nil))
}

// Do executes and returns the results of the given function, making sure that only one execution
// is in-flight for a given key at a time. If a duplicate comes in, the duplicate caller waits for the
// original to complete and receives the same results.
//
// If the original (leader) caller's context is cancelled, the upstream execution continues unharmed
// using context.WithoutCancel as long as there is at least one active follower context.
// The upstream execution is cancelled if and only if ALL active subscribers cancel their contexts.
func (g *Group) Do(ctx context.Context, key string, fn func(execCtx context.Context) (any, error)) (any, error, bool) {
	if ctx.Err() != nil {
		return nil, ctx.Err(), false
	}

	g.mu.Lock()
	if c, ok := g.calls[key]; ok {
		c.mu.Lock()
		if c.subscribers > 0 {
			c.subscribers++
			c.mu.Unlock()
			g.mu.Unlock()

			// Waiting follower
			select {
			case <-c.done:
				return c.val, c.err, true
			case <-ctx.Done():
				c.mu.Lock()
				c.subscribers--
				shouldCancel := (c.subscribers <= 0)
				c.mu.Unlock()
				if shouldCancel && c.cancelExec != nil {
					c.cancelExec()
				}
				return nil, ctx.Err(), true
			}
		}
		// Previous subscribers all cancelled and abandoned the call; purge it
		delete(g.calls, key)
		c.mu.Unlock()
	}

	// Caller is the leader
	execCtx, cancelExec := context.WithCancel(context.WithoutCancel(ctx))
	c := &call{
		key:         key,
		done:        make(chan struct{}),
		cancelExec:  cancelExec,
		subscribers: 1,
	}
	g.calls[key] = c
	g.mu.Unlock()

	go func() {
		var (
			panicVal any
			val      any
			err      error
		)

		defer func() {
			if r := recover(); r != nil {
				panicVal = r
			}

			c.mu.Lock()
			c.val = val
			if panicVal != nil {
				c.err = fmt.Errorf("singleflight panic: %v", panicVal)
			} else {
				c.err = err
			}
			c.mu.Unlock()

			g.mu.Lock()
			delete(g.calls, key)
			g.mu.Unlock()

			close(c.done)
		}()

		val, err = fn(execCtx)
	}()

	select {
	case <-c.done:
		return c.val, c.err, false
	case <-ctx.Done():
		c.mu.Lock()
		c.subscribers--
		shouldCancel := (c.subscribers <= 0)
		c.mu.Unlock()
		if shouldCancel && c.cancelExec != nil {
			c.cancelExec()
		}
		return nil, ctx.Err(), false
	}
}

// Forget removes the key from the single-flight group.
func (g *Group) Forget(key string) {
	g.mu.Lock()
	delete(g.calls, key)
	g.mu.Unlock()
}
