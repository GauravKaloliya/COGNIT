from __future__ import annotations

import logging
import re
import time
from concurrent.futures import ThreadPoolExecutor
from difflib import SequenceMatcher
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
RELATION_TERMS = {
    "above", "around", "behind", "below", "beside", "between", "holding",
    "in", "inside", "near", "next", "on", "over", "under", "with",
}
ACTION_TERMS = {
    "carry", "carrying", "eat", "eating", "flow", "flowing", "fly", "flying",
    "hold", "holding", "look", "looking", "rest", "resting", "run", "running",
    "sit", "sitting", "smile", "smiling", "stand", "standing", "walk", "walking",
}
OBJECT_STOPWORDS = {
    "a", "an", "the", "this", "that", "there", "with", "from", "into", "onto",
    "what", "where", "when", "while", "about", "after", "before", "because",
    "very", "more", "most", "just", "have", "has", "had", "were", "was", "are",
    "and", "for", "but", "then", "than", "they", "them", "their", "your", "you",
    "our", "ours", "his", "her", "its", "image", "picture", "looks", "seems",
    "one", "ones", "open", "place", "thing", "which", "while", "lots", "lot",
}
NORMALIZATION_MAP = {
    "cottage": "home",
    "cupcake": "cake",
    "house": "home",
    "kitten": "cat",
    "kitty": "cat",
    "mug": "cup",
    "puppy": "dog",
    "teacup": "cup",
    "bunny": "rabbit",
}
ATTENTION_VARIANT_STOPWORDS = {
    "background",
    "landscape",
    "scene",
    "view",
}
ATTENTION_NON_CORE_TERMS = {
    "autumn",
    "black",
    "blue",
    "brown",
    "colorful",
    "cream",
    "cute",
    "dark",
    "fantasy",
    "floral",
    "garden",
    "gold",
    "gray",
    "green",
    "holding",
    "landscape",
    "lavender",
    "navy",
    "olive",
    "orange",
    "outdoor",
    "painting",
    "path",
    "peach",
    "pink",
    "plain",
    "purple",
    "red",
    "resting",
    "sitting",
    "sky",
    "smiling",
    "snowy",
    "standing",
    "sunny",
    "sunset",
    "teal",
    "white",
    "winter",
    "yellow",
}
ATTENTION_FILLER_TERMS = {
    "amazing",
    "around",
    "art",
    "beautiful",
    "bright",
    "cute",
    "dreamy",
    "feeling",
    "feelings",
    "good",
    "great",
    "happy",
    "image",
    "magical",
    "nice",
    "peaceful",
    "some",
    "something",
    "stuff",
    "style",
    "things",
    "vibe",
    "vibes",
}
ALIGNMENT_SCENE_NOUNS = {
    "ball", "basket", "bird", "blossom", "bow", "branch", "bucket", "butterfly",
    "cake", "cat", "cherry", "cliff", "cloud", "cottage", "cup", "dog", "eye",
    "face", "flower", "garden", "grass", "heart", "hill", "home", "house",
    "island", "mountain", "panda", "path", "picnic", "rabbit", "river", "rock",
    "sky", "sun", "tree", "turtle", "water", "waterfall",
}
ALIGNMENT_NOISE_TOKENS = {
    "aay", "haaye", "kiki", "lots", "many", "one", "pand", "place", "preety",
    "syn", "thi", "traingle", "which",
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


def safe_non_negative_float(value, default: float = 0.0) -> float:
    try:
        parsed = float(value)
        return parsed if parsed >= 0 else default
    except Exception:
        return default


def _clamp_unit_interval(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


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


def dynamic_too_fast_threshold(
    base_threshold: float,
    word_count: int,
    *,
    is_attention: bool = False,
    description: str = "",
    behavior_metrics: dict[str, Any] | None = None,
) -> float:
    metrics = behavior_metrics or {}
    safe_word_count = max(0, int(word_count or 0))
    char_count = len(str(description or "").strip())
    time_before_typing = max(0.0, float(metrics.get("time_before_typing_seconds", 0.0) or 0.0))

    reading_seconds = max(5.0, min(28.0, char_count / 20.0))
    writing_rate = 0.55 if is_attention else 0.70
    writing_seconds = max(10.0, min(95.0, safe_word_count * writing_rate))
    settle_seconds = min(8.0, time_before_typing * 0.6)
    base = max(float(base_threshold or 0.0), 6.0)
    submission_bias = 4.0 if is_attention else 8.0

    threshold = base + (0.35 * reading_seconds) + (0.45 * writing_seconds) + settle_seconds + submission_bias
    return round(min(150.0, max(base, threshold)), 2)


def normalize_for_attention(text: str) -> str:
    """Normalize text for robust attention keyword matching."""
    normalized = NORMALIZE_NON_ALNUM_RE.sub(" ", (text or "").lower())
    return NORMALIZE_WHITESPACE_RE.sub(" ", normalized).strip()


def _singularize_attention_token(token: str) -> str:
    if len(token) <= 3:
        return token
    if token.endswith("ies") and len(token) > 4:
        return f"{token[:-3]}y"
    if token.endswith("ves") and len(token) > 4:
        if token[-4] == "i":
            return f"{token[:-3]}fe"
        return f"{token[:-3]}f"
    if token.endswith(("ses", "xes", "zes", "ches", "shes")) and len(token) > 4:
        return token[:-2]
    if token.endswith("s") and not token.endswith(("ss", "us")):
        return token[:-1]
    return token


def canonicalize_attention_term(term: str) -> str:
    normalized = normalize_for_attention(term)
    if not normalized:
        return ""

    tokens = normalized.split()
    trimmed = [token for token in tokens if token not in ATTENTION_VARIANT_STOPWORDS]
    if trimmed:
        tokens = trimmed

    canonical_tokens = []
    for token in tokens:
        mapped = NORMALIZATION_MAP.get(token, token)
        canonical_tokens.append(_singularize_attention_token(mapped))

    return " ".join(token for token in canonical_tokens if token)


def _attention_term_key(term: str) -> str:
    tokens = term.split()
    if not tokens:
        return ""
    return tokens[-1]


def _is_core_attention_term(term: str) -> bool:
    tokens = term.split()
    if not tokens:
        return False
    if len(tokens) > 1:
        return True
    return tokens[0] not in ATTENTION_NON_CORE_TERMS


def _dedupe_attention_terms(tokens: list[str]) -> list[str]:
    representatives = {}
    order = []
    for token in tokens:
        if not token:
            continue
        key = _attention_term_key(token) or token
        existing = representatives.get(key)
        if existing is None:
            representatives[key] = token
            order.append(key)
            continue
        if (len(token.split()), len(token)) < (len(existing.split()), len(existing)):
            representatives[key] = token
    return [representatives[key] for key in order]


def extract_expected_terms(raw_expected: str):
    """Allow multiple attention terms in DB using separators like | , ; /."""
    tokens = [token.strip() for token in ATTN_TOKEN_SPLIT_RE.split((raw_expected or "").strip())]
    clean = [canonicalize_attention_term(token) for token in tokens if token.strip()]
    deduped_terms = _dedupe_attention_terms(clean)
    core_terms = [term for term in deduped_terms if _is_core_attention_term(term)]
    return core_terms or deduped_terms


def build_attention_core_terms(raw_expected: str, ground_truth_objects: Iterable[str] | None = None, *, min_terms: int = 3, max_terms: int = 6) -> list[str]:
    expected_terms = extract_expected_terms(raw_expected)
    gt_terms = [
        canonicalize_attention_term(obj)
        for obj in (ground_truth_objects or [])
        if canonicalize_attention_term(obj)
    ]
    gt_core_terms = [term for term in _dedupe_attention_terms(gt_terms) if _is_core_attention_term(term)]
    if len(gt_core_terms) >= min_terms:
        return gt_core_terms[:max_terms]

    combined = _dedupe_attention_terms(gt_core_terms + expected_terms)
    selected = combined[:max_terms]
    if len(selected) < min_terms:
        fallback = [term for term in _dedupe_attention_terms(gt_terms + expected_terms) if term not in selected]
        selected.extend(fallback[: max(0, min_terms - len(selected))])
    return selected[:max_terms]


def _attention_tokens_match(left: str, right: str) -> bool:
    if left == right:
        return True
    if not left or not right:
        return False
    if len(left) < 5 or len(right) < 5:
        return False
    if left[0] != right[0]:
        return False
    if abs(len(left) - len(right)) > 1:
        return False
    return SequenceMatcher(None, left, right).ratio() >= 0.86


def count_attention_descriptive_tokens(description: str, matched_terms: Iterable[str]) -> int:
    description_tokens = alphabetic_tokens(description)
    matched_token_set = {
        token
        for term in matched_terms
        for token in canonicalize_attention_term(term).split()
        if token
    }

    informative = []
    for token in description_tokens:
        if token in OBJECT_STOPWORDS:
            continue
        if token in ATTENTION_FILLER_TERMS:
            continue
        if token in matched_token_set:
            continue
        informative.append(token)
    return len(set(informative))


def detect_repetitive_attention_template(description: str, matched_terms: Iterable[str]) -> tuple[bool, dict[str, float]]:
    tokens = alphabetic_tokens(description)
    token_count = len(tokens)
    if token_count < 12:
        return False, {
            "token_count": float(token_count),
            "unique_ratio": 1.0 if token_count else 0.0,
            "repeated_bigram_ratio": 0.0,
            "max_repeated_trigram_count": 0.0,
            "matched_token_density": 0.0,
        }

    unique_ratio = len(set(tokens)) / float(token_count)

    bigrams = [tuple(tokens[index:index + 2]) for index in range(token_count - 1)]
    repeated_bigram_ratio = 0.0
    if bigrams:
        repeated_bigram_ratio = 1.0 - (len(set(bigrams)) / float(len(bigrams)))

    trigram_counts = {}
    for index in range(token_count - 2):
        trigram = tuple(tokens[index:index + 3])
        trigram_counts[trigram] = trigram_counts.get(trigram, 0) + 1
    max_repeated_trigram_count = max(trigram_counts.values(), default=0)

    matched_token_set = {
        token
        for term in matched_terms
        for token in canonicalize_attention_term(term).split()
        if token
    }
    matched_token_density = (
        sum(1 for token in tokens if token in matched_token_set) / float(token_count)
        if token_count else 0.0
    )

    repetitive = bool(
        (
            max_repeated_trigram_count >= 3
            and matched_token_density > 0.15
        )
        or (
            max_repeated_trigram_count >= 2
            and (
                unique_ratio < 0.6
                or repeated_bigram_ratio > 0.18
                or matched_token_density > 0.28
            )
        )
    )
    return repetitive, {
        "token_count": float(token_count),
        "unique_ratio": round(unique_ratio, 4),
        "repeated_bigram_ratio": round(repeated_bigram_ratio, 4),
        "max_repeated_trigram_count": float(max_repeated_trigram_count),
        "matched_token_density": round(matched_token_density, 4),
    }


def _contains_term_tokens(description_tokens, term_tokens) -> bool:
    if not term_tokens or len(term_tokens) > len(description_tokens):
        return False

    span = len(term_tokens)
    for index in range(len(description_tokens) - span + 1):
        window = description_tokens[index:index + span]
        if all(_attention_tokens_match(window_token, term_token) for window_token, term_token in zip(window, term_tokens)):
            return True
    return False


def match_attention_terms(description: str, expected_terms, strict: bool):
    """Return list of expected terms found in description."""
    normalized_description = canonicalize_attention_term(description)
    if not normalized_description or not expected_terms:
        return []

    description_tokens = normalized_description.split()
    matched = []
    for term in expected_terms:
        normalized_term = canonicalize_attention_term(term)
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
        "survey_time_spent_seconds": safe_non_negative_float(
            metrics.get("survey_time_spent_seconds"),
            safe_non_negative_float(metrics.get("survey_time_spent_ms"), 0.0) / 1000.0,
        ),
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


def _extract_alignment_mentions(description: str, reference_objects: Iterable[str] | None = None):
    tokens = normalize_for_attention(description).split()
    reference_terms = normalize_objects(reference_objects or [])
    object_mentions = []
    spatial_mentions = []
    for token in tokens:
        if token in SPATIAL_TERMS:
            if token not in spatial_mentions:
                spatial_mentions.append(token)
            continue
        token = canonicalize_attention_term(token)
        if (
            len(token) < 3
            or token in OBJECT_STOPWORDS
            or token in ATTENTION_FILLER_TERMS
            or token in ATTENTION_NON_CORE_TERMS
            or token in ALIGNMENT_NOISE_TOKENS
            or token in RELATION_TERMS
            or token in ACTION_TERMS
        ):
            continue
        if reference_terms:
            if token not in reference_terms and token not in ALIGNMENT_SCENE_NOUNS:
                continue
        elif token not in ALIGNMENT_SCENE_NOUNS:
            continue
        if token not in object_mentions:
            object_mentions.append(token)
        if len(object_mentions) >= 12 and len(spatial_mentions) >= 10:
            break
    return {
        "object_mentions": object_mentions[:12],
        "spatial_mentions": spatial_mentions[:10],
    }


def summarize_alignment_mentions(
    description: str,
    *,
    reference_objects: Iterable[str] | None = None,
) -> dict[str, Any]:
    mentions = _extract_alignment_mentions(description, reference_objects=reference_objects)
    object_mentions = mentions["object_mentions"]
    spatial_mentions = mentions["spatial_mentions"]
    tokens = alphabetic_tokens(description)
    reference_terms = normalize_objects(reference_objects or [])
    reference_coverage = 0.0
    if reference_terms:
        reference_coverage = len(set(object_mentions) & reference_terms) / float(len(reference_terms))
    detail_tokens = [
        token
        for token in tokens
        if token not in OBJECT_STOPWORDS
        and token not in ATTENTION_FILLER_TERMS
        and token not in ATTENTION_NON_CORE_TERMS
        and token not in ALIGNMENT_NOISE_TOKENS
    ]
    unique_detail_tokens = list(dict.fromkeys(detail_tokens))
    non_object_detail_tokens = [
        token
        for token in unique_detail_tokens
        if token not in set(object_mentions)
        and token not in reference_terms
        and token not in SPATIAL_TERMS
        and token not in RELATION_TERMS
        and token not in ACTION_TERMS
    ]
    unique_detail_component = len(unique_detail_tokens) / float(len(unique_detail_tokens) + 12)
    non_object_detail_component = len(non_object_detail_tokens) / float(len(non_object_detail_tokens) + 10)
    spatial_component = len(spatial_mentions) / float(len(spatial_mentions) + 2)
    detail_density_score = _clamp_unit_interval(
        0.35 * unique_detail_component
        + 0.35 * non_object_detail_component
        + 0.15 * spatial_component
        + 0.15 * reference_coverage
    )
    return {
        "object_mentions": object_mentions,
        "spatial_mentions": spatial_mentions,
        "object_mention_count": len(object_mentions),
        "spatial_mention_count": len(spatial_mentions),
        "reference_coverage": round(reference_coverage, 4),
        "detail_density_score": round(detail_density_score, 4),
    }


def extract_objects(description: str) -> set[str]:
    mentions = _extract_alignment_mentions(description)
    return set(mentions.get("object_mentions") or [])


def normalize_objects(objects: Iterable[str]) -> set[str]:
    normalized = set()
    for obj in objects:
        token = canonicalize_attention_term(str(obj or "").strip().lower())
        if not token:
            continue
        normalized.add(token)
    return normalized


def _extract_relation_hits(tokens: list[str], correct_objects: set[str]) -> set[tuple[str, str, str]]:
    relation_hits: set[tuple[str, str, str]] = set()
    token_count = len(tokens)
    for index, token in enumerate(tokens):
        if token not in correct_objects:
            continue
        for middle_index in range(index + 1, min(index + 4, token_count - 1)):
            middle = tokens[middle_index]
            if middle not in RELATION_TERMS and middle not in ACTION_TERMS:
                continue
            for end_index in range(middle_index + 1, min(middle_index + 4, token_count)):
                target = tokens[end_index]
                if target in correct_objects and target != token:
                    relation_hits.add((token, middle, target))
    return relation_hits


def _alignment_style_metrics(tokens: list[str], correct_objects: set[str], description: str) -> dict[str, float]:
    token_count = len(tokens)
    if token_count <= 1:
        return {
            "token_count": float(token_count),
            "unique_ratio": 1.0 if token_count else 0.0,
            "repeated_bigram_ratio": 0.0,
            "object_token_density": 0.0,
            "relation_term_density": 0.0,
            "sentence_count": 1.0 if description.strip() else 0.0,
            "natural_language_score": 0.0,
            "stuffing_penalty": 0.0,
        }

    unique_ratio = len(set(tokens)) / float(token_count)
    bigrams = [tuple(tokens[index:index + 2]) for index in range(token_count - 1)]
    repeated_bigram_ratio = 0.0
    if bigrams:
        repeated_bigram_ratio = 1.0 - (len(set(bigrams)) / float(len(bigrams)))

    object_mentions = sum(1 for token in tokens if token in correct_objects)
    object_token_density = object_mentions / float(token_count) if token_count else 0.0
    relation_term_count = sum(1 for token in tokens if token in RELATION_TERMS or token in ACTION_TERMS)
    relation_term_density = relation_term_count / float(token_count) if token_count else 0.0
    sentence_count = float(max(1, len(re.findall(r"[.!?]+", description or ""))))
    detail_count = sum(
        1
        for token in tokens
        if token not in OBJECT_STOPWORDS
        and token not in ATTENTION_FILLER_TERMS
        and token not in correct_objects
    )

    natural_language_score = min(
        1.0,
        (
            0.35 * min(1.0, unique_ratio / 0.72)
            + 0.25 * min(1.0, detail_count / 10.0)
            + 0.20 * min(1.0, relation_term_count / 2.0)
            + 0.20 * min(1.0, sentence_count / 3.0)
        ),
    )

    stuffing_penalty = 0.0
    if object_token_density > 0.18:
        stuffing_penalty += min(0.16, (object_token_density - 0.18) * 0.85)
    if repeated_bigram_ratio > 0.08:
        stuffing_penalty += min(0.16, (repeated_bigram_ratio - 0.08) * 0.95)
    if unique_ratio < 0.62:
        stuffing_penalty += min(0.12, (0.62 - unique_ratio) * 0.55)
    if relation_term_count == 0 and object_token_density > 0.20:
        stuffing_penalty += 0.04
    stuffing_penalty = min(0.28, stuffing_penalty)

    return {
        "token_count": float(token_count),
        "unique_ratio": round(unique_ratio, 4),
        "repeated_bigram_ratio": round(repeated_bigram_ratio, 4),
        "object_token_density": round(object_token_density, 4),
        "relation_term_density": round(relation_term_density, 4),
        "sentence_count": sentence_count,
        "natural_language_score": round(natural_language_score, 4),
        "stuffing_penalty": round(stuffing_penalty, 4),
    }


def compute_alignment(user_objects: set[str], gt_objects: set[str], description: str = ""):
    if not gt_objects:
        return None
    description_tokens = canonicalize_attention_term(description).split()
    text_matched_gt = set()
    for gt_object in gt_objects:
        gt_term = canonicalize_attention_term(gt_object)
        if gt_term and _contains_term_tokens(description_tokens, gt_term.split()):
            text_matched_gt.add(gt_term)

    effective_user_objects = set(user_objects) | text_matched_gt
    correct = effective_user_objects & gt_objects
    wrong = effective_user_objects - gt_objects
    missed = gt_objects - effective_user_objects

    precision = (len(correct) / len(effective_user_objects)) if effective_user_objects else 0.0
    recall = len(correct) / len(gt_objects)
    if precision + recall == 0:
        f1 = 0.0
    else:
        f1 = (2 * precision * recall) / (precision + recall)

    object_f1 = round(f1, 4)
    tokens = alphabetic_tokens(description)
    relation_hits = _extract_relation_hits(tokens, correct)
    relation_score = min(1.0, len(relation_hits) / float(max(1, min(len(correct), 3))))
    spatial_count = sum(1 for token in tokens if token in SPATIAL_TERMS or token in RELATION_TERMS)
    style_metrics = _alignment_style_metrics(tokens, correct, description)
    detail_count = sum(
        1
        for token in tokens
        if token not in OBJECT_STOPWORDS and token not in ATTENTION_FILLER_TERMS
    )
    scene_consistency = 0.0
    if correct:
        scene_consistency = min(
            1.0,
            (
                0.60 * (len(correct) / float(max(1, len(gt_objects))))
                + 0.20 * min(1.0, spatial_count / 3.0)
                + 0.20 * min(1.0, detail_count / 14.0)
            ),
        )
    wrong_object_penalty = min(
        0.05,
        (len(wrong) / float(max(1, len(gt_objects)))) * 0.02
        + (len(wrong) / float(max(1, len(effective_user_objects)))) * 0.015,
    ) if effective_user_objects else 0.0
    alignment_score = (
        0.58 * object_f1
        + 0.12 * relation_score
        + 0.08 * scene_consistency
        + 0.14 * style_metrics["natural_language_score"]
        + 0.08 * recall
        - wrong_object_penalty
        - style_metrics["stuffing_penalty"]
    )
    alignment_score = round(max(0.0, min(1.0, alignment_score)), 4)

    return {
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1": alignment_score,
        "object_f1": object_f1,
        "relation_score": round(relation_score, 4),
        "scene_consistency_score": round(scene_consistency, 4),
        "wrong_object_penalty": round(wrong_object_penalty, 4),
        "natural_language_score": style_metrics["natural_language_score"],
        "stuffing_penalty": style_metrics["stuffing_penalty"],
        "alignment_style_metrics": style_metrics,
        "relation_hits": [list(item) for item in sorted(relation_hits)],
        "correct": sorted(correct),
        "wrong": sorted(wrong),
        "missed": sorted(missed),
    }


def get_ground_truth_objects(db, image_id: int) -> set[str]:
    rows = db.execute(text("""
        SELECT object
        FROM ground_truth_labels
        WHERE image_id = :image_id
          AND is_present = TRUE
    """), {"image_id": int(image_id)}).fetchall()
    return {row[0] for row in rows or []}


def extract_submission_phase_metrics(payload: dict[str, Any], *, description: str = ""):
    metrics = payload if isinstance(payload, dict) else {}
    difficulty_self_report = _safe_optional_smallint(metrics.get("difficulty_self_report"), minimum=1, maximum=5)
    confidence_rating = _safe_optional_smallint(metrics.get("confidence_rating"), minimum=1, maximum=5)
    alignment_mentions = summarize_alignment_mentions(description)

    phase_metrics = {
        "confidence_rating": confidence_rating,
        "difficulty_self_report": difficulty_self_report,
        "object_mentions": alignment_mentions["object_mentions"],
        "spatial_mentions": alignment_mentions["spatial_mentions"],
        "object_mention_count": alignment_mentions["object_mention_count"],
        "spatial_mention_count": alignment_mentions["spatial_mention_count"],
        "reference_coverage": alignment_mentions["reference_coverage"],
        "detail_density_score": alignment_mentions["detail_density_score"],
        "first_view_duration_seconds": safe_non_negative_float(
            metrics.get("first_view_duration_seconds"),
            safe_non_negative_float(metrics.get("first_view_duration_ms"), 0.0) / 1000.0,
        ),
        "writing_duration_seconds": safe_non_negative_float(
            metrics.get("writing_duration_seconds"),
            safe_non_negative_float(metrics.get("writing_duration_ms"), 0.0) / 1000.0,
        ),
    }

    time_before_typing_seconds = safe_non_negative_float(
        metrics.get("time_before_typing_seconds"),
        safe_non_negative_float(metrics.get("time_before_typing_ms"), 0.0) / 1000.0,
    )
    edit_count = safe_non_negative_int(metrics.get("edit_count"), 0)
    backspace_count = safe_non_negative_int(metrics.get("backspace_count"), 0)
    pause_count = safe_non_negative_int(metrics.get("pause_count"), 0)
    avg_pause_duration_seconds = (
        _safe_optional_float(metrics.get("avg_pause_duration_seconds"))
        if metrics.get("avg_pause_duration_seconds") is not None
        else (
            _safe_optional_float(metrics.get("avg_pause_duration_ms")) / 1000.0
            if _safe_optional_float(metrics.get("avg_pause_duration_ms")) is not None
            else None
        )
    )
    keystroke_variance = _safe_optional_float(metrics.get("keystroke_variance"))
    hesitation_score = _clamp_unit_interval(
        (min(1.0, time_before_typing_seconds / 25.0) * 0.40)
        + (min(1.0, pause_count / 24.0) * 0.20)
        + (min(1.0, float(avg_pause_duration_seconds or 0.0) / 5.0) * 0.20)
        + (min(1.0, float(keystroke_variance or 0.0) / 3.0) * 0.20)
    )
    revision_bursts = max(0, int(round((backspace_count / 18.0) + (pause_count / 8.0))))
    submitted_without_typing_pause = bool(pause_count == 0 and time_before_typing_seconds <= 2.5)

    behavior_metrics = {
        "time_before_typing_seconds": time_before_typing_seconds,
        "edit_count": edit_count,
        "backspace_count": backspace_count,
        "avg_keystroke_interval_seconds": _safe_optional_float(metrics.get("avg_keystroke_interval_seconds"))
        if metrics.get("avg_keystroke_interval_seconds") is not None
        else (
            _safe_optional_float(metrics.get("avg_keystroke_interval_ms")) / 1000.0
            if _safe_optional_float(metrics.get("avg_keystroke_interval_ms")) is not None
            else None
        ),
        "keystroke_variance": keystroke_variance,
        "pause_count": pause_count,
        "avg_pause_duration_seconds": avg_pause_duration_seconds,
        "revision_bursts": revision_bursts,
        "hesitation_score": round(hesitation_score, 4),
        "submitted_without_typing_pause": submitted_without_typing_pause,
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
    request_id: str = "",
    ip_hash: str = "",
    user_agent: str = "",
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
                        "iph": (str(ip_hash or "").strip()[:64]) or ("0" * 64),
                        "ua": (str(user_agent or "").strip()[:512]) or "unknown",
                        "det": AUDIT_DETAIL_SUBMISSION.format(
                            word_count=word_count,
                            quality=quality,
                            is_survey=is_survey,
                        ),
                        "rid": (str(request_id or "").strip()[:128]) or None,
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
