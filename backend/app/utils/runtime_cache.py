"""
Small in-process runtime caches for hot-path lookups.
Best-effort only; database remains source of truth.
"""

import time
from typing import Optional

from sqlalchemy import text

from app.config import PARTICIPANT_CACHE_TTL_SECONDS

_participant_cache = {}


def get_cached_participant_id(public_id: str) -> Optional[int]:
    item = _participant_cache.get(public_id)
    if not item:
        return None
    participant_id, expires_at = item
    if time.time() > expires_at:
        _participant_cache.pop(public_id, None)
        return None
    return participant_id


def set_cached_participant_id(public_id: str, participant_id: int) -> None:
    if not public_id or not participant_id:
        return
    _participant_cache[public_id] = (
        int(participant_id),
        time.time() + max(1.0, float(PARTICIPANT_CACHE_TTL_SECONDS)),
    )


def resolve_participant_id(db, public_id: str) -> Optional[int]:
    cached = get_cached_participant_id(public_id)
    if cached:
        return cached
    pid = db.execute(text("""
        SELECT id
        FROM participants
        WHERE public_id = :pub AND is_deleted = false
    """), {"pub": public_id}).scalar()
    if pid:
        set_cached_participant_id(public_id, int(pid))
    return int(pid) if pid else None
