"""Sanitize log fields to avoid leaking sensitive data."""

from __future__ import annotations

from typing import Any, Mapping

CONFIDENTIAL_KEYWORDS = {
    "password",
    "secret",
    "token",
    "authorization",
    "cookie",
    "session",
    "key",
    "salt",
    "upi",
    "vpa",
    "sha256",
    "hash",
    "email",
    "phone",
    "ip",
}

MAX_VALUE_LENGTH = 256
MAX_NESTED_DEPTH = 3


def _is_confidential_key(key: str) -> bool:
    lowered = key.lower()
    return any(keyword in lowered for keyword in CONFIDENTIAL_KEYWORDS)


def _truncate(value: str) -> str:
    if len(value) <= MAX_VALUE_LENGTH:
        return value
    return f"{value[:MAX_VALUE_LENGTH]}…"


def _sanitize_value(value: Any, depth: int) -> Any:
    if depth <= 0:
        return "[redacted]"
    if value is None:
        return None
    if isinstance(value, (int, float, bool)):
        return value
    if isinstance(value, str):
        return _truncate(value)
    if isinstance(value, bytes):
        return "[binary]"
    if isinstance(value, Mapping):
        return sanitize_fields(value, depth=depth - 1)
    if isinstance(value, (list, tuple)):
        return [
            _sanitize_value(item, depth=depth - 1)
            for item in value[:20]
        ]
    return _truncate(str(value))


def sanitize_fields(fields: Mapping[str, Any], *, depth: int = MAX_NESTED_DEPTH) -> dict[str, Any]:
    sanitized: dict[str, Any] = {}
    for key, value in fields.items():
        if value is None:
            continue
        if _is_confidential_key(str(key)):
            sanitized[key] = "[redacted]"
            continue
        sanitized[key] = _sanitize_value(value, depth)
    return sanitized
