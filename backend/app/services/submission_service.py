import re
import logging
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from sqlalchemy import text

from app.constants.event_constants import AUDIT_EVENT_SUBMISSION, DOMAIN_EVENT_SUBMISSION_SAVED, HTTP_METHOD_POST
from app.constants.route_constants import SUBMIT_ROUTE
from app.constants.submission_patterns import (
    ALPHABETIC_TOKEN_RE,
    ATTN_TOKEN_SPLIT_RE,
    NORMALIZE_NON_ALNUM_RE,
    NORMALIZE_WHITESPACE_RE,
    STRICT_TERM_TEMPLATE,
)
from app.constants.observability_constants import (
    OBS_EVENT_SUBMISSION_POST_COMMIT_ENQUEUE_FAILED,
    OBS_EVENT_SUBMISSION_POST_COMMIT_FAILED,
)
from app.config import (
    ASYNC_EXECUTOR_WORKERS_SUBMISSION_POST_COMMIT,
    SUBMISSION_POST_COMMIT_ASYNC_BASE_BACKOFF_MS,
    SUBMISSION_POST_COMMIT_ASYNC_MAX_BACKOFF_MS,
    SUBMISSION_POST_COMMIT_ASYNC_MAX_ATTEMPTS,
)
from app.utils.observability import log_event

SUBMIT_POST_COMMIT_EXECUTOR = ThreadPoolExecutor(
    max_workers=ASYNC_EXECUTOR_WORKERS_SUBMISSION_POST_COMMIT,
    thread_name_prefix="submit-post-commit",
)
logger = logging.getLogger(__name__)


def _bounded_backoff(attempt: int, base_backoff_ms: int, max_backoff_ms: int) -> float:
    exponent = max(0, int(attempt) - 1)
    delay_ms = min(int(max_backoff_ms), int(base_backoff_ms) * (2 ** exponent))
    return max(0.05, delay_ms / 1000.0)


def safe_non_negative_int(value, default: int = 0) -> int:
    try:
        parsed = int(value)
        return parsed if parsed >= 0 else default
    except Exception:
        return default


def clamp_time_spent_seconds(value) -> float:
    if value is None:
        return 0.0
    try:
        parsed = float(value)
        return parsed if parsed >= 0 else 0.0
    except Exception:
        return 0.0


def normalize_engagement_counts(
    payload: dict[str, Any],
    fallback: dict[str, Any] | None = None,
) -> dict[str, int]:
    fallback = fallback or {}
    tab_switch_count = safe_non_negative_int(payload.get("tab_switch_count"), 0)
    page_close_attempts = safe_non_negative_int(payload.get("page_close_attempts"), 0)
    network_disconnects = safe_non_negative_int(payload.get("network_disconnects"), 0)

    if tab_switch_count == 0 and page_close_attempts == 0 and network_disconnects == 0:
        tab_switch_count = safe_non_negative_int(fallback.get("tab_switches"), 0)
        page_close_attempts = safe_non_negative_int(fallback.get("page_close_attempts"), 0)
        network_disconnects = safe_non_negative_int(fallback.get("network_disconnects"), 0)

    return {
        "tab_switch_count": tab_switch_count,
        "page_close_attempts": page_close_attempts,
        "network_disconnects": network_disconnects,
    }


def dynamic_too_fast_threshold(base_threshold: float, word_count: int) -> float:
    return max(float(base_threshold), min(90.0, max(8.0, int(word_count) * 0.35)))


def normalize_for_attention(text: str) -> str:
    """Normalize text for robust attention keyword matching."""
    normalized = NORMALIZE_NON_ALNUM_RE.sub(" ", (text or "").lower())
    return NORMALIZE_WHITESPACE_RE.sub(" ", normalized).strip()


def extract_expected_terms(raw_expected: str):
    """Allow multiple attention terms in DB using separators like | , ; /."""
    tokens = [token.strip() for token in ATTN_TOKEN_SPLIT_RE.split((raw_expected or "").strip())]
    clean = [normalize_for_attention(token) for token in tokens if token.strip()]
    return [token for token in clean if token]


def match_attention_terms(description: str, expected_terms, strict: bool):
    """Return list of expected terms found in description."""
    normalized_description = normalize_for_attention(description)
    if not normalized_description or not expected_terms:
        return []

    matched = []
    for term in expected_terms:
        if strict:
            if re.search(STRICT_TERM_TEMPLATE.format(term=re.escape(term)), normalized_description):
                matched.append(term)
        elif term in normalized_description:
            matched.append(term)
    return matched


def alphabetic_tokens(text: str):
    return ALPHABETIC_TOKEN_RE.findall(normalize_for_attention(text))


def extract_survey_metrics(payload):
    metrics = payload if isinstance(payload, dict) else {}
    return {
        "survey_time_spent_ms": safe_non_negative_int(metrics.get("survey_time_spent_ms"), 0),
        "survey_page_views": safe_non_negative_int(metrics.get("survey_page_views"), 0),
        "survey_tab_switches": safe_non_negative_int(metrics.get("survey_tab_switches"), 0),
        "survey_page_close_attempts": safe_non_negative_int(metrics.get("survey_page_close_attempts"), 0),
        "survey_network_disconnects": safe_non_negative_int(metrics.get("survey_network_disconnects"), 0),
        "survey_max_scroll_depth_pct": max(0, min(100, safe_non_negative_int(metrics.get("survey_max_scroll_depth_pct"), 0))),
        "survey_clicks": safe_non_negative_int(metrics.get("survey_clicks"), 0),
        "survey_keypresses": safe_non_negative_int(metrics.get("survey_keypresses"), 0),
    }


def enqueue_submit_post_commit_tasks(
    *,
    engine,
    emit_domain_event_fn,
    participant_id: int,
    submission_id: int,
    image_id_str: str,
    is_survey: bool,
    is_attention: bool,
    survey_index,
    quality: float,
    word_count: int,
    idempotency_key: str = "",
):
    """Run non-critical side effects outside the request transaction."""
    def _run():
        attempts = max(1, int(SUBMISSION_POST_COMMIT_ASYNC_MAX_ATTEMPTS))
        for attempt in range(1, attempts + 1):
            try:
                with engine.begin() as conn:
                    conn.execute(text("""
                        INSERT INTO audit_log (
                            event_type, participant_id, endpoint, http_method, status_code,
                            ip_hash, user_agent, details, request_id
                        ) VALUES (
                            :ev, :pid, :ep, :meth, :st, :iph, :ua, :det, :rid
                        )
                    """), {
                        "ev": AUDIT_EVENT_SUBMISSION,
                        "pid": participant_id,
                        "ep": SUBMIT_ROUTE,
                        "meth": HTTP_METHOD_POST,
                        "st": 200,
                        "iph": "0" * 64,
                        "ua": "",
                        "det": f"wc={word_count} q={quality:.3f} survey={is_survey}",
                        "rid": None,
                    })
                    emit_domain_event_fn(
                        conn,
                        event_type=DOMAIN_EVENT_SUBMISSION_SAVED,
                        correlation_id=idempotency_key[:128],
                        participant_id=participant_id,
                        payload={
                            "submission_id": int(submission_id),
                            "image_id": image_id_str,
                            "is_survey": bool(is_survey),
                            "is_attention_check": bool(is_attention),
                            "survey_index": survey_index,
                            "quality_score": float(quality),
                            "idempotency_key": idempotency_key[:128],
                            "attempt": attempt,
                        },
                    )
                return
            except Exception as exc:
                log_event(
                    logger,
                    OBS_EVENT_SUBMISSION_POST_COMMIT_FAILED,
                    level=logging.WARNING,
                    error=str(exc),
                    attempt=attempt,
                    max_attempts=attempts,
                    idempotency_key=idempotency_key[:32],
                )
                if attempt >= attempts:
                    return
                time.sleep(
                    _bounded_backoff(
                        attempt,
                        SUBMISSION_POST_COMMIT_ASYNC_BASE_BACKOFF_MS,
                        SUBMISSION_POST_COMMIT_ASYNC_MAX_BACKOFF_MS,
                    )
                )

    try:
        SUBMIT_POST_COMMIT_EXECUTOR.submit(_run)
    except Exception as exc:
        log_event(logger, OBS_EVENT_SUBMISSION_POST_COMMIT_ENQUEUE_FAILED, level=logging.WARNING, error=str(exc))
