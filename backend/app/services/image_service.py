"""Service helpers for image selection and reservation."""

from __future__ import annotations

import random
import time
from typing import Optional
from urllib.parse import unquote, urlparse

from sqlalchemy import text

from app.config import (
    IMAGE_PICK_ATTEMPTS_ATTENTION,
    IMAGE_PICK_ATTEMPTS_NON_ATTENTION,
    IMAGE_PICK_ATTEMPTS_FALLBACK,
    IMAGE_POOL_CACHE_TTL_SECONDS,
    IMAGE_RESERVATION_TTL_SECONDS,
    IMAGE_VALIDATE_URL_AVAILABILITY,
    S3_BUCKET_NAME,
)
from app.extensions import s3


IMAGE_POOL_CACHE = {
    "expires_at": 0.0,
    "attention": [],
    "non_attention": [],
    "all": [],
}
IMAGE_URL_AVAILABILITY_CACHE = {}


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
    except Exception:
        return None


def is_image_url_available(image_url: str) -> bool:
    """Best-effort availability check to avoid returning broken image URLs."""
    if not IMAGE_VALIDATE_URL_AVAILABILITY:
        return bool(image_url)
    if not image_url:
        return False
    now = time.time()
    cached = IMAGE_URL_AVAILABILITY_CACHE.get(image_url)
    if cached and now < cached.get("expires_at", 0):
        return bool(cached.get("ok"))
    key = extract_s3_key_if_cognit_url(image_url)
    if key:
        try:
            s3.head_object(Bucket=S3_BUCKET_NAME, Key=key)
            ok = True
        except Exception:
            ok = False
    else:
        ok = True
    IMAGE_URL_AVAILABILITY_CACHE[image_url] = {
        "ok": bool(ok),
        "expires_at": now + max(60.0, float(IMAGE_POOL_CACHE_TTL_SECONDS)),
    }
    return bool(ok)


def ensure_image_pool_cache(db) -> None:
    now = time.time()
    if now < float(IMAGE_POOL_CACHE["expires_at"]):
        return
    rows = db.execute(text("""
        SELECT
            i.image_id,
            i.url,
            EXISTS (
                SELECT 1
                FROM attention_checks ac
                WHERE ac.image_id = i.id AND ac.is_active = true
            ) AS is_attention
        FROM images i
    """)).fetchall()
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
    IMAGE_POOL_CACHE["attention"] = attention_rows
    IMAGE_POOL_CACHE["non_attention"] = non_attention_rows
    IMAGE_POOL_CACHE["all"] = all_rows
    IMAGE_POOL_CACHE["expires_at"] = now + max(5.0, float(IMAGE_POOL_CACHE_TTL_SECONDS))


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
        row = db.execute(text("""
            INSERT INTO image_reservations (
                image_id, participant_id, reserved_at, expires_at, released_at
            ) VALUES (
                :iid, :pid, :now, :now, NULL
            )
            ON CONFLICT (image_id) DO UPDATE SET
                participant_id = EXCLUDED.participant_id,
                reserved_at = EXCLUDED.reserved_at,
                expires_at = EXCLUDED.expires_at,
                released_at = NULL
            WHERE image_reservations.released_at IS NOT NULL
            RETURNING image_id
        """), {"iid": image_id, "pid": participant_id, "now": now_ts}).fetchone()
        return bool(row)
    except Exception:
        return True


def cleanup_stale_reservations(db, ttl_seconds: int | None = None):
    ttl_value = ttl_seconds if ttl_seconds is not None else IMAGE_RESERVATION_TTL_SECONDS
    try:
        db.execute(text("""
            UPDATE image_reservations
            SET released_at = CURRENT_TIMESTAMP
            WHERE released_at IS NULL
              AND reserved_at <= (CURRENT_TIMESTAMP - (:ttl || ' seconds')::interval)
        """), {"ttl": int(max(60, ttl_value))})
    except Exception:
        pass


def select_random_image_for_participant(db, *, excluded_set, participant_id: int | None, should_prioritize_attention: bool, now_ts: int):
    ensure_image_pool_cache(db)
    cleanup_stale_reservations(db)
    row = None
    attempt_limit = max(3, min(10, len(IMAGE_POOL_CACHE["all"]) or 3))
    for _ in range(attempt_limit):
        if should_prioritize_attention:
            row = pick_from_pool(
                IMAGE_POOL_CACHE["attention"],
                excluded_set,
                IMAGE_PICK_ATTEMPTS_ATTENTION,
            )

        if not row:
            row = pick_from_pool(
                IMAGE_POOL_CACHE["non_attention"],
                excluded_set,
                IMAGE_PICK_ATTEMPTS_NON_ATTENTION,
            )

        if not row and should_prioritize_attention:
            row = pick_from_pool(
                IMAGE_POOL_CACHE["all"],
                excluded_set,
                IMAGE_PICK_ATTEMPTS_FALLBACK,
            )

        if not row:
            break

        if reserve_image(db, row[0], participant_id, now_ts):
            try:
                db.commit()
            except Exception:
                pass
            return row

        excluded_set.add(row[0])
        row = None
    return row
