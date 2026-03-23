"""
Redis-backed runtime cache helpers.
Database remains the source of truth when cache entries are absent.
"""

from __future__ import annotations

import json
from typing import Any, Optional

from app.config import (
    CACHE_REDIS_PREFIX,
    PARTICIPANT_CACHE_TTL_SECONDS,
    PARTICIPANT_OPTIONS_CACHE_TTL_SECONDS,
    PAYMENT_STATUS_CACHE_TTL_SECONDS_ACTIVE,
    PAYMENT_STATUS_CACHE_TTL_SECONDS_TERMINAL,
)
from app.extensions import cache_redis
from app.utils.runtime_cache_queries import QUERY_RESOLVE_PARTICIPANT_ID


def _redis_key(*parts: object) -> str:
    normalized = [str(part).strip() for part in parts if str(part).strip()]
    return f"{CACHE_REDIS_PREFIX}:{':'.join(normalized)}"


def _redis_get_json(key: str) -> Optional[dict[str, Any]]:
    if cache_redis is None:
        return None
    try:
        raw = cache_redis.get(key)
        if not raw:
            return None
        data = json.loads(raw)
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def _redis_set_json(key: str, value: dict[str, Any], ttl_seconds: float) -> None:
    if cache_redis is None:
        return
    try:
        cache_redis.setex(key, max(1, int(ttl_seconds)), json.dumps(value))
    except Exception:
        return


def _redis_delete(key: str) -> None:
    if cache_redis is None:
        return
    try:
        cache_redis.delete(key)
    except Exception:
        return


def get_cached_participant_id(public_id: str) -> Optional[int]:
    if not public_id:
        return None
    data = _redis_get_json(_redis_key("participant-id", public_id))
    participant_id = data.get("participant_id") if data else None
    return int(participant_id) if participant_id else None


def set_cached_participant_id(public_id: str, participant_id: int) -> None:
    if not public_id or not participant_id:
        return
    _redis_set_json(
        _redis_key("participant-id", public_id),
        {"participant_id": int(participant_id)},
        PARTICIPANT_CACHE_TTL_SECONDS,
    )


def resolve_participant_id(db, public_id: str) -> Optional[int]:
    cached = get_cached_participant_id(public_id)
    if cached:
        return cached
    pid = db.execute(QUERY_RESOLVE_PARTICIPANT_ID, {"pub": public_id}).scalar()
    if pid:
        set_cached_participant_id(public_id, int(pid))
    return int(pid) if pid else None


def get_cached_participant_options() -> Optional[dict[str, Any]]:
    data = _redis_get_json(_redis_key("participant-options"))
    payload = data.get("payload") if data else None
    return dict(payload) if isinstance(payload, dict) else None


def set_cached_participant_options(value: dict[str, Any]) -> None:
    if not isinstance(value, dict) or not value:
        return
    _redis_set_json(
        _redis_key("participant-options"),
        {"payload": dict(value)},
        PARTICIPANT_OPTIONS_CACHE_TTL_SECONDS,
    )


def get_cached_payment_status(payment_public_id: str) -> Optional[dict[str, Any]]:
    if not payment_public_id:
        return None
    data = _redis_get_json(_redis_key("payment-status", payment_public_id))
    payload = data.get("payload") if data else None
    return dict(payload) if isinstance(payload, dict) else None


def set_cached_payment_status(
    payment_public_id: str,
    payload: dict[str, Any],
    *,
    is_terminal: bool,
    payment_id: int | None = None,
) -> None:
    if not payment_public_id or not isinstance(payload, dict):
        return
    ttl_seconds = (
        PAYMENT_STATUS_CACHE_TTL_SECONDS_TERMINAL
        if is_terminal
        else PAYMENT_STATUS_CACHE_TTL_SECONDS_ACTIVE
    )
    _redis_set_json(
        _redis_key("payment-status", payment_public_id),
        {"payload": dict(payload), "is_terminal": bool(is_terminal)},
        ttl_seconds,
    )
    if payment_id:
        _redis_set_json(
            _redis_key("payment-id", int(payment_id)),
            {"payment_public_id": payment_public_id},
            PAYMENT_STATUS_CACHE_TTL_SECONDS_TERMINAL,
        )


def invalidate_payment_status_cache(payment_public_id: str) -> None:
    if payment_public_id:
        _redis_delete(_redis_key("payment-status", payment_public_id))


def invalidate_payment_status_cache_by_id(payment_id: int | None) -> None:
    if payment_id is None:
        return
    payment_id = int(payment_id)
    data = _redis_get_json(_redis_key("payment-id", payment_id))
    public_id = data.get("payment_public_id") if data else None
    if public_id:
        invalidate_payment_status_cache(public_id)
    _redis_delete(_redis_key("payment-id", payment_id))
