"""HTTP fetching and value extraction engine for driftwatch."""

from __future__ import annotations

import json
import re
from typing import Any

import httpx


class HttpFetcher:
    """Asynchronous HTTP body fetcher with customizable transport for mocking."""

    def __init__(
        self,
        transport: httpx.AsyncBaseTransport | None = None,
        timeout: float = 10.0,
    ) -> None:
        self.transport = transport
        self.timeout = timeout

    async def fetch(self, url: str) -> str:
        """Fetch remote URL contents as UTF-8 string."""
        async with httpx.AsyncClient(
            transport=self.transport,
            timeout=self.timeout,
            follow_redirects=True,
        ) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            return resp.text


def extract_value(raw_body: str, extractor_type: str, selector: str) -> str:
    """Extract a target fact value using JSON path or regex word boundary selector."""
    if extractor_type == "json_path":
        return _extract_json_path(raw_body, selector)
    elif extractor_type == "regex":
        return _extract_regex(raw_body, selector)
    else:
        raise ValueError(f"Unsupported extractor_type: '{extractor_type}'")


def _extract_json_path(raw_body: str, selector: str) -> str:
    """Traverse dot-delimited path through nested JSON objects and arrays."""
    try:
        data: Any = json.loads(raw_body)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Malformed JSON body: {exc}") from exc

    parts = [p.strip() for p in selector.split(".") if p.strip()]
    if not parts:
        raise ValueError("Selector path cannot be empty")

    current: Any = data
    for part in parts:
        if isinstance(current, dict):
            if part in current:
                current = current[part]
            else:
                raise ValueError(f"Key '{part}' not found in JSON object")
        elif isinstance(current, list):
            try:
                idx = int(part)
            except ValueError as exc:
                raise ValueError(f"Cannot index list with non-integer token '{part}'") from exc
            if 0 <= idx < len(current):
                current = current[idx]
            else:
                raise ValueError(f"List index {idx} out of range (length {len(current)})")
        else:
            raise ValueError(f"Cannot traverse token '{part}' on scalar value of type {type(current).__name__}")

    if current is None:
        return ""
    if isinstance(current, (dict, list)):
        return json.dumps(current, separators=(",", ":"))
    return str(current)


def _extract_regex(raw_body: str, selector: str) -> str:
    """Match regex pattern ensuring word/digit boundary safety and extracting capture group."""
    try:
        pattern = re.compile(selector)
    except re.error as exc:
        raise ValueError(f"Invalid regex selector pattern: {exc}") from exc

    match = pattern.search(raw_body)
    if not match:
        raise ValueError(f"Regex pattern '{selector}' did not match payload")

    groups = match.groups()
    if groups:
        for grp in groups:
            if grp is not None:
                return grp.strip()
    return match.group(0).strip()


def validate_extracted_value(
    raw_val: str,
    expected_type: str,
    expected_value: str | None,
    min_value: float | None,
    max_value: float | None,
) -> tuple[str, str | None]:
    """Validate and normalize value, returning (normalized_string, violation_detail | None)."""
    normalized_type = expected_type.strip().lower()

    if normalized_type == "int":
        cleaned = raw_val.strip()
        try:
            int_val = int(cleaned) if "." not in cleaned else int(float(cleaned))
        except ValueError:
            return cleaned, f"Value '{cleaned}' cannot be converted to int"

        norm_str = str(int_val)
        if expected_value is not None:
            try:
                exp_int = int(expected_value.strip())
                if int_val != exp_int:
                    return norm_str, f"Expected value {exp_int}, got {int_val}"
            except ValueError:
                pass

        if min_value is not None and float(int_val) < min_value:
            return norm_str, f"Value {int_val} is below minimum allowed {min_value}"
        if max_value is not None and float(int_val) > max_value:
            return norm_str, f"Value {int_val} exceeds maximum allowed {max_value}"

        return norm_str, None

    elif normalized_type == "float":
        cleaned = raw_val.strip()
        try:
            flt_val = float(cleaned)
        except ValueError:
            return cleaned, f"Value '{cleaned}' cannot be converted to float"

        norm_str = str(flt_val)
        if expected_value is not None:
            try:
                exp_flt = float(expected_value.strip())
                if abs(flt_val - exp_flt) > 1e-9:
                    return norm_str, f"Expected value {exp_flt}, got {flt_val}"
            except ValueError:
                pass

        if min_value is not None and flt_val < min_value:
            return norm_str, f"Value {flt_val} is below minimum allowed {min_value}"
        if max_value is not None and flt_val > max_value:
            return norm_str, f"Value {flt_val} exceeds maximum allowed {max_value}"

        return norm_str, None

    elif normalized_type == "str":
        cleaned = raw_val.strip()
        if expected_value is not None and cleaned != expected_value.strip():
            return cleaned, f"Expected value '{expected_value.strip()}', got '{cleaned}'"
        return cleaned, None

    else:
        raise ValueError(f"Unsupported expected_type: '{expected_type}'")
