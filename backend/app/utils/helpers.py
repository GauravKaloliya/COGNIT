"""
Helper utilities module for C.O.G.N.I.T. backend.
Provides common helper functions for validation, responses, and audit logging.
"""

import hashlib
import logging
import re
from typing import Any, Optional

from flask import Response, g, has_request_context, jsonify, request
from sqlalchemy import text

from app.config import (
    ERROR_CODES,
    TOO_FAST_SECONDS,
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
    RESPONSE_KEY_KEY,
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
    candidates: list[str] = []
    if TRUST_PROXY_HEADERS:
        candidates.extend([
            request.headers.get("X-Forwarded-For", ""),
            request.headers.get("X-Real-IP", ""),
        ])
        try:
            candidates.extend(list(getattr(request, "access_route", []) or []))
        except Exception:
            pass
    candidates.append(request.remote_addr or "")
    raw_ip = next((str(value).split(",")[0].strip() for value in candidates if str(value or "").strip()), "")
    try:
        import ipaddress
        salt = str(IP_HASH_SALT or "")
        if not salt and not _IP_HASH_SALT_WARNED:
            log_event(logger, OBS_EVENT_IP_HASH_SALT_MISSING, level=logging.WARNING, message=LOG_IP_HASH_SALT_MISSING)
            _IP_HASH_SALT_WARNED = True
        normalized_ip = "__missing_ip__"
        if raw_ip:
            try:
                normalized_ip = str(ipaddress.ip_address(raw_ip))
            except Exception:
                normalized_ip = f"__unparsed__:{raw_ip[:120]}"
        return hashlib.sha256(f"{normalized_ip}{salt}".encode()).hexdigest()
    except Exception:
        fallback_value = raw_ip or "__missing_ip__"
        return hashlib.sha256(fallback_value.encode()).hexdigest()


# ────────────────────────────────────────────────
# Text Processing Utilities
# ────────────────────────────────────────────────

def count_words(text: str) -> int:
    """Count words in text, excluding pure numbers."""
    if not text.strip():
        return 0
    words = re.findall(r"\b\w+\b", text.strip(), re.UNICODE)
    return len([w for w in words if re.search(r"[^\W\d_]", w, re.UNICODE)])


def normalize_submission_text(text: str) -> str:
    """Normalize free-text submission fields without stripping normal punctuation."""
    value = str(text or "")
    value = re.sub(r"[\t\r\n]+", " ", value)
    value = re.sub(r"[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]", "", value)
    value = re.sub(r"[^ \w.]", "", value, flags=re.UNICODE)
    return value.strip()


# ────────────────────────────────────────────────
# Quality Scoring
# ────────────────────────────────────────────────

def calculate_quality_score(
    *,
    writing_quality_score: float,
    behavior_risk_score: float,
    alignment_score: Optional[float],
    attention_trust_score: Optional[float],
    bot: bool = False,
) -> float:
    """
    Calculate the overall quality score from explicit component scores.

    The overall score should be interpretable: writing quality is primary,
    alignment is meaningful, behavioral risk reduces confidence, and attention
    trust is a smaller modifier rather than a hard gate.
    """
    safe_writing = max(0.0, min(1.0, float(writing_quality_score or 0.0)))
    safe_behavior_risk = max(0.0, min(1.0, float(behavior_risk_score or 0.0)))
    safe_alignment = max(0.0, min(1.0, float(alignment_score or 0.0)))
    safe_attention = 1.0 if attention_trust_score is None else max(0.0, min(1.0, float(attention_trust_score)))

    score = (
        0.46 * safe_writing
        + 0.24 * (1.0 - safe_behavior_risk)
        + 0.20 * safe_alignment
        + 0.10 * safe_attention
    )
    if bot:
        score *= 0.3
    return round(max(0.0, min(1.0, score)), 4)


def calculate_writing_quality_score(
    wc: int,
    ts: Optional[float],
    fb_len: int,
    distinct_word_count: Optional[int] = None,
    alignment_score: Optional[float] = None,
) -> float:
    safe_wc = max(0, int(wc or 0))
    safe_fb_len = max(0, int(fb_len or 0))
    safe_distinct = max(0, int(distinct_word_count or 0))
    safe_alignment = max(0.0, min(1.0, float(alignment_score or 0.0)))

    s_word = min(max((safe_wc - 40) / 120.0, 0.0), 1.0)
    s_fb = min(safe_fb_len / 120.0, 1.0)

    if safe_wc > 0:
        lexical_ratio = safe_distinct / float(safe_wc)
        s_lex = min(max((lexical_ratio - 0.25) / 0.40, 0.0), 1.0)
    else:
        s_lex = 0.0

    if ts is None:
        s_time = 0.0
    else:
        try:
            ts_val = max(0.0, float(ts))
        except Exception:
            ts_val = 0.0
        s_time = min(ts_val / 90.0, 1.0)

    score = (
        0.34 * s_word +
        0.24 * s_lex +
        0.16 * s_time +
        0.10 * s_fb +
        0.16 * safe_alignment
    )
    return round(score, 4)


def calculate_behavior_risk_score(
    *,
    attention_suspicious: bool,
    too_fast: bool,
    tab_switch_count: int = 0,
    page_close_attempts: int = 0,
    network_disconnects: int = 0,
    copied_pattern: bool = False,
    behavior_metrics: Optional[dict[str, Any]] = None,
) -> float:
    metrics = behavior_metrics or {}
    tsc = max(0, int(tab_switch_count or 0))
    pca = max(0, int(page_close_attempts or 0))
    nd = max(0, int(network_disconnects or 0))
    edit_count = max(0, int(metrics.get("edit_count", 0) or 0))
    backspace_count = max(0, int(metrics.get("backspace_count", 0) or 0))
    pause_count = max(0, int(metrics.get("pause_count", 0) or 0))
    time_before_typing = max(0.0, float(metrics.get("time_before_typing_seconds", 0.0) or 0.0))

    risk = 0.0
    if attention_suspicious:
        risk += 0.28
    if copied_pattern:
        risk += 0.35
    if too_fast:
        risk += 0.20

    risk += min(0.25, (tsc * 0.01) + (pca * 0.04) + (nd * 0.03))

    if edit_count == 0 and backspace_count == 0 and pause_count == 0 and time_before_typing == 0:
        risk += 0.05
    elif edit_count > 0 or backspace_count > 0 or pause_count > 0:
        risk -= 0.03

    return round(max(0.0, min(1.0, risk)), 4)


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
            "ua": (request.headers.get("User-Agent") or "unknown")[:512],
            "det": details[:8000],
            "rid": getattr(g, "request_id", None) or request.headers.get("X-Request-ID"),
        })
    except Exception as exc:
        log_event(logger, OBS_EVENT_AUDIT_LOG_INSERT_FAILED, level=logging.WARNING, error=str(exc), message=LOG_AUDIT_LOG_INSERT_FAILED)


# ────────────────────────────────────────────────
# Response Helpers
# ────────────────────────────────────────────────

def error_response(error_key: str, **kwargs) -> tuple[Response, int]:
    """Generate strict standardized error response."""
    resolved_key = str(error_key or "SYS_INTERNAL_ERROR")
    if resolved_key not in ERROR_CODES:
        resolved_key = "SYS_INTERNAL_ERROR"
    error_def = ERROR_CODES[resolved_key]
    status = int(error_def.get("status", 500))
    category = error_def.get("category", "SYS")
    retryable = kwargs.get("retryable")
    if retryable is None:
        retryable = status >= 500 or category == "RATE"

    base_message = error_def["message"].format(**kwargs) if kwargs else error_def["message"]
    request_id = getattr(g, "request_id", None)
    error_payload: dict[str, Any] = {
        RESPONSE_KEY_KEY: resolved_key,
        RESPONSE_KEY_CODE: error_def["code"],
        RESPONSE_KEY_MESSAGE: base_message,
        RESPONSE_KEY_CATEGORY: category,
        RESPONSE_KEY_HTTP_STATUS: status,
        RESPONSE_KEY_RETRYABLE: bool(retryable),
        RESPONSE_KEY_REQUEST_ID: request_id,
    }
    response: dict[str, Any] = {
        RESPONSE_KEY_SUCCESS: False,
        RESPONSE_KEY_ERROR: error_payload,
    }
    if "field" in error_def:
        error_payload[RESPONSE_KEY_FIELD] = error_def["field"]
    if "fields" in kwargs and kwargs.get("fields") is not None:
        error_payload[RESPONSE_KEY_FIELDS] = kwargs["fields"]
    if kwargs.get("details"):
        error_payload[RESPONSE_KEY_DETAILS] = kwargs["details"]
    has_request = has_request_context()
    route_rule_obj = getattr(request, "url_rule", None) if has_request else None
    route_rule = route_rule_obj.rule if route_rule_obj is not None else None
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
        error_key=resolved_key,
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
        resp.headers.setdefault("X-COGNIT-Error-Key", str(resolved_key))
        resp.headers.setdefault("X-COGNIT-Error-Code", str(error_def.get("code", "")))
        resp.headers.setdefault("X-COGNIT-Error-Category", str(category))
    except Exception:
        pass
    return resp, 200


def success_response(data: Optional[dict[str, Any]] = None, message: Optional[str] = None) -> Response:
    """Generate standardized success response."""
    response: dict[str, Any] = {RESPONSE_KEY_SUCCESS: True}
    if message:
        response[RESPONSE_KEY_MESSAGE] = message
    if data:
        response[RESPONSE_KEY_DATA] = data
    return jsonify(response)


def create_error_response(
    error_key: str,
    details: Optional[dict[str, Any]] = None,
    **kwargs,
) -> tuple[Response, int]:
    """Project-wide error response helper."""
    return error_response(error_key, details=details, **kwargs)
