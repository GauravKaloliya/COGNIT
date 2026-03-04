"""
Image routes module for C.O.G.N.I.T. backend.
Handles random image selection for survey.
"""

import random
import time
from urllib.parse import unquote, urlparse

from flask import request
from sqlalchemy import text

from app.database import get_db
from app.utils.helpers import create_error_response, success_response
from app.utils.decorators import track_performance
from app.utils.runtime_cache import resolve_participant_id
from app.config import ATTENTION_INTERVAL
from app.config import S3_BUCKET_NAME
from app.config import (
    IMAGE_PICK_ATTEMPTS_ATTENTION,
    IMAGE_PICK_ATTEMPTS_NON_ATTENTION,
    IMAGE_PICK_ATTEMPTS_FALLBACK,
    IMAGE_VALIDATE_URL_AVAILABILITY,
    IMAGE_POOL_CACHE_TTL_SECONDS,
)
from app.extensions import s3


# ────────────────────────────────────────────────
# Blueprint Setup
# ────────────────────────────────────────────────

from flask import Blueprint
image_bp = Blueprint('image', __name__)
_IMAGE_POOL_CACHE = {
    "expires_at": 0.0,
    "attention": [],
    "non_attention": [],
    "all": [],
}


# ────────────────────────────────────────────────
# Routes
# ────────────────────────────────────────────────

def _extract_s3_key_if_cognit_url(image_url: str):
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


def _is_image_url_available(image_url: str) -> bool:
    """Best-effort availability check to avoid returning broken image URLs."""
    if not IMAGE_VALIDATE_URL_AVAILABILITY:
        return bool(image_url)
    key = _extract_s3_key_if_cognit_url(image_url)
    if key:
        try:
            s3.head_object(Bucket=S3_BUCKET_NAME, Key=key)
            return True
        except Exception:
            return False
    return bool(image_url)


def _ensure_image_pool_cache(db):
    now = time.time()
    if now < float(_IMAGE_POOL_CACHE["expires_at"]):
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
    for row in rows:
        image_id, image_url, is_attention = row
        if not _is_image_url_available(image_url):
            continue
        item = (image_id, image_url, True, bool(is_attention))
        all_rows.append(item)
        if is_attention:
            attention_rows.append(item)
        else:
            non_attention_rows.append(item)
    _IMAGE_POOL_CACHE["attention"] = attention_rows
    _IMAGE_POOL_CACHE["non_attention"] = non_attention_rows
    _IMAGE_POOL_CACHE["all"] = all_rows
    _IMAGE_POOL_CACHE["expires_at"] = now + max(5.0, float(IMAGE_POOL_CACHE_TTL_SECONDS))


def _pick_from_pool(rows, excluded_set, attempts):
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


@image_bp.route("/images/random")
@track_performance
def random_image():
    """Get a random image with deterministic attention-check placement."""
    exclude = request.args.get("exclude", "")
    excluded = [x.strip() for x in exclude.split(",") if x.strip()]
    excluded_set = set(excluded)
    public_id = (request.args.get("public_id") or "").strip()

    try:
        db = get_db()
        if ATTENTION_INTERVAL <= 0:
            raise ValueError("ATTENTION_INTERVAL must be > 0")

        should_prioritize_attention = False
        if public_id:
            participant_id = resolve_participant_id(db, public_id)
            if participant_id:
                total_submissions = db.execute(text("""
                    SELECT COUNT(*) FROM submissions
                    WHERE participant_id = :pid
                """), {"pid": participant_id}).scalar() or 0
                should_prioritize_attention = ((total_submissions + 1) % ATTENTION_INTERVAL) == 0

        _ensure_image_pool_cache(db)

        row = None
        if should_prioritize_attention:
            row = _pick_from_pool(
                _IMAGE_POOL_CACHE["attention"],
                excluded_set,
                IMAGE_PICK_ATTEMPTS_ATTENTION,
            )

        if not row:
            row = _pick_from_pool(
                _IMAGE_POOL_CACHE["non_attention"],
                excluded_set,
                IMAGE_PICK_ATTEMPTS_NON_ATTENTION,
            )

        if not row and should_prioritize_attention:
            row = _pick_from_pool(
                _IMAGE_POOL_CACHE["all"],
                excluded_set,
                IMAGE_PICK_ATTEMPTS_FALLBACK,
            )

        if not row:
            return create_error_response("INTERNAL_ERROR")

        return success_response({
            "image_id": row[0],
            "url": row[1],
            "is_survey": bool(row[2]) if len(row) > 2 else True,
            "is_attention_check": bool(row[3]) if len(row) > 3 else False,
        })
    except Exception as e:
        print(f"[ERROR] random_image failed: {e}", flush=True)
        return create_error_response("DATABASE_ERROR")
