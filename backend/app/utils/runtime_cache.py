"""Redis-backed runtime cache helpers."""

from __future__ import annotations

import json
from typing import Any, Optional

from app.config import CACHE_REDIS_PREFIX, PARTICIPANT_CACHE_TTL_SECONDS, PARTICIPANT_OPTIONS_CACHE_TTL_SECONDS
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
