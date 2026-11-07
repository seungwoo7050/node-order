package relay

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"
)

const (
	// DefaultSignatureTolerance is the default replay protection window.
	DefaultSignatureTolerance = 5 * time.Minute
	// SignaturePrefix is the version prefix for webhook signatures.
	SignaturePrefix = "v1="
)

var (
	ErrInvalidSignature = errors.New("invalid signature")
	ErrSignatureExpired = errors.New("signature timestamp outside tolerance window")
	ErrMalformedHeader  = errors.New("malformed signature header")
)

// Signer signs and verifies webhook payloads using HMAC-SHA256.
type Signer struct {
	secret    []byte
	tolerance time.Duration
}

// NewSigner creates a new Signer with a secret key.
func NewSigner(secret []byte) *Signer {
	return &Signer{
		secret:    secret,
		tolerance: DefaultSignatureTolerance,
	}
}

// WithTolerance sets the replay protection tolerance window.
func (s *Signer) WithTolerance(tolerance time.Duration) *Signer {
	s.tolerance = tolerance
	return s
}

// Sign computes the HMAC-SHA256 signature for a payload at a given timestamp.
// Format: v1=<hex(hmac-sha256(secret, timestamp.Unix() + "." + payload))>
func (s *Signer) Sign(timestamp time.Time, payload []byte) string {
	return Sign(s.secret, timestamp, payload)
}

// Verify validates the signature header and checks timestamp replay freshness.
func (s *Signer) Verify(header string, timestamp time.Time, payload []byte) error {
	return Verify(s.secret, header, timestamp, payload, s.tolerance)
}

// Sign computes the signature string using the secret, timestamp Unix epoch, and payload.
func Sign(secret []byte, timestamp time.Time, payload []byte) string {
	mac := hmac.New(sha256.New, secret)
	fmt.Fprintf(mac, "%d.", timestamp.Unix())
	mac.Write(payload)
	return SignaturePrefix + hex.EncodeToString(mac.Sum(nil))
}

// Verify validates that the signature header matches the expected HMAC-SHA256
// digest and that the timestamp is within tolerance of now.
func Verify(secret []byte, header string, timestamp time.Time, payload []byte, tolerance time.Duration) error {
	if tolerance > 0 {
		diff := time.Since(timestamp)
		if diff < -tolerance || diff > tolerance {
			return ErrSignatureExpired
		}
	}

	trimmed := strings.TrimSpace(header)
	if !strings.HasPrefix(trimmed, SignaturePrefix) {
		return ErrMalformedHeader
	}

	sigHex := strings.TrimPrefix(trimmed, SignaturePrefix)
	sigBytes, err := hex.DecodeString(sigHex)
	if err != nil {
		return fmt.Errorf("%w: invalid hex encoding", ErrMalformedHeader)
	}

	mac := hmac.New(sha256.New, secret)
	fmt.Fprintf(mac, "%d.", timestamp.Unix())
	mac.Write(payload)
	expectedMAC := mac.Sum(nil)

	if !hmac.Equal(sigBytes, expectedMAC) {
		return ErrInvalidSignature
	}

	return nil
}
