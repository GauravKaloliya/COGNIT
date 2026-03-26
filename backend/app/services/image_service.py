"""Service helpers for image selection and reservation."""

from __future__ import annotations

import random
import logging
import time
from typing import Any

from app.config import (
    IMAGE_PICK_ATTEMPTS_ATTENTION,
    IMAGE_PICK_ATTEMPTS_NON_ATTENTION,
    IMAGE_POOL_CACHE_TTL_SECONDS,
    IMAGE_RESERVATION_TTL_SECONDS,
)
from app.services.image_query_service import (
    QUERY_CLEANUP_STALE_RESERVATIONS,
    QUERY_LOAD_IMAGE_POOL,
    QUERY_RESERVE_IMAGE,
)
from app.utils.cache import cache
from app.utils.observability import log_event
from app.constants.observability_constants import OBS_EVENT_IMAGE_CLEANUP_FAILED, OBS_EVENT_IMAGE_RESERVE_COMMIT_FAILED, OBS_EVENT_IMAGE_RESERVE_FAILED

ImagePoolItem = tuple[Any, str, bool, bool]
IMAGE_RESERVATION_CLEANUP_EXPIRES_AT = 0.0
logger = logging.getLogger(__name__)
IMAGE_POOL_CACHE_KEY = "image_pool:v1"

def load_image_pool(db) -> tuple[list[ImagePoolItem], list[ImagePoolItem], list[ImagePoolItem]]:
    cached = cache.get_json(IMAGE_POOL_CACHE_KEY)
    if cached and isinstance(cached, dict):
        attention_rows = [tuple(item) for item in cached.get("attention_rows", [])]
        non_attention_rows = [tuple(item) for item in cached.get("non_attention_rows", [])]
        all_rows = [tuple(item) for item in cached.get("all_rows", [])]
        if all_rows:
            return attention_rows, non_attention_rows, all_rows

    rows = db.execute(QUERY_LOAD_IMAGE_POOL).fetchall()
    attention_rows: list[ImagePoolItem] = []
    non_attention_rows: list[ImagePoolItem] = []
    all_rows: list[ImagePoolItem] = []
    for image_id, image_url, is_attention in rows:
        if not image_url:
            continue
        item = (image_id, image_url, True, bool(is_attention))
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


def pick_from_pool(rows: list[ImagePoolItem], excluded_set, attempts):
    if not rows:
        return None
    max_attempts = min(max(1, int(attempts)), max(1, len(rows) * 2))
    for _ in range(max_attempts):
        item = random.choice(rows)
        if item[0] in excluded_set:
            continue
        return item
    for item in rows:
        if item[0] not in excluded_set:
            return item
    return None


def reserve_image(db, image_id: str, participant_id: int | None, now_ts):
    try:
        row = db.execute(QUERY_RESERVE_IMAGE, {"iid": image_id, "pid": participant_id, "now": now_ts}).fetchone()
        return bool(row)
    except Exception as exc:
        log_event(logger, OBS_EVENT_IMAGE_RESERVE_FAILED, level=logging.WARNING, error=str(exc))
        return True


def cleanup_stale_reservations(db, ttl_seconds: int | None = None):
    global IMAGE_RESERVATION_CLEANUP_EXPIRES_AT
    ttl_value = ttl_seconds if ttl_seconds is not None else IMAGE_RESERVATION_TTL_SECONDS
    now = time.time()
    if now < IMAGE_RESERVATION_CLEANUP_EXPIRES_AT:
        return
    try:
        db.execute(QUERY_CLEANUP_STALE_RESERVATIONS)
        IMAGE_RESERVATION_CLEANUP_EXPIRES_AT = now + min(60.0, max(5.0, float(ttl_value) / 4.0))
    except Exception as exc:
        log_event(logger, OBS_EVENT_IMAGE_CLEANUP_FAILED, level=logging.WARNING, error=str(exc))


def select_random_image_for_participant(db, *, excluded_set, participant_id: int | None, should_prioritize_attention: bool, now_ts: int):
    cleanup_stale_reservations(db)
    attention_pool, non_attention_pool, all_pool = load_image_pool(db)
    row: ImagePoolItem | None = None
    attempt_limit = max(3, min(10, len(all_pool) or 3))
    for _ in range(attempt_limit):
        if should_prioritize_attention:
            row = pick_from_pool(
                attention_pool,
                excluded_set,
                IMAGE_PICK_ATTEMPTS_ATTENTION,
            )

        if not row:
            row = pick_from_pool(
                non_attention_pool,
                excluded_set,
                IMAGE_PICK_ATTEMPTS_NON_ATTENTION,
            )

        if not row:
            break

        if reserve_image(db, row[0], participant_id, now_ts):
            try:
                db.commit()
            except Exception as exc:
                log_event(logger, OBS_EVENT_IMAGE_RESERVE_COMMIT_FAILED, level=logging.WARNING, error=str(exc))
            return row

        excluded_set.add(row[0])
        row = None
    return row
