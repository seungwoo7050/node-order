package idem

import (
	"testing"
)

func TestComputeFingerprint_JSONKeyOrderAndWhitespace(t *testing.T) {
	jsonA := []byte(`{
		"currency": "KRW",
		"amount": 50000,
		"metadata": {
			"order_id": "ORD-1234",
			"tier": "vip"
		}
	}`)

	jsonB := []byte(`{"amount":50000,"metadata":{"tier":"vip","order_id":"ORD-1234"},"currency":"KRW"}`)

	fpA := ComputeFingerprint("POST", "/v1/charges", jsonA)
	fpB := ComputeFingerprint("POST", "/v1/charges", jsonB)

	if fpA != fpB {
		t.Fatalf("expected identical fingerprints for semantically identical JSON, got %q vs %q", fpA, fpB)
	}

	// Case sensitivity of method
	fpLower := ComputeFingerprint("post", "/v1/charges", jsonA)
	if fpA != fpLower {
		t.Fatalf("expected method case normalization, got %q vs %q", fpA, fpLower)
	}

	// Payload modification produces mismatch
	jsonModified := []byte(`{"amount":50001,"metadata":{"tier":"vip","order_id":"ORD-1234"},"currency":"KRW"}`)
	fpMod := ComputeFingerprint("POST", "/v1/charges", jsonModified)
	if fpA == fpMod {
		t.Fatalf("expected different fingerprint when payload changes")
	}

	// Path modification produces mismatch
	fpDiffPath := ComputeFingerprint("POST", "/v1/refunds", jsonA)
	if fpA == fpDiffPath {
		t.Fatalf("expected different fingerprint when path changes")
	}
}

func TestComputeFingerprint_RawNonJSONAndEmpty(t *testing.T) {
	rawA := []byte("plain text payload")
	rawB := []byte("plain text payload")
	fpA := ComputeFingerprint("PUT", "/upload", rawA)
	fpB := ComputeFingerprint("PUT", "/upload", rawB)
	if fpA != fpB {
		t.Fatalf("expected identical fingerprints for raw payload")
	}

	emptyA := []byte("")
	emptyB := []byte("   \n\t")
	fpEmptyA := ComputeFingerprint("DELETE", "/item/1", emptyA)
	fpEmptyB := ComputeFingerprint("DELETE", "/item/1", emptyB)
	if fpEmptyA != fpEmptyB {
		t.Fatalf("expected identical fingerprints for empty / whitespace payload")
	}
}
