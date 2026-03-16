import re
from concurrent.futures import ThreadPoolExecutor
from typing import Dict, Any

from sqlalchemy import text

from app.constants.submission_constants import (
    AUDIT_EVENT_SUBMISSION,
    DOMAIN_EVENT_SUBMISSION_SAVED,
    HTTP_METHOD_POST,
    SUBMIT_ENDPOINT,
)

ATTN_TOKEN_SPLIT_RE = re.compile(r"[|,;/]+")
SUBMIT_POST_COMMIT_EXECUTOR = ThreadPoolExecutor(max_workers=2, thread_name_prefix="submit-post-commit")


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


def normalize_engagement_counts(payload: Dict[str, Any], fallback: Dict[str, Any] = None) -> Dict[str, int]:
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
    normalized = re.sub(r"[^a-z0-9]+", " ", (text or "").lower())
    return re.sub(r"\s+", " ", normalized).strip()


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
            if re.search(rf"\b{re.escape(term)}\b", normalized_description):
                matched.append(term)
        elif term in normalized_description:
            matched.append(term)
    return matched


def alphabetic_tokens(text: str):
    return re.findall(r"\b[a-z]{2,}\b", normalize_for_attention(text))


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
    evaluate_priority_and_rewards_fn,
    participant_id: int,
    submission_id: int,
    image_id_str: str,
    is_survey: bool,
    is_attention: bool,
    survey_index,
    quality: float,
    word_count: int,
):
    """Run non-critical side effects outside the request transaction."""
    def _run():
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
                    "ep": SUBMIT_ENDPOINT,
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
                    correlation_id="",
                    participant_id=participant_id,
                    payload={
                        "submission_id": int(submission_id),
                        "image_id": image_id_str,
                        "is_survey": bool(is_survey),
                        "is_attention_check": bool(is_attention),
                        "survey_index": survey_index,
                        "quality_score": float(quality),
                    },
                )
                evaluate_priority_and_rewards_fn(conn, participant_id, correlation_id="")
        except Exception:
            pass

    try:
        SUBMIT_POST_COMMIT_EXECUTOR.submit(_run)
    except Exception:
        pass
