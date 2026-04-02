"""
Helper utilities module for C.O.G.N.I.T. backend.
Provides common helper functions for validation, responses, and audit logging.
"""

import hashlib
import logging
import math
import re
from typing import Any, Optional

from flask import Response, g, has_request_context, jsonify, request
from sqlalchemy import text

from app.config import (
    ERROR_CODES,
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

SCORE_KIND_SURVEY = "survey"
SCORE_KIND_ATTENTION = "attention"
ENFORCEMENT_STATUS_NORMAL = "normal"
ENFORCEMENT_STATUS_WATCHLIST = "watchlist"
ENFORCEMENT_STATUS_SOFT_FLAG = "soft_flag"
ENFORCEMENT_STATUS_HARD_FLAG = "hard_flag"

CALIBRATED_EFFORT_BASELINES = {
    SCORE_KIND_SURVEY: {
        "40-59": {
            "edits_per_word": 0.20,
            "backspaces_per_word": 0.024,
            "pauses_per_word": 0.026,
            "revision_bursts_per_word": 0.014,
            "expected_seconds_per_word": 1.28,
            "min_threshold_seconds": 74.0,
        },
        "60-89": {
            "edits_per_word": 0.18,
            "backspaces_per_word": 0.022,
            "pauses_per_word": 0.024,
            "revision_bursts_per_word": 0.013,
            "expected_seconds_per_word": 1.24,
            "min_threshold_seconds": 90.0,
        },
        "90-129": {
            "edits_per_word": 0.17,
            "backspaces_per_word": 0.020,
            "pauses_per_word": 0.022,
            "revision_bursts_per_word": 0.011,
            "expected_seconds_per_word": 1.18,
            "min_threshold_seconds": 106.0,
        },
        "130+": {
            "edits_per_word": 0.16,
            "backspaces_per_word": 0.018,
            "pauses_per_word": 0.020,
            "revision_bursts_per_word": 0.010,
            "expected_seconds_per_word": 1.12,
            "min_threshold_seconds": 122.0,
        },
    },
    SCORE_KIND_ATTENTION: {
        "40-59": {
            "edits_per_word": 0.18,
            "backspaces_per_word": 0.020,
            "pauses_per_word": 0.021,
            "revision_bursts_per_word": 0.012,
            "expected_seconds_per_word": 0.96,
            "min_threshold_seconds": 46.0,
        },
        "60-89": {
            "edits_per_word": 0.17,
            "backspaces_per_word": 0.019,
            "pauses_per_word": 0.020,
            "revision_bursts_per_word": 0.011,
            "expected_seconds_per_word": 0.92,
            "min_threshold_seconds": 58.0,
        },
        "90-129": {
            "edits_per_word": 0.15,
            "backspaces_per_word": 0.017,
            "pauses_per_word": 0.018,
            "revision_bursts_per_word": 0.010,
            "expected_seconds_per_word": 0.88,
            "min_threshold_seconds": 68.0,
        },
        "130+": {
            "edits_per_word": 0.14,
            "backspaces_per_word": 0.016,
            "pauses_per_word": 0.017,
            "revision_bursts_per_word": 0.009,
            "expected_seconds_per_word": 0.84,
            "min_threshold_seconds": 80.0,
        },
    },
}

DEVICE_PROFILE_FACTORS = {
    "desktop": {"telemetry": 1.0, "speed": 1.0},
    "mobile": {"telemetry": 0.82, "speed": 1.16},
    "tablet": {"telemetry": 0.88, "speed": 1.10},
    "unknown": {"telemetry": 0.94, "speed": 1.04},
}

BROWSER_PROFILE_FACTORS = {
    "chrome": {"telemetry": 1.0, "speed": 1.0},
    "edge": {"telemetry": 1.0, "speed": 1.0},
    "safari": {"telemetry": 0.90, "speed": 1.08},
    "firefox": {"telemetry": 1.04, "speed": 1.01},
    "other": {"telemetry": 0.96, "speed": 1.02},
}


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

def word_count_bucket(word_count: int) -> str:
    safe_wc = max(0, int(word_count or 0))
    if safe_wc >= 130:
        return "130+"
    if safe_wc >= 90:
        return "90-129"
    if safe_wc >= 60:
        return "60-89"
    return "40-59"


def infer_browser_profile(user_agent: str | None) -> str:
    ua = str(user_agent or "").lower()
    if "edg/" in ua:
        return "edge"
    if "chrome/" in ua or "crios/" in ua:
        return "chrome"
    if "safari/" in ua and "chrome/" not in ua and "crios/" not in ua:
        return "safari"
    if "firefox/" in ua:
        return "firefox"
    return "other"


def _bounded_unit(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


def _deficit_ratio(actual: float, expected: float) -> float:
    if expected <= 0:
        return 0.0
    return _bounded_unit((expected - max(0.0, actual)) / expected)


def _surplus_ratio(actual: float, baseline: float) -> float:
    if baseline <= 0:
        return 0.0
    return _bounded_unit((max(0.0, actual) - baseline) / baseline)


def calculate_too_fast_metrics(
    *,
    word_count: int,
    time_spent_seconds: float,
    description: str = "",
    behavior_metrics: Optional[dict[str, Any]] = None,
    device_type: str = "unknown",
    user_agent: str = "",
    is_attention: bool = False,
) -> dict[str, Any]:
    metrics = behavior_metrics or {}
    kind = SCORE_KIND_ATTENTION if is_attention else SCORE_KIND_SURVEY
    bucket = word_count_bucket(word_count)
    baseline = CALIBRATED_EFFORT_BASELINES[kind][bucket]
    device_profile = DEVICE_PROFILE_FACTORS.get(str(device_type or "unknown").lower(), DEVICE_PROFILE_FACTORS["unknown"])
    browser_profile = BROWSER_PROFILE_FACTORS.get(infer_browser_profile(user_agent), BROWSER_PROFILE_FACTORS["other"])
    telemetry_factor = device_profile["telemetry"] * browser_profile["telemetry"]
    speed_factor = device_profile["speed"] * browser_profile["speed"]

    safe_word_count = max(1, int(word_count or 0))
    char_count = len(str(description or "").strip())
    edit_count = max(0.0, float(metrics.get("edit_count", 0) or 0.0))
    backspace_count = max(0.0, float(metrics.get("backspace_count", 0) or 0.0))
    pause_count = max(0.0, float(metrics.get("pause_count", 0) or 0.0))
    revision_bursts = max(0.0, float(metrics.get("revision_bursts", 0) or 0.0))
    hesitation_score = _bounded_unit(float(metrics.get("hesitation_score", 0.0) or 0.0))
    time_before_typing = max(0.0, float(metrics.get("time_before_typing_seconds", 0.0) or 0.0))

    edits_per_word = edit_count / safe_word_count
    backspaces_per_word = backspace_count / safe_word_count
    pauses_per_word = pause_count / safe_word_count
    revision_bursts_per_word = revision_bursts / safe_word_count

    expected_seconds = max(
        baseline["min_threshold_seconds"],
        (
            baseline["expected_seconds_per_word"] * safe_word_count
            + min(22.0 if is_attention else 30.0, char_count / 26.0)
            + min(18.0 if is_attention else 26.0, time_before_typing * 0.55)
        ) * speed_factor,
    )

    ratio_deficit = max(
        _deficit_ratio(edits_per_word, baseline["edits_per_word"] * telemetry_factor),
        _deficit_ratio(pauses_per_word, baseline["pauses_per_word"] * telemetry_factor),
    )
    correction_deficit = max(
        _deficit_ratio(backspaces_per_word, baseline["backspaces_per_word"] * telemetry_factor),
        _deficit_ratio(revision_bursts_per_word, baseline["revision_bursts_per_word"] * telemetry_factor),
    )
    actual_seconds = max(0.0, float(time_spent_seconds or 0.0))
    margin_seconds = round(expected_seconds - actual_seconds, 2)
    margin_ratio = _bounded_unit(margin_seconds / max(20.0, expected_seconds))
    improbability = _bounded_unit(
        0.58 * margin_ratio
        + 0.24 * ratio_deficit
        + 0.12 * correction_deficit
        + 0.06 * _deficit_ratio(time_before_typing, 6.0 if is_attention else 10.0)
    )
    return {
        "expected_seconds": round(expected_seconds, 2),
        "margin_seconds": margin_seconds,
        "too_fast_score": round(improbability, 4),
        "flagged_too_fast": bool(margin_seconds > 0 and improbability >= (0.62 if is_attention else 0.60)),
    }


def calculate_behavior_scorecard(
    *,
    attention_suspicious: bool,
    attention_tier: Optional[str],
    tab_switch_count: int = 0,
    page_close_attempts: int = 0,
    network_disconnects: int = 0,
    copied_pattern: bool = False,
    word_count: int = 0,
    behavior_metrics: Optional[dict[str, Any]] = None,
    time_spent_seconds: float = 0.0,
    description: str = "",
    device_type: str = "unknown",
    user_agent: str = "",
) -> dict[str, Any]:
    metrics = behavior_metrics or {}
    safe_word_count = max(1, int(word_count or 0))
    normalized_attention_tier = str(attention_tier or "").strip().lower()
    is_attention = normalized_attention_tier in {"pass", "weak_pass", "suspicious", "fail"} or bool(attention_suspicious)
    kind = SCORE_KIND_ATTENTION if is_attention else SCORE_KIND_SURVEY
    bucket = word_count_bucket(safe_word_count)
    baseline = CALIBRATED_EFFORT_BASELINES[kind][bucket]
    device_profile = DEVICE_PROFILE_FACTORS.get(str(device_type or "unknown").lower(), DEVICE_PROFILE_FACTORS["unknown"])
    browser_profile = BROWSER_PROFILE_FACTORS.get(infer_browser_profile(user_agent), BROWSER_PROFILE_FACTORS["other"])
    telemetry_factor = device_profile["telemetry"] * browser_profile["telemetry"]

    edit_count = max(0.0, float(metrics.get("edit_count", 0) or 0.0))
    backspace_count = max(0.0, float(metrics.get("backspace_count", 0) or 0.0))
    pause_count = max(0.0, float(metrics.get("pause_count", 0) or 0.0))
    revision_bursts = max(0.0, float(metrics.get("revision_bursts", 0) or 0.0))
    hesitation_score = _bounded_unit(float(metrics.get("hesitation_score", 0.0) or 0.0))
    time_before_typing = max(0.0, float(metrics.get("time_before_typing_seconds", 0.0) or 0.0))
    submitted_without_typing_pause = bool(metrics.get("submitted_without_typing_pause", False))

    edits_per_word = edit_count / safe_word_count
    backspaces_per_word = backspace_count / safe_word_count
    pauses_per_word = pause_count / safe_word_count
    revision_bursts_per_word = revision_bursts / safe_word_count

    typing_effort_risk = _bounded_unit(
        0.34 * _deficit_ratio(edits_per_word, baseline["edits_per_word"] * telemetry_factor)
        + 0.20 * _deficit_ratio(backspaces_per_word, baseline["backspaces_per_word"] * telemetry_factor)
        + 0.24 * _deficit_ratio(pauses_per_word, baseline["pauses_per_word"] * telemetry_factor)
        + 0.14 * _deficit_ratio(revision_bursts_per_word, baseline["revision_bursts_per_word"] * telemetry_factor)
        + 0.08 * _deficit_ratio(hesitation_score, 0.28)
    )
    answer_length_vs_edit_effort_mismatch = _bounded_unit(
        _surplus_ratio(safe_word_count, 58.0 if is_attention else 72.0)
        * max(
            _deficit_ratio(edits_per_word, baseline["edits_per_word"] * telemetry_factor),
            _deficit_ratio(pauses_per_word, baseline["pauses_per_word"] * telemetry_factor),
        )
    )
    deliberation_then_dump = _bounded_unit(
        _surplus_ratio(time_before_typing, 10.0 if is_attention else 14.0)
        * max(
            _deficit_ratio(edits_per_word, baseline["edits_per_word"] * telemetry_factor),
            _deficit_ratio(backspaces_per_word, baseline["backspaces_per_word"] * telemetry_factor),
            _deficit_ratio(pauses_per_word, baseline["pauses_per_word"] * telemetry_factor),
        )
    )
    copy_paste_likelihood_score = _bounded_unit(
        0.36 * answer_length_vs_edit_effort_mismatch
        + 0.28 * deliberation_then_dump
        + 0.18 * typing_effort_risk
        + 0.10 * (1.0 if submitted_without_typing_pause else 0.0)
        + 0.08 * (1.0 if copied_pattern else 0.0)
    )

    too_fast_metrics = calculate_too_fast_metrics(
        word_count=safe_word_count,
        time_spent_seconds=time_spent_seconds,
        description=description,
        behavior_metrics=metrics,
        device_type=device_type,
        user_agent=user_agent,
        is_attention=is_attention,
    )
    speed_risk = _bounded_unit(too_fast_metrics["too_fast_score"])
    session_integrity_risk = _bounded_unit(
        min(
            1.0,
            0.45 * min(1.0, max(0, int(tab_switch_count or 0)) / 5.0)
            + 0.35 * min(1.0, max(0, int(page_close_attempts or 0)) / 2.0)
            + 0.20 * min(1.0, max(0, int(network_disconnects or 0)) / 3.0),
        )
    )

    attention_penalty = 0.0
    if normalized_attention_tier == "fail":
        attention_penalty = 0.28
    elif normalized_attention_tier == "suspicious":
        attention_penalty = 0.12
    elif attention_suspicious:
        attention_penalty = 0.08

    behavior_risk_score = _bounded_unit(
        0.30 * typing_effort_risk
        + 0.34 * copy_paste_likelihood_score
        + 0.20 * speed_risk
        + 0.16 * session_integrity_risk
        + attention_penalty
    )

    contradiction_signals: list[str] = []
    if copy_paste_likelihood_score >= 0.72 and speed_risk <= 0.18 and safe_word_count >= 70:
        contradiction_signals.append("copy_paste_likelihood_without_speed_pressure")
    if normalized_attention_tier == "fail":
        contradiction_signals.append("attention_fail_requires_quality_cap")

    return {
        "typing_effort_risk": round(typing_effort_risk, 4),
        "copy_paste_likelihood_score": round(copy_paste_likelihood_score, 4),
        "answer_length_vs_edit_effort_mismatch": round(answer_length_vs_edit_effort_mismatch, 4),
        "deliberation_then_dump": round(deliberation_then_dump, 4),
        "speed_risk": round(speed_risk, 4),
        "session_integrity_risk": round(session_integrity_risk, 4),
        "behavior_risk_score": round(behavior_risk_score, 4),
        "too_fast_score": too_fast_metrics["too_fast_score"],
        "too_fast_threshold_seconds": too_fast_metrics["expected_seconds"],
        "too_fast_margin_seconds": too_fast_metrics["margin_seconds"],
        "flagged_too_fast": too_fast_metrics["flagged_too_fast"],
        "contradiction_signals": contradiction_signals,
    }

def calculate_quality_score(
    *,
    writing_quality_score: float,
    behavior_risk_score: float,
    copy_paste_likelihood_score: float = 0.0,
    alignment_score: Optional[float],
    attention_trust_score: Optional[float],
    attention_tier: Optional[str] = None,
    contradiction_signals: Optional[list[str]] = None,
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
    safe_copy_paste = max(0.0, min(1.0, float(copy_paste_likelihood_score or 0.0)))
    safe_alignment = max(0.0, min(1.0, float(alignment_score or 0.0)))
    safe_attention = 1.0 if attention_trust_score is None else max(0.0, min(1.0, float(attention_trust_score)))
    contradiction_count = len(contradiction_signals or [])

    score = (
        0.40 * safe_writing
        + 0.18 * (1.0 - safe_behavior_risk)
        + 0.16 * safe_alignment
        + 0.22 * safe_attention
        + 0.04 * (1.0 - safe_copy_paste)
    )

    normalized_tier = str(attention_tier or "").strip().lower()
    if normalized_tier == "fail":
        score = min(score, 0.58 if safe_attention < 0.55 else 0.64)
    elif normalized_tier == "suspicious":
        score = min(score, 0.78 if safe_attention >= 0.72 else 0.74)
    elif normalized_tier == "weak_pass":
        score = min(score, 0.88)

    if safe_behavior_risk >= 0.75:
        score = min(score, 0.55)
    elif safe_behavior_risk >= 0.55:
        score = min(score, 0.68)
    elif safe_behavior_risk >= 0.35:
        score = min(score, 0.80)
    if safe_copy_paste >= 0.75:
        score = min(score, 0.60)
    elif safe_copy_paste >= 0.55:
        score = min(score, 0.72)
    if contradiction_count >= 2:
        score = min(score, 0.66)
    elif contradiction_count == 1:
        score = min(score, 0.74)

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
    attention_tier: Optional[str] = None,
    too_fast: bool,
    tab_switch_count: int = 0,
    page_close_attempts: int = 0,
    network_disconnects: int = 0,
    copied_pattern: bool = False,
    word_count: int = 0,
    behavior_metrics: Optional[dict[str, Any]] = None,
    time_spent_seconds: float = 0.0,
    description: str = "",
    device_type: str = "unknown",
    user_agent: str = "",
) -> float:
    scorecard = calculate_behavior_scorecard(
        attention_suspicious=attention_suspicious,
        attention_tier=attention_tier,
        tab_switch_count=tab_switch_count,
        page_close_attempts=page_close_attempts,
        network_disconnects=network_disconnects,
        copied_pattern=copied_pattern,
        word_count=word_count,
        behavior_metrics=behavior_metrics,
        time_spent_seconds=time_spent_seconds,
        description=description,
        device_type=device_type,
        user_agent=user_agent,
    )
    risk = scorecard["behavior_risk_score"]
    if too_fast:
        risk = max(risk, min(1.0, scorecard["speed_risk"] + 0.05))
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
