"""Service helpers for image selection and reservation."""

from __future__ import annotations

import random
import logging
import time
from typing import Optional
from urllib.parse import unquote, urlparse

from app.config import (
    IMAGE_PICK_ATTEMPTS_ATTENTION,
    IMAGE_PICK_ATTEMPTS_NON_ATTENTION,
    IMAGE_POOL_CACHE_TTL_SECONDS,
    IMAGE_RESERVATION_TTL_SECONDS,
    IMAGE_VALIDATE_URL_AVAILABILITY,
    S3_BUCKET_NAME,
)
from app.extensions import s3
from app.services.image_query_service import (
    QUERY_CLEANUP_STALE_RESERVATIONS,
    QUERY_LOAD_IMAGE_POOL,
    QUERY_RESERVE_IMAGE,
)
from app.utils.observability import log_event
from app.constants.observability_constants import OBS_EVENT_IMAGE_CLEANUP_FAILED, OBS_EVENT_IMAGE_EXTRACT_KEY_FAILED, OBS_EVENT_IMAGE_RESERVE_COMMIT_FAILED, OBS_EVENT_IMAGE_RESERVE_FAILED, OBS_EVENT_IMAGE_URL_HEAD_FAILED

IMAGE_POOL_CACHE_KEY_EXPIRES_AT = "expires_at"
IMAGE_POOL_CACHE_KEY_ATTENTION = "attention"
IMAGE_POOL_CACHE_KEY_NON_ATTENTION = "non_attention"
IMAGE_POOL_CACHE_KEY_ALL = "all"
IMAGE_CACHE_KEY_OK = "ok"
IMAGE_POOL_CACHE = {
    IMAGE_POOL_CACHE_KEY_EXPIRES_AT: 0.0,
    IMAGE_POOL_CACHE_KEY_ATTENTION: [],
    IMAGE_POOL_CACHE_KEY_NON_ATTENTION: [],
    IMAGE_POOL_CACHE_KEY_ALL: [],
}
IMAGE_URL_AVAILABILITY_CACHE = {}
logger = logging.getLogger(__name__)


def extract_s3_key_if_cognit_url(image_url: str) -> Optional[str]:
    """Return S3 object key when URL points to configured bucket, else None."""
    if not image_url:
        return None
    try:
        parsed = urlparse(image_url)
        if parsed.scheme not in ("http", "https"):
            return None
        if parsed.netloc.startswith(f"{S3_BUCKET_NAME}.s3"):
            return unquote(parsed.path.lstrip("/"))
        return None
    except Exception as exc:
        log_event(logger, OBS_EVENT_IMAGE_EXTRACT_KEY_FAILED, level=logging.WARNING, error=str(exc))
        return None


def is_image_url_available(image_url: str) -> bool:
    """Best-effort availability check to avoid returning broken image URLs."""
    if not IMAGE_VALIDATE_URL_AVAILABILITY:
        return bool(image_url)
    if not image_url:
        return False
    now = time.time()
    cached = IMAGE_URL_AVAILABILITY_CACHE.get(image_url)
    if cached and now < cached.get(IMAGE_POOL_CACHE_KEY_EXPIRES_AT, 0):
        return bool(cached.get(IMAGE_CACHE_KEY_OK))
    key = extract_s3_key_if_cognit_url(image_url)
    if key:
        try:
            s3.head_object(Bucket=S3_BUCKET_NAME, Key=key)
            ok = True
        except Exception as exc:
            log_event(logger, OBS_EVENT_IMAGE_URL_HEAD_FAILED, level=logging.WARNING, error=str(exc))
            ok = False
    else:
        ok = True
    IMAGE_URL_AVAILABILITY_CACHE[image_url] = {
        IMAGE_CACHE_KEY_OK: bool(ok),
        IMAGE_POOL_CACHE_KEY_EXPIRES_AT: now + max(60.0, float(IMAGE_POOL_CACHE_TTL_SECONDS)),
    }
    return bool(ok)


def ensure_image_pool_cache(db) -> None:
    now = time.time()
    if now < float(IMAGE_POOL_CACHE[IMAGE_POOL_CACHE_KEY_EXPIRES_AT]):
        return
    rows = db.execute(QUERY_LOAD_IMAGE_POOL).fetchall()
    attention_rows = []
    non_attention_rows = []
    all_rows = []
    for image_id, image_url, is_attention in rows:
        if not is_image_url_available(image_url):
            continue
        item = (image_id, image_url, True, bool(is_attention))
        all_rows.append(item)
        if is_attention:
            attention_rows.append(item)
        else:
            non_attention_rows.append(item)
    IMAGE_POOL_CACHE[IMAGE_POOL_CACHE_KEY_ATTENTION] = attention_rows
    IMAGE_POOL_CACHE[IMAGE_POOL_CACHE_KEY_NON_ATTENTION] = non_attention_rows
    IMAGE_POOL_CACHE[IMAGE_POOL_CACHE_KEY_ALL] = all_rows
    IMAGE_POOL_CACHE[IMAGE_POOL_CACHE_KEY_EXPIRES_AT] = now + max(5.0, float(IMAGE_POOL_CACHE_TTL_SECONDS))


def pick_from_pool(rows, excluded_set, attempts):
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
    ttl_value = ttl_seconds if ttl_seconds is not None else IMAGE_RESERVATION_TTL_SECONDS
    try:
        db.execute(QUERY_CLEANUP_STALE_RESERVATIONS, {"ttl": int(max(60, ttl_value))})
    except Exception as exc:
        log_event(logger, OBS_EVENT_IMAGE_CLEANUP_FAILED, level=logging.WARNING, error=str(exc))


def select_random_image_for_participant(db, *, excluded_set, participant_id: int | None, should_prioritize_attention: bool, now_ts: int, force_attention: bool = False):
    ensure_image_pool_cache(db)
    cleanup_stale_reservations(db)
    row = None
    attempt_limit = max(3, min(10, len(IMAGE_POOL_CACHE[IMAGE_POOL_CACHE_KEY_ALL]) or 3))
    for _ in range(attempt_limit):
        if force_attention or should_prioritize_attention:
            row = pick_from_pool(
                IMAGE_POOL_CACHE[IMAGE_POOL_CACHE_KEY_ATTENTION],
                excluded_set,
                IMAGE_PICK_ATTEMPTS_ATTENTION,
            )

        if force_attention:
            # When forced, do not fall back to non-attention images.
            if not row:
                break
        elif not row:
            row = pick_from_pool(
                IMAGE_POOL_CACHE[IMAGE_POOL_CACHE_KEY_NON_ATTENTION],
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
