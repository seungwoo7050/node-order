from __future__ import annotations

import csv
import hashlib
import io
import json
from dataclasses import dataclass
from typing import Any, Iterator

from pydantic import BaseModel, ConfigDict, Field, ValidationError, create_model

from ingestguard.models import SchemaSpec


@dataclass(frozen=True)
class ValidatedRow:
    row_number: int
    record_key: str
    payload: dict[str, Any]
    payload_hash: str


@dataclass(frozen=True)
class RejectedRow:
    row_number: int
    raw_payload: dict[str, Any]
    errors: list[dict[str, Any]]


def compute_payload_hash(data: dict[str, Any]) -> str:
    """Compute deterministic SHA-256 hash of canonical JSON-serialized dictionary."""
    canonical_json = json.dumps(
        data,
        sort_keys=True,
        ensure_ascii=True,
        separators=(",", ":"),
        default=str,
    )
    return hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()


def build_row_validator(spec: SchemaSpec) -> type[BaseModel]:
    """Dynamically construct a Pydantic v2 model enforcing field types and validation rules."""
    type_map: dict[str, type] = {
        "int": int,
        "float": float,
        "str": str,
        "bool": bool,
    }

    field_definitions: dict[str, Any] = {}
    for field_name, rule in spec.fields.items():
        base_type = type_map[rule.type]
        kwargs: dict[str, Any] = {}
        if rule.ge is not None:
            kwargs["ge"] = rule.ge
        if rule.le is not None:
            kwargs["le"] = rule.le
        if rule.min_length is not None:
            kwargs["min_length"] = rule.min_length
        if rule.max_length is not None:
            kwargs["max_length"] = rule.max_length

        if rule.required:
            field_definitions[field_name] = (base_type, Field(..., **kwargs))
        else:
            field_definitions[field_name] = (base_type | None, Field(default=None, **kwargs))

    model: type[BaseModel] = create_model(
        "DynamicRowModel",
        __config__=ConfigDict(extra="allow"),
        **field_definitions,
    )
    return model


def _clean_input_dict(raw: dict[str, Any], spec: SchemaSpec) -> dict[str, Any]:
    cleaned = dict(raw)
    for field_name, rule in spec.fields.items():
        if field_name in cleaned:
            val = cleaned[field_name]
            if not rule.required and (val == "" or val is None):
                cleaned[field_name] = None
    return cleaned


def iter_validated_chunks(
    content: str,
    format_type: str,
    spec: SchemaSpec,
    chunk_size: int = 200,
) -> Iterator[tuple[list[ValidatedRow], list[RejectedRow]]]:
    """Stream and validate CSV/JSONL content in chunks, isolating schema errors into rejected rows."""
    if format_type not in ("csv", "jsonl"):
        raise ValueError(f"Unsupported format_type: {format_type}. Must be 'csv' or 'jsonl'.")

    validator_cls = build_row_validator(spec)
    stream = io.StringIO(content)

    validated_buf: list[ValidatedRow] = []
    rejected_buf: list[RejectedRow] = []

    def _flush_if_needed() -> Iterator[tuple[list[ValidatedRow], list[RejectedRow]]]:
        nonlocal validated_buf, rejected_buf
        if len(validated_buf) + len(rejected_buf) >= chunk_size:
            yield list(validated_buf), list(rejected_buf)
            validated_buf.clear()
            rejected_buf.clear()

    if format_type == "csv":
        reader = csv.DictReader(stream)
        for row_idx, raw_dict in enumerate(reader, start=1):
            try:
                cleaned = _clean_input_dict(raw_dict, spec)
                validated_model = validator_cls.model_validate(cleaned)
                dumped = validated_model.model_dump()
                record_key = str(dumped[spec.key_field])
                payload_hash = compute_payload_hash(dumped)
                validated_buf.append(
                    ValidatedRow(
                        row_number=row_idx,
                        record_key=record_key,
                        payload=dumped,
                        payload_hash=payload_hash,
                    )
                )
            except ValidationError as err:
                errors = [
                    {
                        "loc": [str(loc_item) for loc_item in e["loc"]],
                        "msg": e["msg"],
                        "type": e["type"],
                    }
                    for e in err.errors()
                ]
                rejected_buf.append(
                    RejectedRow(
                        row_number=row_idx,
                        raw_payload=raw_dict,
                        errors=errors,
                    )
                )
            yield from _flush_if_needed()

    elif format_type == "jsonl":
        row_idx = 0
        for line in stream:
            line_str = line.strip()
            if not line_str:
                continue
            row_idx += 1
            try:
                parsed_json = json.loads(line_str)
                if not isinstance(parsed_json, dict):
                    raise ValueError("JSONL line must be a JSON object")
            except Exception as e:
                rejected_buf.append(
                    RejectedRow(
                        row_number=row_idx,
                        raw_payload={"__raw_line__": line_str},
                        errors=[
                            {
                                "loc": ["__root__"],
                                "msg": f"Malformed JSON: {e}",
                                "type": "json_decode_error",
                            }
                        ],
                    )
                )
                yield from _flush_if_needed()
                continue

            try:
                cleaned = _clean_input_dict(parsed_json, spec)
                validated_model = validator_cls.model_validate(cleaned)
                dumped = validated_model.model_dump()
                record_key = str(dumped[spec.key_field])
                payload_hash = compute_payload_hash(dumped)
                validated_buf.append(
                    ValidatedRow(
                        row_number=row_idx,
                        record_key=record_key,
                        payload=dumped,
                        payload_hash=payload_hash,
                    )
                )
            except ValidationError as err:
                errors = [
                    {
                        "loc": [str(loc_item) for loc_item in e["loc"]],
                        "msg": e["msg"],
                        "type": e["type"],
                    }
                    for e in err.errors()
                ]
                rejected_buf.append(
                    RejectedRow(
                        row_number=row_idx,
                        raw_payload=parsed_json,
                        errors=errors,
                    )
                )
            yield from _flush_if_needed()

    if validated_buf or rejected_buf:
        yield list(validated_buf), list(rejected_buf)
        validated_buf.clear()
        rejected_buf.clear()
