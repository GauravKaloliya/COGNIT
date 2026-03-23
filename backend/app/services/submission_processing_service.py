"""Submission processing helpers for attention evaluation and response shaping."""

from __future__ import annotations

from datetime import datetime, timezone

from app.constants.response_keys import (
    RESPONSE_KEY_ATTENTION_PASSED,
    RESPONSE_KEY_ATTENTION_STATUS,
    RESPONSE_KEY_ENGAGEMENT,
    RESPONSE_KEY_FLAGGED_TOO_FAST,
    RESPONSE_KEY_IS_ATTENTION_CHECK,
    RESPONSE_KEY_IS_SURVEY,
    RESPONSE_KEY_QUALITY_SCORE,
    RESPONSE_KEY_STATUS,
    RESPONSE_KEY_SURVEY_INDEX,
    RESPONSE_KEY_WORD_COUNT,
)
from app.constants.submission_constants import (
    ATTENTION_FAILURE_COPIED_PATTERN,
    ATTENTION_FAILURE_LOW_DISTINCT_WORD_COUNT,
    ATTENTION_FAILURE_MISSING_EXPECTED_KEYWORD,
    ATTENTION_FAILURE_TOO_FAST,
    ATTENTION_FAILURE_TOO_SHORT,
    PARTICIPANT_META_KEY_ATTENTION_MONITOR,
    PARTICIPANT_META_KEY_CONSECUTIVE_FAILURES,
    PARTICIPANT_META_KEY_LAST_CHECKED_AT,
    PARTICIPANT_META_KEY_RECENT_ATTENTION_SCORE,
    PARTICIPANT_META_KEY_RECENT_RESULTS,
    SUBMISSION_META_KEY_ATTENTION,
    SUBMISSION_META_KEY_CONTENT_FINGERPRINT,
    SUBMISSION_META_KEY_DISTINCT_WORD_COUNT,
    SUBMISSION_META_KEY_EXPECTED_TERMS,
    SUBMISSION_META_KEY_FAILURE_REASONS,
    SUBMISSION_META_KEY_MATCHED_TERMS,
    SUBMISSION_META_KEY_STRICT,
    SUBMISSION_RESPONSE_STATUS,
)


def evaluate_attention_result(
    *,
    db,
    is_attention: bool,
    attention_check_row,
    description: str,
    normalize_for_attention,
    extract_expected_terms,
    match_attention_terms,
    has_copied_attention_pattern,
    image_id_fk: int,
    participant_id: int,
    distinct_word_count: int,
    attention_min_char_length: int,
    attention_min_distinct_words: int,
    too_fast: bool,
):
    attention_passed = None
    attention_expected_terms = []
    attention_matched_terms = []
    attention_failure_reasons = []
    description_fingerprint = None
    strict = False

    if not is_attention:
        return {
            "attention_passed": attention_passed,
            "attention_expected_terms": attention_expected_terms,
            "attention_matched_terms": attention_matched_terms,
            "attention_failure_reasons": attention_failure_reasons,
            "description_fingerprint": description_fingerprint,
            "strict": strict,
            "submission_meta": {},
        }

    expected = attention_check_row[0].strip().lower()
    strict = bool(attention_check_row[1])
    description_fingerprint = __import__("hashlib").sha256(normalize_for_attention(description).encode("utf-8")).hexdigest()
    attention_expected_terms = extract_expected_terms(expected) or [normalize_for_attention(expected)]
    attention_matched_terms = match_attention_terms(description, attention_expected_terms, strict)
    attention_passed = len(attention_matched_terms) > 0
    if not attention_passed:
        attention_failure_reasons.append(ATTENTION_FAILURE_MISSING_EXPECTED_KEYWORD)
    if len(description.strip()) < attention_min_char_length:
        attention_passed = False
        attention_failure_reasons.append(ATTENTION_FAILURE_TOO_SHORT)
    if distinct_word_count < attention_min_distinct_words:
        attention_passed = False
        attention_failure_reasons.append(ATTENTION_FAILURE_LOW_DISTINCT_WORD_COUNT)
    if has_copied_attention_pattern(
        db,
        image_id_fk=image_id_fk,
        description_fingerprint=description_fingerprint,
        participant_id=participant_id,
    ):
        attention_passed = False
        attention_failure_reasons.append(ATTENTION_FAILURE_COPIED_PATTERN)
    if too_fast:
        attention_passed = False
        attention_failure_reasons.append(ATTENTION_FAILURE_TOO_FAST)

    return {
        "attention_passed": attention_passed,
        "attention_expected_terms": attention_expected_terms,
        "attention_matched_terms": attention_matched_terms,
        "attention_failure_reasons": attention_failure_reasons,
        "description_fingerprint": description_fingerprint,
        "strict": strict,
        "submission_meta": {
            SUBMISSION_META_KEY_ATTENTION: {
                SUBMISSION_META_KEY_STRICT: strict,
                SUBMISSION_META_KEY_EXPECTED_TERMS: attention_expected_terms,
                SUBMISSION_META_KEY_MATCHED_TERMS: attention_matched_terms,
                SUBMISSION_META_KEY_FAILURE_REASONS: attention_failure_reasons,
                SUBMISSION_META_KEY_DISTINCT_WORD_COUNT: distinct_word_count,
                SUBMISSION_META_KEY_CONTENT_FINGERPRINT: description_fingerprint,
            }
        },
    }


def merge_submission_engagement(*, normalize_engagement_counts, payload: dict, survey_metrics: dict, time_spent_seconds):
    engagement = normalize_engagement_counts(payload)
    tab_switch_count = engagement["tab_switch_count"]
    page_close_attempts = engagement["page_close_attempts"]
    network_disconnects = engagement["network_disconnects"]

    merged_metrics = dict(survey_metrics)
    if merged_metrics["survey_time_spent_ms"] == 0 and time_spent_seconds is not None:
        merged_metrics["survey_time_spent_ms"] = max(0, int(float(time_spent_seconds) * 1000))
    if merged_metrics["survey_page_views"] == 0:
        merged_metrics["survey_page_views"] = 1
    if merged_metrics["survey_tab_switches"] == 0:
        merged_metrics["survey_tab_switches"] = tab_switch_count
    if merged_metrics["survey_page_close_attempts"] == 0:
        merged_metrics["survey_page_close_attempts"] = page_close_attempts
    if merged_metrics["survey_network_disconnects"] == 0:
        merged_metrics["survey_network_disconnects"] = network_disconnects

    return {
        "engagement": engagement,
        "tab_switch_count": tab_switch_count,
        "page_close_attempts": page_close_attempts,
        "network_disconnects": network_disconnects,
        "survey_metrics": merged_metrics,
    }


def apply_attention_monitor(
    *,
    participant_meta: dict,
    attention_passed,
    is_attention: bool,
    hard_flag_consecutive_fails: int,
    attention_flag_min_checks: int,
    attention_flag_threshold: float,
):
    if not is_attention:
        return {
            "participant_meta": participant_meta,
            "consecutive_failures": 0,
            "recent_attention_score": None,
            "hard_flag_triggered": False,
            "soft_flag_triggered": False,
        }

    consecutive_failures = 0
    monitor = participant_meta.get(PARTICIPANT_META_KEY_ATTENTION_MONITOR, {})
    recent_results = monitor.get(PARTICIPANT_META_KEY_RECENT_RESULTS, [])
    if not isinstance(recent_results, list):
        recent_results = []
    recent_results = [bool(item) for item in recent_results[-9:]]
    recent_results.append(bool(attention_passed))

    for result in reversed(recent_results):
      if result:
        break
      consecutive_failures += 1

    recent_attention_score = round(sum(1 for item in recent_results if item) / len(recent_results), 4)
    hard_flag_triggered = consecutive_failures >= hard_flag_consecutive_fails
    soft_flag_triggered = (
        len(recent_results) >= attention_flag_min_checks
        and recent_attention_score < float(attention_flag_threshold)
    )

    updated_meta = dict(participant_meta)
    updated_meta[PARTICIPANT_META_KEY_ATTENTION_MONITOR] = {
        PARTICIPANT_META_KEY_RECENT_RESULTS: recent_results,
        PARTICIPANT_META_KEY_CONSECUTIVE_FAILURES: consecutive_failures,
        PARTICIPANT_META_KEY_RECENT_ATTENTION_SCORE: recent_attention_score,
        PARTICIPANT_META_KEY_LAST_CHECKED_AT: datetime.now(timezone.utc).isoformat(),
    }
    return {
        "participant_meta": updated_meta,
        "consecutive_failures": consecutive_failures,
        "recent_attention_score": recent_attention_score,
        "hard_flag_triggered": hard_flag_triggered,
        "soft_flag_triggered": soft_flag_triggered,
    }


def build_submission_response_payload(
    *,
    word_count: int,
    quality: float,
    attention_passed,
    too_fast: bool,
    survey_index,
    is_survey: bool,
    is_attention: bool,
    tab_switch_count: int,
    page_close_attempts: int,
    network_disconnects: int,
    survey_metrics: dict,
    attention_expected_terms: list,
    attention_matched_terms: list,
    attention_failure_reasons: list,
    consecutive_failures: int,
    recent_attention_score,
    hard_flag_triggered: bool,
):
    return {
        RESPONSE_KEY_STATUS: SUBMISSION_RESPONSE_STATUS,
        RESPONSE_KEY_WORD_COUNT: word_count,
        RESPONSE_KEY_QUALITY_SCORE: quality,
        RESPONSE_KEY_ATTENTION_PASSED: attention_passed,
        RESPONSE_KEY_FLAGGED_TOO_FAST: too_fast,
        RESPONSE_KEY_SURVEY_INDEX: survey_index,
        RESPONSE_KEY_IS_SURVEY: is_survey,
        RESPONSE_KEY_IS_ATTENTION_CHECK: is_attention,
        RESPONSE_KEY_ENGAGEMENT: {
            "tab_switch_count": tab_switch_count,
            "page_close_attempts": page_close_attempts,
            "network_disconnects": network_disconnects,
            "survey_metrics": survey_metrics,
        },
        RESPONSE_KEY_ATTENTION_STATUS: {
            RESPONSE_KEY_IS_ATTENTION_CHECK: is_attention,
            "passed": attention_passed if is_attention else None,
            "expected_terms": attention_expected_terms,
            "matched_terms": attention_matched_terms,
            "failure_reasons": attention_failure_reasons,
            "consecutive_failures": consecutive_failures if is_attention else None,
            "recent_attention_score": recent_attention_score,
            "hard_flag_triggered": hard_flag_triggered,
        },
    }
