"""Service helpers for image selection and reservation."""

from __future__ import annotations

import json
import random
import logging
import time
from typing import Any

from app.config import (
    IMAGE_BATCH_SIZE_ATTENTION,
    IMAGE_BATCH_SIZE_SURVEY,
    IMAGE_POOL_CACHE_TTL_SECONDS,
    IMAGE_RESERVATION_CLEANUP_EXPIRES_AT_DEFAULT,
    IMAGE_RESERVATION_TTL_SECONDS,
)
from app.constants.image_constants import (
    IMAGE_POOL_CACHE_KEY,
    POOL_TYPE_ATTENTION,
    POOL_TYPE_SURVEY,
)
from app.services.image_query_service import (
    QUERY_CLEANUP_STALE_RESERVATIONS,
    QUERY_DELETE_UNOWNED_RESERVATIONS,
    QUERY_ENSURE_IMAGE_POOL_ALLOCATION_STATE,
    QUERY_FETCH_ACTIVE_PARTICIPANT_RESERVATION,
    QUERY_LOCK_IMAGE_POOL_ALLOCATION_STATE,
    QUERY_LOAD_IMAGE_POOL,
    QUERY_RELEASE_PARTICIPANT_RESERVATIONS,
    QUERY_RENEW_PARTICIPANT_IMAGE_RESERVATION,
    QUERY_RESERVE_IMAGE,
    QUERY_UPDATE_IMAGE_POOL_ALLOCATION_STATE,
    serialize_image_order,
)
from app.services.image_health_service import load_quarantined_image_ids, is_image_quarantined
from app.utils.cache import cache
from app.utils.observability import log_event
from app.constants.observability_constants import OBS_EVENT_IMAGE_CLEANUP_FAILED, OBS_EVENT_IMAGE_RESERVE_COMMIT_FAILED, OBS_EVENT_IMAGE_RESERVE_FAILED

ImagePoolItem = tuple[Any, str, bool, bool]
IMAGE_RESERVATION_CLEANUP_EXPIRES_AT = IMAGE_RESERVATION_CLEANUP_EXPIRES_AT_DEFAULT

logger = logging.getLogger(__name__)

def load_image_pool(db) -> tuple[list[ImagePoolItem], list[ImagePoolItem], list[ImagePoolItem]]:
    cached = cache.get_json(IMAGE_POOL_CACHE_KEY)
    if cached and isinstance(cached, dict):
        attention_rows = [tuple(item) for item in cached.get("attention_rows", [])]
        non_attention_rows = [tuple(item) for item in cached.get("non_attention_rows", [])]
        all_rows = [tuple(item) for item in cached.get("all_rows", [])]
        if all_rows:
            return attention_rows, non_attention_rows, all_rows

    rows = db.execute(QUERY_LOAD_IMAGE_POOL).fetchall()
    quarantined_image_ids = load_quarantined_image_ids(db)
    attention_rows: list[ImagePoolItem] = []
    non_attention_rows: list[ImagePoolItem] = []
    all_rows: list[ImagePoolItem] = []
    for image_id, image_url, is_attention in rows:
        if not image_url:
            continue
        if str(image_id) in quarantined_image_ids:
            continue
        item = (str(image_id), image_url, True, bool(is_attention))
        all_rows.append(item)
        if is_attention:
            attention_rows.append(item)
        else:
            non_attention_rows.append(item)
    cache.set_json(
        IMAGE_POOL_CACHE_KEY,
        {
            "attention_rows": attention_rows,
            "non_attention_rows": non_attention_rows,
            "all_rows": all_rows,
        },
        ttl_seconds=IMAGE_POOL_CACHE_TTL_SECONDS,
    )
    return attention_rows, non_attention_rows, all_rows


def reserve_image(db, image_id: str, participant_id: int | None, now_ts):
    if participant_id is None:
        return False
    try:
        row = db.execute(QUERY_RESERVE_IMAGE, {"iid": image_id, "pid": participant_id, "now": now_ts}).fetchone()
        if participant_id is not None:
            db.execute(
                QUERY_RELEASE_PARTICIPANT_RESERVATIONS,
                {"pid": int(participant_id), "keep_image_id": str(image_id)},
            )
        return bool(row)
    except Exception as exc:
        log_event(logger, OBS_EVENT_IMAGE_RESERVE_FAILED, level=logging.WARNING, error=str(exc))
        return False


def cleanup_stale_reservations(db, ttl_seconds: int | None = None):
    global IMAGE_RESERVATION_CLEANUP_EXPIRES_AT
    ttl_value = ttl_seconds if ttl_seconds is not None else IMAGE_RESERVATION_TTL_SECONDS
    now = time.time()
    if now < IMAGE_RESERVATION_CLEANUP_EXPIRES_AT:
        return
    try:
        db.execute(QUERY_DELETE_UNOWNED_RESERVATIONS)
        db.execute(QUERY_CLEANUP_STALE_RESERVATIONS)
        IMAGE_RESERVATION_CLEANUP_EXPIRES_AT = now + min(60.0, max(5.0, float(ttl_value) / 4.0))
    except Exception as exc:
        log_event(logger, OBS_EVENT_IMAGE_CLEANUP_FAILED, level=logging.WARNING, error=str(exc))


def fetch_active_reserved_image(db, participant_id: int | None):
    if participant_id is None:
        return None
    row = db.execute(
        QUERY_FETCH_ACTIVE_PARTICIPANT_RESERVATION,
        {"pid": int(participant_id)},
    ).fetchone()
    if not row:
        return None
    reservation = tuple(row)
    if is_image_quarantined(db, reservation[0]):
        return None
    return reservation


def release_participant_reservations(db, participant_id: int | None) -> None:
    if participant_id is None:
        return
    db.execute(
        QUERY_RELEASE_PARTICIPANT_RESERVATIONS,
        {"pid": int(participant_id), "keep_image_id": None},
    )


def renew_participant_image_reservation(
    db,
    *,
    participant_id: int | None,
    image_id: str | None,
    ttl_seconds: int | None = None,
    renewal_window_seconds: int | None = None,
):
    normalized_image_id = str(image_id or "").strip()
    if participant_id is None or not normalized_image_id:
        return None
    if is_image_quarantined(db, normalized_image_id):
        return None

    effective_ttl_seconds = max(900, int(ttl_seconds or IMAGE_RESERVATION_TTL_SECONDS))
    effective_renewal_window_seconds = max(
        60,
        min(
            effective_ttl_seconds,
            int(renewal_window_seconds or max(300, effective_ttl_seconds // 3)),
        ),
    )
    row = db.execute(
        QUERY_RENEW_PARTICIPANT_IMAGE_RESERVATION,
        {
            "pid": int(participant_id),
            "iid": normalized_image_id,
            "ttl_seconds": effective_ttl_seconds,
            "renewal_window_seconds": effective_renewal_window_seconds,
        },
    ).fetchone()
    if not row:
        return None
    return row[0]


def _configured_batch_size_for_pool(pool_type: str) -> int:
    if pool_type == POOL_TYPE_ATTENTION:
        return max(1, int(IMAGE_BATCH_SIZE_ATTENTION))
    return max(1, int(IMAGE_BATCH_SIZE_SURVEY))


def _coerce_image_order(raw_value: Any) -> list[str]:
    if isinstance(raw_value, list):
        return [str(item) for item in raw_value if str(item).strip()]
    if isinstance(raw_value, str):
        try:
            decoded = json.loads(raw_value)
        except Exception:
            return []
        if isinstance(decoded, list):
            return [str(item) for item in decoded if str(item).strip()]
    return []


def _build_new_batch_order(pool_image_ids: list[str], *, batch_size: int) -> list[str]:
    shuffled = list(pool_image_ids)
    random.shuffle(shuffled)
    if batch_size >= len(shuffled):
        return shuffled
    return shuffled[:batch_size]


def _ensure_and_lock_pool_state(db, pool_type: str):
    db.execute(QUERY_ENSURE_IMAGE_POOL_ALLOCATION_STATE, {"pool_type": pool_type})
    return db.execute(
        QUERY_LOCK_IMAGE_POOL_ALLOCATION_STATE,
        {"pool_type": pool_type},
    ).fetchone()


def _refresh_pool_state(*, pool_image_ids: list[str], batch_size: int, batch_number: int) -> tuple[int, int, int, list[str]]:
    next_batch_number = max(0, int(batch_number)) + 1
    image_order = _build_new_batch_order(pool_image_ids, batch_size=batch_size)
    return next_batch_number, 0, batch_size, image_order


def _normalize_pool_state(*, state_row, pool_image_ids: list[str], pool_type: str) -> tuple[int, int, int, list[str], bool]:
    effective_batch_size = min(_configured_batch_size_for_pool(pool_type), len(pool_image_ids))
    valid_ids = set(pool_image_ids)
    batch_number = int(state_row[1] or 0)
    next_index = int(state_row[2] or 0)
    stored_batch_size = int(state_row[3] or 0)
    image_order = []
    seen_ids: set[str] = set()
    for image_id in _coerce_image_order(state_row[4]):
        if image_id not in valid_ids or image_id in seen_ids:
            continue
        image_order.append(image_id)
        seen_ids.add(image_id)

    should_refresh = (
        effective_batch_size <= 0
        or stored_batch_size != effective_batch_size
        or len(image_order) != effective_batch_size
        or next_index < 0
        or next_index > effective_batch_size
        or next_index >= effective_batch_size
    )
    if should_refresh:
        batch_number, next_index, stored_batch_size, image_order = _refresh_pool_state(
            pool_image_ids=pool_image_ids,
            batch_size=effective_batch_size,
            batch_number=batch_number,
        )
        return batch_number, next_index, stored_batch_size, image_order, True

    return batch_number, next_index, stored_batch_size, image_order, False


def _persist_pool_state(
    db,
    *,
    pool_type: str,
    batch_number: int,
    next_index: int,
    batch_size: int,
    image_order: list[str],
) -> None:
    db.execute(
        QUERY_UPDATE_IMAGE_POOL_ALLOCATION_STATE,
        {
            "pool_type": pool_type,
            "batch_number": int(batch_number),
            "next_index": int(next_index),
            "batch_size": int(batch_size),
            "image_order": serialize_image_order(image_order),
        },
    )


def _reserve_next_batch_image(
    db,
    *,
    pool_type: str,
    target_pool: list[ImagePoolItem],
    excluded_set,
    participant_id: int | None,
    now_ts: int,
):
    if participant_id is None or not target_pool:
        return None

    pool_items = {str(item[0]): item for item in target_pool}
    pool_image_ids = list(pool_items.keys())
    state_row = _ensure_and_lock_pool_state(db, pool_type)
    if state_row is None:
        return None

    batch_number, next_index, batch_size, image_order, state_changed = _normalize_pool_state(
        state_row=state_row,
        pool_image_ids=pool_image_ids,
        pool_type=pool_type,
    )

    for refresh_attempt in range(2):
        for candidate_index in range(next_index, batch_size):
            image_public_id = image_order[candidate_index]
            if image_public_id in excluded_set:
                continue
            row = pool_items.get(image_public_id)
            if row is None:
                continue
            if not reserve_image(db, image_public_id, participant_id, now_ts):
                continue

            if candidate_index != next_index:
                image_order[next_index], image_order[candidate_index] = image_order[candidate_index], image_order[next_index]
            next_index += 1
            _persist_pool_state(
                db,
                pool_type=pool_type,
                batch_number=batch_number,
                next_index=next_index,
                batch_size=batch_size,
                image_order=image_order,
            )
            return row

        if refresh_attempt == 0:
            batch_number, next_index, batch_size, image_order = _refresh_pool_state(
                pool_image_ids=pool_image_ids,
                batch_size=min(_configured_batch_size_for_pool(pool_type), len(pool_image_ids)),
                batch_number=batch_number,
            )
            state_changed = True

    if state_changed:
        _persist_pool_state(
            db,
            pool_type=pool_type,
            batch_number=batch_number,
            next_index=next_index,
            batch_size=batch_size,
            image_order=image_order,
        )
    return None


def select_random_image_for_participant(db, *, excluded_set, participant_id: int | None, should_prioritize_attention: bool, now_ts: int):
    if participant_id is None:
        return None
    cleanup_stale_reservations(db)
    active_reserved = fetch_active_reserved_image(db, participant_id)
    if active_reserved:
        is_attention_reserved = bool(active_reserved[3]) if len(active_reserved) > 3 else False
        if is_attention_reserved == bool(should_prioritize_attention):
            return active_reserved
        try:
            release_participant_reservations(db, participant_id)
            db.commit()
        except Exception as exc:
            log_event(logger, OBS_EVENT_IMAGE_RESERVE_COMMIT_FAILED, level=logging.WARNING, error=str(exc))
    attention_pool, non_attention_pool, _all_pool = load_image_pool(db)
    row: ImagePoolItem | None = None
    pool_type = POOL_TYPE_ATTENTION if should_prioritize_attention else POOL_TYPE_SURVEY
    target_pool = attention_pool if should_prioritize_attention else non_attention_pool
    row = _reserve_next_batch_image(
        db,
        pool_type=pool_type,
        target_pool=target_pool,
        excluded_set=excluded_set,
        participant_id=participant_id,
        now_ts=now_ts,
    )
    if row:
        try:
            db.commit()
        except Exception as exc:
            log_event(logger, OBS_EVENT_IMAGE_RESERVE_COMMIT_FAILED, level=logging.WARNING, error=str(exc))
        return row
    return row
