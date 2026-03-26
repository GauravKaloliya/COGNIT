import logging
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Iterable

from sqlalchemy import text

from app.constants.event_constants import AUDIT_EVENT_SUBMISSION, DOMAIN_EVENT_SUBMISSION_SAVED, HTTP_METHOD_POST
from app.constants.audit_details import AUDIT_DETAIL_SUBMISSION
from app.constants.route_constants import SUBMIT_ROUTE
from app.constants.submission_patterns import (
    ALPHABETIC_TOKEN_RE,
    ATTN_TOKEN_SPLIT_RE,
    NORMALIZE_NON_ALNUM_RE,
    NORMALIZE_WHITESPACE_RE,
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
SPATIAL_TERMS = {
    "left", "right", "top", "bottom", "above", "below", "under", "over",
    "behind", "front", "between", "middle", "center", "inside", "outside",
    "near", "far", "next", "beside",
}
OBJECT_STOPWORDS = {
    "a", "an", "the", "this", "that", "there", "with", "from", "into", "onto",
    "what", "where", "when", "while", "about", "after", "before", "because",
    "very", "more", "most", "just", "have", "has", "had", "were", "was", "are",
    "and", "for", "but", "then", "than", "they", "them", "their", "your", "you",
    "our", "ours", "his", "her", "its", "image", "picture", "looks", "seems",
}
NORMALIZATION_MAP = {
    "puppy": "dog",
    "bunny": "rabbit",
}


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


def infer_device_type(user_agent: str) -> str:
    ua = str(user_agent or "").lower()
    if not ua:
        return "unknown"
    if any(token in ua for token in ["mobile", "iphone", "android", "windows phone"]):
        return "mobile"
    if any(token in ua for token in ["ipad", "tablet"]):
        return "tablet"
    return "desktop"


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


def _contains_term_tokens(description_tokens, term_tokens) -> bool:
    if not term_tokens or len(term_tokens) > len(description_tokens):
        return False

    span = len(term_tokens)
    for index in range(len(description_tokens) - span + 1):
        if description_tokens[index:index + span] == term_tokens:
            return True
    return False


def match_attention_terms(description: str, expected_terms, strict: bool):
    """Return list of expected terms found in description."""
    normalized_description = normalize_for_attention(description)
    if not normalized_description or not expected_terms:
        return []

    description_tokens = normalized_description.split()
    matched = []
    for term in expected_terms:
        normalized_term = normalize_for_attention(term)
        if not normalized_term:
            continue
        if strict:
            if _contains_term_tokens(description_tokens, normalized_term.split()):
                matched.append(normalized_term)
        elif normalized_term in normalized_description:
            matched.append(normalized_term)
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


def _safe_optional_smallint(value, *, minimum: int, maximum: int):
    if value is None:
        return None
    try:
        parsed = int(value)
    except Exception:
        return None
    if parsed < minimum or parsed > maximum:
        return None
    return parsed


def _safe_optional_float(value):
    if value is None:
        return None
    try:
        return float(value)
    except Exception:
        return None


def _safe_string_list(value, *, max_items: int = 20, max_item_len: int = 80):
    if not isinstance(value, list):
        return []
    cleaned = []
    for item in value:
        text_value = str(item or "").strip().lower()
        if not text_value:
            continue
        normalized = NORMALIZE_WHITESPACE_RE.sub(" ", text_value)[:max_item_len]
        if normalized and normalized not in cleaned:
            cleaned.append(normalized)
        if len(cleaned) >= max_items:
            break
    return cleaned


def _extract_alignment_mentions(description: str):
    tokens = normalize_for_attention(description).split()
    object_mentions = []
    spatial_mentions = []
    for token in tokens:
        if token in SPATIAL_TERMS:
            if token not in spatial_mentions:
                spatial_mentions.append(token)
            continue
        if len(token) < 3 or token in OBJECT_STOPWORDS:
            continue
        if token not in object_mentions:
            object_mentions.append(token)
        if len(object_mentions) >= 12 and len(spatial_mentions) >= 10:
            break
    return {
        "object_mentions": object_mentions[:12],
        "spatial_mentions": spatial_mentions[:10],
    }


def extract_objects(description: str) -> set[str]:
    mentions = _extract_alignment_mentions(description)
    return set(mentions.get("object_mentions") or [])


def normalize_objects(objects: Iterable[str]) -> set[str]:
    normalized = set()
    for obj in objects:
        token = str(obj or "").strip().lower()
        if not token:
            continue
        normalized.add(NORMALIZATION_MAP.get(token, token))
    return normalized


def compute_alignment(user_objects: set[str], gt_objects: set[str]):
    if not gt_objects:
        return None
    correct = user_objects & gt_objects
    wrong = user_objects - gt_objects
    missed = gt_objects - user_objects

    precision = (len(correct) / len(user_objects)) if user_objects else 0.0
    recall = len(correct) / len(gt_objects)
    if precision + recall == 0:
        f1 = 0.0
    else:
        f1 = (2 * precision * recall) / (precision + recall)

    return {
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1": round(f1, 4),
        "correct": sorted(correct),
        "wrong": sorted(wrong),
        "missed": sorted(missed),
    }


def get_ground_truth_objects(db, image_id: int) -> set[str]:
    rows = db.execute(text("""
        SELECT object
        FROM image_ground_truths
        WHERE image_id = :image_id
    """), {"image_id": int(image_id)}).fetchall()
    return {row[0] for row in rows or []}


def extract_submission_phase_metrics(payload: dict[str, Any], *, description: str = ""):
    metrics = payload if isinstance(payload, dict) else {}
    difficulty_self_report = _safe_optional_smallint(metrics.get("difficulty_self_report"), minimum=1, maximum=5)
    alignment_mentions = _extract_alignment_mentions(description)

    phase_metrics = {
        "confidence_score": _safe_optional_smallint(metrics.get("confidence_score"), minimum=1, maximum=5),
        "difficulty_self_report": difficulty_self_report,
        "object_mentions": alignment_mentions["object_mentions"],
        "spatial_mentions": alignment_mentions["spatial_mentions"],
        "first_view_duration_ms": safe_non_negative_int(metrics.get("first_view_duration_ms"), 0),
        "writing_duration_ms": safe_non_negative_int(metrics.get("writing_duration_ms"), 0),
    }

    behavior_metrics = {
        "time_before_typing_ms": safe_non_negative_int(metrics.get("time_before_typing_ms"), 0),
        "edit_count": safe_non_negative_int(metrics.get("edit_count"), 0),
        "backspace_count": safe_non_negative_int(metrics.get("backspace_count"), 0),
        "avg_keystroke_interval_ms": _safe_optional_float(metrics.get("avg_keystroke_interval_ms")),
        "keystroke_variance": _safe_optional_float(metrics.get("keystroke_variance")),
        "pause_count": safe_non_negative_int(metrics.get("pause_count"), 0),
        "avg_pause_duration_ms": _safe_optional_float(metrics.get("avg_pause_duration_ms")),
    }
    return {
        "phase_metrics": phase_metrics,
        "behavior_metrics": behavior_metrics,
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
                        "det": AUDIT_DETAIL_SUBMISSION.format(
                            word_count=word_count,
                            quality=quality,
                            is_survey=is_survey,
                        ),
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
