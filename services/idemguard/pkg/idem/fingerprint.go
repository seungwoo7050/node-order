package idem

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"strings"
)

// ComputeFingerprint calculates a deterministic SHA-256 hash across HTTP method,
// path, and canonicalized body. If the body is valid JSON, object keys are sorted
// recursively and redundant whitespace is eliminated, preventing false mismatches
// from formatting differences while ensuring any semantic change produces a mismatch.
func ComputeFingerprint(method, path string, body []byte) string {
	normMethod := strings.ToUpper(strings.TrimSpace(method))
	normPath := strings.TrimSpace(path)

	canonicalBody := canonicalizeBody(body)

	h := sha256.New()
	h.Write([]byte(normMethod))
	h.Write([]byte("\n"))
	h.Write([]byte(normPath))
	h.Write([]byte("\n"))
	h.Write(canonicalBody)

	return hex.EncodeToString(h.Sum(nil))
}

// canonicalizeBody attempts to decode the body as JSON and re-encode it with sorted keys
// and compact formatting. If the body is empty or not valid JSON, it returns the trimmed bytes.
func canonicalizeBody(body []byte) []byte {
	trimmed := bytes.TrimSpace(body)
	if len(trimmed) == 0 {
		return []byte{}
	}

	dec := json.NewDecoder(bytes.NewReader(trimmed))
	dec.UseNumber()

	var val any
	if err := dec.Decode(&val); err != nil {
		return trimmed
	}

	// Verify there are no subsequent JSON tokens
	var extra any
	if err := dec.Decode(&extra); err != io.EOF {
		return trimmed
	}

	canonicalVal := sortJSON(val)
	canonicalBytes, err := json.Marshal(canonicalVal)
	if err != nil {
		return trimmed
	}

	return canonicalBytes
}

func sortJSON(v any) any {
	switch val := v.(type) {
	case map[string]any:
		sorted := make(map[string]any, len(val))
		for k, child := range val {
			sorted[k] = sortJSON(child)
		}
		return sorted
	case []any:
		sortedList := make([]any, len(val))
		for i, child := range val {
			sortedList[i] = sortJSON(child)
		}
		return sortedList
	default:
		return val
	}
}
