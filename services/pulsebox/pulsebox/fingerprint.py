from __future__ import annotations

import hashlib
import re

_HEX_ADDR_RE = re.compile(r"0x[0-9a-fA-F]+")
_LINE_NUM_RE = re.compile(r"\bline \d+\b", re.IGNORECASE)
_COLON_LINE_RE = re.compile(r":\d+:")
_UUID_RE = re.compile(
    r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b"
)
_TIMESTAMP_RE = re.compile(
    r"\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b"
)


def normalize_stacktrace(stacktrace: str) -> str:
    """Normalize dynamic memory addresses, line numbers, timestamps, and UUIDs.

    Converts ephemeral execution details into canonical tokens so that the same root
    cause maps to a consistent fingerprint across multiple runs and environments.
    """
    if not stacktrace:
        return ""

    # Normalize timestamps and UUIDs first to prevent line regexes from corrupting time colons
    text = _TIMESTAMP_RE.sub("<timestamp>", stacktrace)
    text = _UUID_RE.sub("<uuid>", text)
    text = _HEX_ADDR_RE.sub("<addr>", text)
    text = _LINE_NUM_RE.sub("line <n>", text)
    text = _COLON_LINE_RE.sub(":<n>:", text)

    lines = [line.strip() for line in text.strip().splitlines() if line.strip()]
    return "\n".join(lines)


def compute_fingerprint(
    service: str,
    exception_type: str,
    stacktrace: str,
    custom_fingerprint: str | None = None,
) -> str:
    """Compute a canonical 64-character SHA-256 hex fingerprint for error deduplication."""
    if custom_fingerprint:
        cleaned = custom_fingerprint.strip()
        if len(cleaned) == 64 and re.fullmatch(r"[0-9a-fA-F]{64}", cleaned):
            return cleaned.lower()
        payload = f"{service.strip()}:{cleaned}"
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()

    norm_trace = normalize_stacktrace(stacktrace)
    raw = f"{service.strip()}|{exception_type.strip()}|{norm_trace}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()
