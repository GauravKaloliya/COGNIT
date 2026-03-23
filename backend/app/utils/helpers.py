"""
Helper utilities module for C.O.G.N.I.T. backend.
Provides common helper functions for validation, responses, and audit logging.
"""

import hashlib
import logging
import re
from typing import Any, Dict, Optional, Tuple

from flask import g, has_request_context, jsonify, request
from sqlalchemy import text

from app.config import (
    ERROR_CODES,
    TOO_FAST_SECONDS,
    ALLOWED_IMAGE_EXTENSIONS,
    CONTENT_TYPE_MAP,
    ENABLE_AUDIT_LOGGING,
    IP_HASH_SALT,
    TRUST_PROXY_HEADERS,
)
from app.constants.response_keys import (
    RESPONSE_KEY_CATEGORY,
    RESPONSE_KEY_CODE,
    RESPONSE_KEY_DATA,
    RESPONSE_KEY_DETAILS,
    RESPONSE_KEY_ERROR,
    RESPONSE_KEY_FIELD,
    RESPONSE_KEY_FIELDS,
    RESPONSE_KEY_HTTP_STATUS,
    RESPONSE_KEY_MESSAGE,
    RESPONSE_KEY_REQUEST_ID,
    RESPONSE_KEY_RETRYABLE,
    RESPONSE_KEY_SUCCESS,
)
from app.constants.log_messages import LOG_AUDIT_LOG_INSERT_FAILED, LOG_IP_HASH_SALT_MISSING
from app.constants.observability_constants import OBS_EVENT_AUDIT_LOG_INSERT_FAILED, OBS_EVENT_IP_HASH_SALT_MISSING
from app.utils.observability import log_event
from app.constants.observability_constants import OBS_EVENT_APP_ERROR_RESPONSE

logger = logging.getLogger(__name__)
_IP_HASH_SALT_WARNED = False


# ────────────────────────────────────────────────
# IP Hash Utility
# ────────────────────────────────────────────────

def get_ip_hash() -> str:
    """Generate SHA256 hash of client IP address for privacy-preserving logging."""
    global _IP_HASH_SALT_WARNED
    raw_ip = request.remote_addr or "unknown"
    if TRUST_PROXY_HEADERS:
        raw_ip = request.headers.get("X-Forwarded-For", raw_ip)
    ip = str(raw_ip).split(",")[0].strip()
    if ip in ("", "unknown"):
        return "0" * 64
    try:
        import ipaddress
        salt = str(IP_HASH_SALT or "")
        if not salt and not _IP_HASH_SALT_WARNED:
            log_event(logger, OBS_EVENT_IP_HASH_SALT_MISSING, level=logging.WARNING, message=LOG_IP_HASH_SALT_MISSING)
            _IP_HASH_SALT_WARNED = True
        return hashlib.sha256(f"{ipaddress.ip_address(ip)}{salt}".encode()).hexdigest()
    except Exception:
        return "0" * 64


# ────────────────────────────────────────────────
# Text Processing Utilities
# ────────────────────────────────────────────────

def count_words(text: str) -> int:
    """Count words in text, excluding pure numbers."""
    if not text.strip():
        return 0
    words = re.findall(r"\b\w+\b", text.strip(), re.UNICODE)
    return len([w for w in words if re.search(r"[^\W\d_]", w, re.UNICODE)])


# ────────────────────────────────────────────────
# Quality Scoring
# ────────────────────────────────────────────────

def calculate_quality_score(
    wc: int, 
    att: Optional[bool], 
    ts: Optional[float], 
    fb_len: int, 
    bot: bool,
    distinct_word_count: Optional[int] = None,
    tab_switch_count: int = 0,
    page_close_attempts: int = 0,
    network_disconnects: int = 0,
    too_fast_threshold: float = TOO_FAST_SECONDS,
) -> float:
    """
    Calculate submission quality score based on writing quality and behavior signals.
    """
    safe_wc = max(0, int(wc or 0))
    safe_fb_len = max(0, int(fb_len or 0))
    safe_distinct = max(0, int(distinct_word_count or 0))

    s_word = min(max((safe_wc - 40) / 140.0, 0.0), 1.0)
    s_att = 1.0 if att is None else (1.0 if bool(att) else 0.0)
    s_fb = min(safe_fb_len / 120.0, 1.0)

    if ts is None:
        s_time = 0.0
    else:
        try:
            ts_val = max(0.0, float(ts))
        except Exception:
            ts_val = 0.0
        time_target = max(float(too_fast_threshold or TOO_FAST_SECONDS), 1.0) * 3.0
        s_time = min(ts_val / time_target, 1.0)

    if safe_wc > 0:
        lexical_ratio = safe_distinct / float(safe_wc)
        s_lex = min(max((lexical_ratio - 0.25) / 0.45, 0.0), 1.0)
    else:
        s_lex = 0.0

    tsc = max(0, int(tab_switch_count or 0))
    pca = max(0, int(page_close_attempts or 0))
    nd = max(0, int(network_disconnects or 0))
    engagement_penalty = min(0.25, (tsc * 0.01) + (pca * 0.03) + (nd * 0.02))
    s_engagement = 1.0 - engagement_penalty

    score = (
        0.32 * s_word +
        0.18 * s_lex +
        0.20 * s_att +
        0.15 * s_time +
        0.10 * s_fb +
        0.05 * s_engagement
    )
    if bot:
        score *= 0.3
    return round(score, 4)


# ────────────────────────────────────────────────
# Audit Logging
# ────────────────────────────────────────────────

def log_audit(
    db,
    event_type: str,
    participant_id: Optional[int] = None,
    details: str = "",
    status_code: Optional[int] = 200,
):
    """Log an audit event to the database."""
    if not ENABLE_AUDIT_LOGGING:
        return
    try:
        db.execute(text("""
            INSERT INTO audit_log (
                event_type, participant_id, endpoint, http_method,
                status_code, ip_hash, user_agent, details, request_id
            ) VALUES (:ev, :pid, :ep, :meth, :st, :iph, :ua, :det, :rid)
        """), {
            "ev": event_type,
            "pid": participant_id,
            "ep": request.path,
            "meth": request.method,
            "st": int(status_code) if status_code is not None else 200,
            "iph": get_ip_hash(),
            "ua": request.headers.get("User-Agent", "")[:512],
            "det": details[:8000],
            "rid": getattr(g, "request_id", None),
        })
    except Exception as exc:
        log_event(logger, OBS_EVENT_AUDIT_LOG_INSERT_FAILED, level=logging.WARNING, error=str(exc), message=LOG_AUDIT_LOG_INSERT_FAILED)


# ────────────────────────────────────────────────
# Response Helpers
# ────────────────────────────────────────────────

def error_response(error_key: str, **kwargs) -> Tuple[Any, int]:
    """Generate strict standardized error response."""
    error_def = ERROR_CODES.get(error_key, ERROR_CODES["SYS_INTERNAL_ERROR"])
    status = int(error_def.get("status", 500))
    category = error_def.get("category", "SYS")
    retryable = kwargs.get("retryable")
    if retryable is None:
        retryable = status >= 500 or category in {"RATE", "PAY"}

    base_message = error_def["message"].format(**kwargs) if kwargs else error_def["message"]
    request_id = getattr(g, "request_id", None)
    response = {
        RESPONSE_KEY_SUCCESS: False,
        RESPONSE_KEY_ERROR: {
            RESPONSE_KEY_CODE: error_def["code"],
            RESPONSE_KEY_MESSAGE: base_message,
            RESPONSE_KEY_CATEGORY: category,
            RESPONSE_KEY_HTTP_STATUS: status,
            RESPONSE_KEY_RETRYABLE: bool(retryable),
            RESPONSE_KEY_REQUEST_ID: request_id,
        }
    }
    if "field" in error_def:
        response[RESPONSE_KEY_ERROR][RESPONSE_KEY_FIELD] = error_def["field"]
    if "fields" in kwargs and kwargs.get("fields") is not None:
        response[RESPONSE_KEY_ERROR][RESPONSE_KEY_FIELDS] = kwargs["fields"]
    if kwargs.get("details"):
        response[RESPONSE_KEY_ERROR][RESPONSE_KEY_DETAILS] = kwargs["details"]
    has_request = has_request_context()
    route_rule = getattr(request, "url_rule", None).rule if has_request and getattr(request, "url_rule", None) else None
    path = request.path if has_request else None
    method = request.method if has_request else None
    vercel_id = request.headers.get("x-vercel-id") if has_request else None
    origin = request.headers.get("Origin") if has_request else None
    referer = request.headers.get("Referer") if has_request else None
    log_event(
        logger,
        OBS_EVENT_APP_ERROR_RESPONSE,
        level=logging.WARNING if status < 500 else logging.ERROR,
        request_id=request_id,
        method=method,
        path=path,
        route=route_rule or path,
        error_key=error_key,
        error_code=error_def.get("code"),
        error_status=status,
        error_category=category,
        retryable=bool(retryable),
        field=error_def.get("field"),
        vercel_id=vercel_id,
        origin=origin,
        referer=referer,
    )
    # Always return HTTP 200 to avoid browser console noise for expected business errors.
    # Clients must use `error.http_status` (and `error.code`) to drive behavior.
    resp = jsonify(response)
    try:
        resp.headers.setdefault("X-COGNIT-Error-Status", str(status))
        resp.headers.setdefault("X-COGNIT-Error-Code", str(error_def.get("code", "")))
        resp.headers.setdefault("X-COGNIT-Error-Category", str(category))
    except Exception:
        pass
    return resp, 200


def success_response(data: Optional[Dict] = None, message: Optional[str] = None):
    """Generate standardized success response."""
    response = {RESPONSE_KEY_SUCCESS: True}
    if message:
        response[RESPONSE_KEY_MESSAGE] = message
    if data:
        response[RESPONSE_KEY_DATA] = data
    return jsonify(response)


def create_error_response(
    error_key: str, 
    details: Optional[dict] = None, 
    **kwargs,
) -> Tuple[Any, int]:
    """Project-wide error response helper."""
    return error_response(error_key, details=details, **kwargs)


# ────────────────────────────────────────────────
# File Validation Utilities
# ────────────────────────────────────────────────

def get_file_extension(filename: str) -> str:
    """Extract file extension from filename."""
    if not filename:
        return ""
    return filename.split('.')[-1].lower() if '.' in filename else ""


def validate_image_extension(filename: str) -> Tuple[bool, str, str]:
    """
    Validate image file extension.
    
    Returns:
        Tuple of (is_valid, extension, content_type)
    """
    ext = get_file_extension(filename)
    if ext not in ALLOWED_IMAGE_EXTENSIONS:
        return False, ext, ""
    return True, ext, CONTENT_TYPE_MAP.get(ext, "image/jpeg")
