"""Server-side health tracking for survey image delivery reliability."""

from __future__ import annotations

import json
import logging
from typing import Any

from app.config import (
    IMAGE_DELIVERY_FAILURE_QUARANTINE_THRESHOLD,
    IMAGE_DELIVERY_FAILURE_WINDOW_SECONDS,
    IMAGE_DELIVERY_QUARANTINE_SECONDS,
)
from app.constants.image_constants import IMAGE_POOL_CACHE_KEY
from app.constants.observability_constants import (
    OBS_EVENT_IMAGE_HEALTH_MARK_FAILED,
    OBS_EVENT_IMAGE_HEALTH_QUERY_FAILED,
)
from app.services.image_query_service import (
    QUERY_IMAGE_DELIVERY_HEALTH_TABLE_EXISTS,
    QUERY_IS_IMAGE_QUARANTINED,
    QUERY_LOAD_QUARANTINED_IMAGE_IDS,
    QUERY_MARK_IMAGE_DELIVERY_SUCCESS,
    QUERY_RECORD_IMAGE_DELIVERY_FAILURE,
)
from app.utils.cache import cache
from app.utils.observability import log_event

logger = logging.getLogger(__name__)


def _normalize_image_public_id(image_public_id: str | None) -> str:
    return str(image_public_id or "").strip()[:64]


def _safe_json_payload(value: Any) -> str:
    payload = value if isinstance(value, dict) else {}
    return json.dumps(payload, separators=(",", ":"), ensure_ascii=True)


def image_health_table_exists(db) -> bool:
    try:
        return bool(db.execute(QUERY_IMAGE_DELIVERY_HEALTH_TABLE_EXISTS).scalar())
    except Exception as exc:
        log_event(logger, OBS_EVENT_IMAGE_HEALTH_QUERY_FAILED, level=logging.WARNING, error=str(exc))
        return False


def load_quarantined_image_ids(db) -> set[str]:
    if not image_health_table_exists(db):
        return set()
    try:
        rows = db.execute(QUERY_LOAD_QUARANTINED_IMAGE_IDS).fetchall()
    except Exception as exc:
        log_event(logger, OBS_EVENT_IMAGE_HEALTH_QUERY_FAILED, level=logging.WARNING, error=str(exc))
        return set()
    return {str(row[0]) for row in rows if row and str(row[0]).strip()}


def is_image_quarantined(db, image_public_id: str | None) -> bool:
    normalized_image_id = _normalize_image_public_id(image_public_id)
    if not normalized_image_id or not image_health_table_exists(db):
        return False
    try:
        row = db.execute(QUERY_IS_IMAGE_QUARANTINED, {"iid": normalized_image_id}).fetchone()
    except Exception as exc:
        log_event(logger, OBS_EVENT_IMAGE_HEALTH_QUERY_FAILED, level=logging.WARNING, error=str(exc))
        return False
    return row is not None


def record_image_delivery_failure(
    db,
    *,
    image_public_id: str | None,
    failure_reason: str,
    request_id: str | None = None,
    route: str | None = None,
    failure_meta: dict[str, Any] | None = None,
) -> bool:
    normalized_image_id = _normalize_image_public_id(image_public_id)
    if not normalized_image_id or not image_health_table_exists(db):
        return False
    try:
        db.execute(
            QUERY_RECORD_IMAGE_DELIVERY_FAILURE,
            {
                "iid": normalized_image_id,
                "failure_reason": str(failure_reason or "unknown").strip()[:64] or "unknown",
                "request_id": str(request_id or "").strip()[:128] or None,
                "route": str(route or "").strip()[:255] or None,
                "failure_meta": _safe_json_payload(failure_meta),
                "window_seconds": int(IMAGE_DELIVERY_FAILURE_WINDOW_SECONDS),
                "threshold": int(IMAGE_DELIVERY_FAILURE_QUARANTINE_THRESHOLD),
                "quarantine_seconds": int(IMAGE_DELIVERY_QUARANTINE_SECONDS),
            },
        )
        cache.delete(IMAGE_POOL_CACHE_KEY)
        return True
    except Exception as exc:
        log_event(
            logger,
            OBS_EVENT_IMAGE_HEALTH_MARK_FAILED,
            level=logging.WARNING,
            image_id=normalized_image_id,
            failure_reason=str(failure_reason or "unknown")[:64],
            error=str(exc),
        )
        return False


def mark_image_delivery_success(db, *, image_public_id: str | None) -> bool:
    normalized_image_id = _normalize_image_public_id(image_public_id)
    if not normalized_image_id or not image_health_table_exists(db):
        return False
    try:
        db.execute(QUERY_MARK_IMAGE_DELIVERY_SUCCESS, {"iid": normalized_image_id})
        cache.delete(IMAGE_POOL_CACHE_KEY)
        return True
    except Exception as exc:
        log_event(
            logger,
            OBS_EVENT_IMAGE_HEALTH_MARK_FAILED,
            level=logging.WARNING,
            image_id=normalized_image_id,
            error=str(exc),
        )
        return False


def capture_client_image_failure_signal(db, *, payload: dict[str, Any] | None, request_id: str | None = None) -> bool:
    safe_payload = payload if isinstance(payload, dict) else {}
    tag = str(safe_payload.get("tag") or "").strip()
    if not tag.startswith("survey_image_load_failed:"):
        return False

    meta = safe_payload.get("meta")
    safe_meta = meta if isinstance(meta, dict) else {}
    image_public_id = (
        str(safe_meta.get("surveyImageId") or safe_meta.get("imageId") or "").strip()
    )
    if not image_public_id:
        return False

    failure_reason = tag.split(":", 1)[1].strip() or "unknown"
    return record_image_delivery_failure(
        db,
        image_public_id=image_public_id,
        failure_reason=failure_reason,
        request_id=request_id or safe_payload.get("request_id"),
        route=safe_payload.get("route"),
        failure_meta=safe_meta,
    )
