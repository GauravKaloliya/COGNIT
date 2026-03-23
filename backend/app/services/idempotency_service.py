import hashlib
import json
import random
from typing import Any, Dict, Optional, Tuple

import logging

from app.config import ERROR_CODES, IDEMPOTENCY_TTL_SECONDS
from app.constants.idempotency_constants import (
    IDEMPOTENCY_DEFAULT_STATUS,
    LOG_IDEMPOTENCY_CONFLICT,
)
from app.utils.observability import log_event
from app.constants.observability_constants import OBS_EVENT_IDEMPOTENCY_CONFLICT
from app.constants.response_keys import (
    RESPONSE_KEY_CODE,
    RESPONSE_KEY_ERROR,
    RESPONSE_KEY_MESSAGE,
    RESPONSE_KEY_PAYLOAD,
    RESPONSE_KEY_STATUS,
    RESPONSE_KEY_STATUS_CODE,
    RESPONSE_KEY_SUCCESS,
)
from app.services.idempotency_query_service import (
    QUERY_DELETE_EXPIRED_IDEMPOTENCY,
    QUERY_LOAD_IDEMPOTENCY_RESPONSE,
    QUERY_SAVE_IDEMPOTENCY_RESPONSE,
)
logger = logging.getLogger(__name__)
IDEMPOTENCY_CONFLICT_ERROR = ERROR_CODES["VAL_IDEMPOTENCY_CONFLICT"]


def build_request_hash(payload: Dict[str, Any]) -> str:
    canonical = json.dumps(payload or {}, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def load_idempotent_response(
    db,
    *,
    endpoint: str,
    idempotency_key: str,
    participant_public_id: Optional[str],
    request_hash: str,
) -> Tuple[Optional[Dict[str, Any]], Optional[Tuple[Any, int]]]:
    if not idempotency_key:
        return None, None

    try:
        row = db.execute(QUERY_LOAD_IDEMPOTENCY_RESPONSE, {
            "endpoint": endpoint,
            "key": idempotency_key,
            "participant_public_id": participant_public_id,
        }).fetchone()
    except Exception:
        return None, None

    if not row:
        return None, None

    existing_hash, status_code, response_body = row
    if existing_hash and existing_hash != request_hash:
        log_event(
            logger,
            OBS_EVENT_IDEMPOTENCY_CONFLICT,
            level=logging.WARNING,
            endpoint=endpoint,
            idempotency_key=(idempotency_key or "")[:16],
            participant_public_id=participant_public_id,
            message=LOG_IDEMPOTENCY_CONFLICT,
        )
        return {
            RESPONSE_KEY_ERROR: {
                RESPONSE_KEY_CODE: IDEMPOTENCY_CONFLICT_ERROR["code"],
                RESPONSE_KEY_MESSAGE: IDEMPOTENCY_CONFLICT_ERROR["message"],
            }
        }, ({
            RESPONSE_KEY_SUCCESS: False,
            RESPONSE_KEY_ERROR: {
                RESPONSE_KEY_CODE: IDEMPOTENCY_CONFLICT_ERROR["code"],
                RESPONSE_KEY_MESSAGE: IDEMPOTENCY_CONFLICT_ERROR["message"],
            }
        }, int(IDEMPOTENCY_CONFLICT_ERROR["status"]))

    if isinstance(response_body, str):
        try:
            response_body = json.loads(response_body)
        except Exception:
            response_body = {RESPONSE_KEY_STATUS: IDEMPOTENCY_DEFAULT_STATUS}

    return {
        RESPONSE_KEY_PAYLOAD: response_body,
        RESPONSE_KEY_STATUS_CODE: int(status_code or 200),
    }, (response_body, int(status_code or 200))


def save_idempotent_response(
    db,
    *,
    endpoint: str,
    idempotency_key: str,
    participant_public_id: Optional[str],
    request_hash: str,
    response_body: Dict[str, Any],
    status_code: int = 200,
) -> None:
    if not idempotency_key:
        return

    try:
        db.execute(QUERY_SAVE_IDEMPOTENCY_RESPONSE, {
            "endpoint": endpoint,
            "key": idempotency_key,
            "participant_public_id": participant_public_id,
            "request_hash": request_hash,
            "response_body": json.dumps(response_body or {}),
            "status_code": int(status_code or 200),
        })
    except Exception:
        return
    if IDEMPOTENCY_TTL_SECONDS > 0 and random.random() < 0.02:
        cleanup_idempotency_keys(db, int(IDEMPOTENCY_TTL_SECONDS))


def cleanup_idempotency_keys(db, ttl_seconds: int) -> None:
    """Best-effort cleanup of expired idempotency keys."""
    if ttl_seconds <= 0:
        return
    try:
        db.execute(QUERY_DELETE_EXPIRED_IDEMPOTENCY, {"ttl_seconds": int(ttl_seconds)})
    except Exception:
        return
