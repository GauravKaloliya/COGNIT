"""Submission processing helpers for attention evaluation and response shaping."""

from __future__ import annotations

import hashlib

from app.constants.response_keys import (
    RESPONSE_KEY_ATTENTION_PASSED,
    RESPONSE_KEY_ATTENTION_STATUS,
    RESPONSE_KEY_BEHAVIOR_RISK_SCORE,
    RESPONSE_KEY_CLEAR_CLIENT_STATE,
    RESPONSE_KEY_COPY_PASTE_LIKELIHOOD_SCORE,
    RESPONSE_KEY_ENGAGEMENT,
    RESPONSE_KEY_FLAGGED_TOO_FAST,
    RESPONSE_KEY_IS_ATTENTION_CHECK,
    RESPONSE_KEY_IS_SURVEY,
    RESPONSE_KEY_QUALITY_SCORE,
    RESPONSE_KEY_SESSION_CLOSED,
    RESPONSE_KEY_STATUS,
    RESPONSE_KEY_SURVEY_INDEX,
    RESPONSE_KEY_TOO_FAST_MARGIN_SECONDS,
    RESPONSE_KEY_TOO_FAST_SCORE,
    RESPONSE_KEY_TOO_FAST_THRESHOLD_SECONDS,
    RESPONSE_KEY_WORD_COUNT,
    RESPONSE_KEY_WORKFLOW_STATUS,
    RESPONSE_KEY_WRITING_QUALITY_SCORE,
)
from app.constants.submission_constants import (
    ATTENTION_FAILURE_COPIED_PATTERN,
    ATTENTION_FAILURE_LOW_DESCRIPTIVE_RICHNESS,
    ATTENTION_FAILURE_LOW_EXPECTED_TERM_RECALL,
    ATTENTION_FAILURE_LOW_DISTINCT_WORD_COUNT,
    ATTENTION_FAILURE_LOW_RECALL,
    ATTENTION_FAILURE_MISSING_EXPECTED_KEYWORD,
    ATTENTION_FAILURE_REPETITIVE_TEMPLATE,
    ATTENTION_FAILURE_TOO_FAST,
    ATTENTION_FAILURE_TOO_SHORT,
    ATTENTION_TIER_FAIL,
    ATTENTION_TIER_PASS,
    ATTENTION_TIER_SUSPICIOUS,
    ATTENTION_TIER_WEAK_PASS,
    PARTICIPANT_META_KEY_ATTENTION_MONITOR,
    PARTICIPANT_META_KEY_RECENT_ASSESSMENTS,
    PARTICIPANT_META_KEY_RECENT_RESULTS,
    SUBMISSION_META_KEY_ATTENTION,
    SUBMISSION_META_KEY_STRICT,
    SUBMISSION_RESPONSE_STATUS,
)


def evaluate_attention_result(
    *,
    db,
    is_attention: bool,
    attention_check_row,
    ground_truth_objects,
    description: str,
    count_attention_descriptive_tokens,
    detect_repetitive_attention_template,
    normalize_for_attention,
    build_attention_core_terms,
    match_attention_terms,
    has_copied_attention_pattern,
    image_id_fk: int,
    participant_id: int,
    distinct_word_count: int,
    attention_min_char_length: int,
    attention_min_distinct_words: int,
    attention_min_recall: float,
    too_fast: bool,
):
    result = {
        "attention_passed": None,
        "attention_expected_terms": [],
        "attention_matched_terms": [],
        "attention_failure_reasons": [],
        "hard_fail_reasons": [],
        "soft_risk_reasons": [],
        "description_fingerprint": None,
        "strict": False,
        "attention_recall_weak": False,
        "attention_keyword_missing": False,
        "copied_pattern_detected": False,
        "descriptive_token_count": 0,
        "expected_term_recall": 0.0,
        "expected_term_count": 0,
        "matched_term_count": 0,
        "distinct_word_count": distinct_word_count,
        "repetition_metrics": {},
        "repetitive_template_detected": False,
        "submission_meta": {},
    }
    hard_fail_reasons: list[str] = result["hard_fail_reasons"]
    soft_risk_reasons: list[str] = result["soft_risk_reasons"]

    if not is_attention:
        return result

    expected = attention_check_row[0].strip().lower()
    strict = bool(attention_check_row[1])
    description_fingerprint = hashlib.sha256(normalize_for_attention(description).encode("utf-8")).hexdigest()
    attention_expected_terms = (
        build_attention_core_terms(expected, ground_truth_objects)
        or [normalize_for_attention(expected)]
    )
    attention_matched_terms = match_attention_terms(description, attention_expected_terms, strict)
    matched_term_count = len(attention_matched_terms)
    expected_term_count = len(attention_expected_terms)
    expected_term_recall = (
        round(matched_term_count / expected_term_count, 4)
        if expected_term_count > 0 else 0.0
    )
    keyword_missing = matched_term_count == 0
    recall_weak = expected_term_recall < float(attention_min_recall)
    descriptive_token_count = count_attention_descriptive_tokens(description, attention_matched_terms)
    repetitive_template_detected, repetition_metrics = detect_repetitive_attention_template(
        description,
        attention_matched_terms,
    )
    if len(description.strip()) < attention_min_char_length:
        hard_fail_reasons.append(ATTENTION_FAILURE_TOO_SHORT)
    if distinct_word_count < attention_min_distinct_words:
        soft_risk_reasons.append(ATTENTION_FAILURE_LOW_DISTINCT_WORD_COUNT)
    if descriptive_token_count < 5:
        soft_risk_reasons.append(ATTENTION_FAILURE_LOW_DESCRIPTIVE_RICHNESS)
    if repetitive_template_detected:
        hard_fail_reasons.append(ATTENTION_FAILURE_REPETITIVE_TEMPLATE)
    copied_pattern_detected = has_copied_attention_pattern(
        db,
        image_id_fk=image_id_fk,
        description_fingerprint=description_fingerprint,
        participant_id=participant_id,
    )
    if copied_pattern_detected:
        hard_fail_reasons.append(ATTENTION_FAILURE_COPIED_PATTERN)
    if too_fast:
        soft_risk_reasons.append(ATTENTION_FAILURE_TOO_FAST)
    attention_failure_reasons = hard_fail_reasons + soft_risk_reasons

    result.update({
        "attention_passed": True,
        "attention_expected_terms": attention_expected_terms,
        "attention_matched_terms": attention_matched_terms,
        "attention_failure_reasons": attention_failure_reasons,
        "hard_fail_reasons": hard_fail_reasons,
        "soft_risk_reasons": soft_risk_reasons,
        "description_fingerprint": description_fingerprint,
        "strict": strict,
        "attention_recall_weak": recall_weak,
        "attention_keyword_missing": keyword_missing,
        "copied_pattern_detected": copied_pattern_detected,
        "descriptive_token_count": descriptive_token_count,
        "expected_term_recall": expected_term_recall,
        "expected_term_count": expected_term_count,
        "matched_term_count": matched_term_count,
        "distinct_word_count": distinct_word_count,
        "repetition_metrics": repetition_metrics,
        "repetitive_template_detected": repetitive_template_detected,
        "submission_meta": {
            SUBMISSION_META_KEY_ATTENTION: {
                SUBMISSION_META_KEY_STRICT: strict,
            }
        },
    })
    return result


def finalize_attention_assessment(
    *,
    is_attention: bool,
    attention_expected_terms: list[str],
    attention_matched_terms: list[str],
    hard_fail_reasons: list[str],
    soft_risk_reasons: list[str],
    attention_recall_weak: bool,
    attention_keyword_missing: bool,
    copied_pattern_detected: bool,
    repetitive_template_detected: bool,
    descriptive_token_count: int,
    distinct_word_count: int,
    alignment_recall: float,
    alignment_score: float | None,
    expected_term_recall: float,
):
    if not is_attention:
        return {
            "attention_passed": None,
            "attention_tier": None,
            "attention_confidence": None,
            "attention_suspicious": False,
            "hard_fail_reasons": [],
            "soft_risk_reasons": [],
            "failure_reasons": [],
            "supporting_signals": {},
        }

    hard = list(dict.fromkeys(hard_fail_reasons))
    soft = list(dict.fromkeys(soft_risk_reasons))

    if attention_keyword_missing and ATTENTION_FAILURE_MISSING_EXPECTED_KEYWORD not in soft:
        soft.append(ATTENTION_FAILURE_MISSING_EXPECTED_KEYWORD)
    alignment_weak = alignment_recall < 0.4
    if attention_recall_weak and ATTENTION_FAILURE_LOW_EXPECTED_TERM_RECALL not in soft:
        soft.append(ATTENTION_FAILURE_LOW_EXPECTED_TERM_RECALL)
    if alignment_weak and ATTENTION_FAILURE_LOW_RECALL not in soft:
        soft.append(ATTENTION_FAILURE_LOW_RECALL)

    descriptive_score = min(1.0, descriptive_token_count / 12.0)
    alignment_component = max(0.0, min(1.0, float(alignment_score or 0.0)))
    confidence = (
        0.38 * max(0.0, min(1.0, expected_term_recall))
        + 0.34 * max(0.0, min(1.0, alignment_recall))
        + 0.18 * descriptive_score
        + 0.10 * min(1.0, distinct_word_count / 16.0)
    )
    if copied_pattern_detected:
        confidence -= 0.30
    if repetitive_template_detected:
        confidence -= 0.22
    confidence -= min(0.18, max(0, len(soft) - 1) * 0.07)
    confidence = round(max(0.0, min(1.0, confidence)), 4)

    repetitive_only_hard = bool(hard) and all(
        reason == ATTENTION_FAILURE_REPETITIVE_TEMPLATE for reason in hard
    )
    hard_fail_present = bool(hard) and not repetitive_only_hard

    if hard_fail_present or (attention_recall_weak and alignment_weak):
        tier = ATTENTION_TIER_FAIL
    elif repetitive_only_hard and confidence >= 0.52 and expected_term_recall >= 0.7 and alignment_recall >= 0.7:
        tier = ATTENTION_TIER_SUSPICIOUS
    elif confidence >= 0.82 and len(soft) == 0:
        tier = ATTENTION_TIER_PASS
    elif confidence >= 0.64 and len(soft) <= 1 and not repetitive_only_hard:
        tier = ATTENTION_TIER_WEAK_PASS
    elif confidence >= 0.46 or (repetitive_only_hard and confidence >= 0.40):
        tier = ATTENTION_TIER_SUSPICIOUS
    else:
        tier = ATTENTION_TIER_FAIL

    if (
        tier == ATTENTION_TIER_FAIL
        and not (attention_recall_weak and alignment_weak)
        and not hard_fail_present
        and len(soft) <= 2
        and confidence >= 0.38
    ):
        tier = ATTENTION_TIER_SUSPICIOUS

    failure_reasons = hard + soft
    supporting_signals = {
        "expected_term_recall": round(expected_term_recall, 4),
        "alignment_recall": round(alignment_recall, 4),
        "alignment_score": round(alignment_component, 4),
        "descriptive_token_count": int(descriptive_token_count),
        "distinct_word_count": int(distinct_word_count),
        "matched_term_count": len(attention_matched_terms),
        "expected_term_count": len(attention_expected_terms),
    }
    return {
        "attention_passed": tier in {ATTENTION_TIER_PASS, ATTENTION_TIER_WEAK_PASS},
        "attention_tier": tier,
        "attention_confidence": confidence,
        "attention_suspicious": tier in {ATTENTION_TIER_SUSPICIOUS, ATTENTION_TIER_FAIL},
        "hard_fail_reasons": hard,
        "soft_risk_reasons": soft,
        "failure_reasons": failure_reasons,
        "supporting_signals": supporting_signals,
    }


def merge_submission_engagement(*, normalize_engagement_counts, payload: dict, survey_metrics: dict, time_spent_seconds):
    engagement = normalize_engagement_counts(payload)
    tab_switch_count = engagement["tab_switch_count"]
    page_close_attempts = engagement["page_close_attempts"]
    network_disconnects = engagement["network_disconnects"]

    merged_metrics = dict(survey_metrics)
    if merged_metrics["survey_time_spent_seconds"] == 0 and time_spent_seconds is not None:
        merged_metrics["survey_time_spent_seconds"] = max(0.0, float(time_spent_seconds))
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
    attention_tier,
    attention_confidence,
    hard_fail_reasons,
    soft_risk_reasons,
    is_attention: bool,
    checked_at,
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
            "watchlist_triggered": False,
            "enforcement_status": "normal",
        }

    consecutive_failures = 0
    monitor = participant_meta.get(PARTICIPANT_META_KEY_ATTENTION_MONITOR, {})
    recent_results = monitor.get(PARTICIPANT_META_KEY_RECENT_RESULTS, [])
    recent_assessments = monitor.get(PARTICIPANT_META_KEY_RECENT_ASSESSMENTS, [])
    if not isinstance(recent_results, list):
        recent_results = []
    if not isinstance(recent_assessments, list):
        recent_assessments = []
    recent_results = [bool(item) for item in recent_results[-9:]]
    recent_results.append(bool(attention_passed))
    recent_assessments = recent_assessments[-9:]
    recent_assessments.append({
        "passed": bool(attention_passed),
        "tier": attention_tier,
        "confidence": round(float(attention_confidence or 0.0), 4),
        "hard_fail": bool(hard_fail_reasons),
        "soft_risk_count": len(soft_risk_reasons or []),
        "copied_pattern": ATTENTION_FAILURE_COPIED_PATTERN in (hard_fail_reasons or []),
        "low_descriptive": ATTENTION_FAILURE_LOW_DESCRIPTIVE_RICHNESS in (soft_risk_reasons or []),
    })

    for result in reversed(recent_results):
        if result:
            break
        consecutive_failures += 1

    tier_weights = {
        ATTENTION_TIER_PASS: 1.0,
        ATTENTION_TIER_WEAK_PASS: 0.78,
        ATTENTION_TIER_SUSPICIOUS: 0.48,
        ATTENTION_TIER_FAIL: 0.12,
    }
    weighted_total = 0.0
    weight_sum = 0.0
    fail_recent = 0
    suspicious_recent = 0
    copied_recent = 0
    low_descriptive_recent = 0
    for index, item in enumerate(recent_assessments, start=1):
        weight = float(index)
        weight_sum += weight
        confidence = max(0.0, min(1.0, float(item.get("confidence") or 0.0)))
        base_score = tier_weights.get(str(item.get("tier") or ""), 0.0)
        weighted_total += weight * ((0.75 * base_score) + (0.25 * confidence))
        if item.get("tier") == ATTENTION_TIER_FAIL:
            fail_recent += 1
        elif item.get("tier") == ATTENTION_TIER_SUSPICIOUS:
            suspicious_recent += 1
        if item.get("copied_pattern"):
            copied_recent += 1
        if item.get("low_descriptive"):
            low_descriptive_recent += 1
    recent_attention_score = round(weighted_total / weight_sum, 4) if weight_sum else None
    assessment_count = len(recent_assessments)
    effective_hard_fail_threshold = max(2, int(hard_flag_consecutive_fails or 0))
    effective_soft_min_checks = max(2, int(attention_flag_min_checks or 0))
    effective_watchlist_min_checks = 1

    hard_flag_triggered = (
        copied_recent >= 2
        or fail_recent >= 3
        or (
            assessment_count >= effective_hard_fail_threshold
            and consecutive_failures >= effective_hard_fail_threshold
        )
        or (
            assessment_count >= 3
            and fail_recent >= 2
            and recent_attention_score is not None
            and recent_attention_score < max(0.28, float(attention_flag_threshold) - 0.18)
        )
    )
    soft_flag_triggered = (
        assessment_count >= effective_soft_min_checks
        and (
            (recent_attention_score is not None and recent_attention_score < float(attention_flag_threshold))
            or fail_recent >= 2
            or suspicious_recent >= 4
            or (fail_recent >= 1 and suspicious_recent >= 2)
            or low_descriptive_recent >= 2
        )
    )
    watchlist_triggered = (
        assessment_count >= effective_watchlist_min_checks
        and not hard_flag_triggered
        and (
            (recent_attention_score is not None and recent_attention_score < float(attention_flag_threshold) + 0.10)
            or fail_recent >= 1
            or suspicious_recent >= 1
            or copied_recent >= 1
            or low_descriptive_recent >= 1
        )
    )
    enforcement_status = "normal"
    if hard_flag_triggered:
        enforcement_status = "hard_flag"
    elif soft_flag_triggered:
        enforcement_status = "soft_flag"
    elif watchlist_triggered:
        enforcement_status = "watchlist"

    updated_meta = dict(participant_meta)
    updated_meta[PARTICIPANT_META_KEY_ATTENTION_MONITOR] = {
        PARTICIPANT_META_KEY_RECENT_ASSESSMENTS: recent_assessments,
        PARTICIPANT_META_KEY_RECENT_RESULTS: recent_results,
    }
    return {
        "participant_meta": updated_meta,
        "consecutive_failures": consecutive_failures,
        "recent_attention_score": recent_attention_score,
        "hard_flag_triggered": hard_flag_triggered,
        "soft_flag_triggered": soft_flag_triggered,
        "watchlist_triggered": watchlist_triggered,
        "enforcement_status": enforcement_status,
    }


def build_submission_response_payload(
    *,
    word_count: int,
    quality: float,
    writing_quality_score: float | None,
    behavior_risk_score: float | None,
    attention_passed,
    too_fast: bool,
    too_fast_score: float | None,
    too_fast_threshold_seconds: float | None,
    too_fast_margin_seconds: float | None,
    copy_paste_likelihood_score: float | None,
    typing_effort_risk: float | None,
    speed_risk: float | None,
    session_integrity_risk: float | None,
    contradiction_signals: list[str],
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
    attention_tier,
    attention_confidence,
    hard_fail_reasons: list,
    soft_risk_reasons: list,
    supporting_signals: dict,
    consecutive_failures: int,
    recent_attention_score,
    hard_flag_triggered: bool,
    soft_flag_triggered: bool,
    watchlist_triggered: bool,
    enforcement_status: str,
    attention_total_checks: int | None = None,
    attention_passed_checks: int | None = None,
    attention_failed_checks: int | None = None,
    stage=None,
    stage_updated_at=None,
    stage_stale_seconds: int | None = None,
    stage_escalation_recommended: bool = False,
    session_closed: bool = False,
    clear_client_state: bool = False,
):
    return {
        RESPONSE_KEY_STATUS: SUBMISSION_RESPONSE_STATUS,
        RESPONSE_KEY_WORD_COUNT: word_count,
        RESPONSE_KEY_QUALITY_SCORE: quality,
        RESPONSE_KEY_WRITING_QUALITY_SCORE: writing_quality_score,
        RESPONSE_KEY_BEHAVIOR_RISK_SCORE: behavior_risk_score,
        RESPONSE_KEY_COPY_PASTE_LIKELIHOOD_SCORE: copy_paste_likelihood_score,
        RESPONSE_KEY_ATTENTION_PASSED: attention_passed,
        RESPONSE_KEY_FLAGGED_TOO_FAST: too_fast,
        RESPONSE_KEY_TOO_FAST_SCORE: too_fast_score,
        RESPONSE_KEY_TOO_FAST_THRESHOLD_SECONDS: too_fast_threshold_seconds,
        RESPONSE_KEY_TOO_FAST_MARGIN_SECONDS: too_fast_margin_seconds,
        RESPONSE_KEY_SURVEY_INDEX: survey_index,
        RESPONSE_KEY_IS_SURVEY: is_survey,
        RESPONSE_KEY_IS_ATTENTION_CHECK: is_attention,
        RESPONSE_KEY_ENGAGEMENT: {
            "tab_switch_count": tab_switch_count,
            "page_close_attempts": page_close_attempts,
            "network_disconnects": network_disconnects,
            "survey_metrics": survey_metrics,
            "typing_effort_risk": typing_effort_risk,
            "speed_risk": speed_risk,
            "session_integrity_risk": session_integrity_risk,
            "contradiction_signals": contradiction_signals,
        },
        RESPONSE_KEY_ATTENTION_STATUS: {
            RESPONSE_KEY_IS_ATTENTION_CHECK: is_attention,
            "passed": attention_passed if is_attention else None,
            "tier": attention_tier if is_attention else None,
            "confidence": attention_confidence if is_attention else None,
            "expected_terms": attention_expected_terms,
            "matched_terms": attention_matched_terms,
            "failure_reasons": attention_failure_reasons,
            "hard_fail_reasons": hard_fail_reasons if is_attention else [],
            "soft_risk_reasons": soft_risk_reasons if is_attention else [],
            "supporting_signals": supporting_signals if is_attention else {},
            "consecutive_failures": consecutive_failures if is_attention else None,
            "recent_attention_score": recent_attention_score,
            "hard_flag_triggered": hard_flag_triggered,
            "soft_flag_triggered": soft_flag_triggered,
            "watchlist_triggered": watchlist_triggered,
            "enforcement_status": enforcement_status,
            "total_checks": attention_total_checks,
            "passed_checks": attention_passed_checks,
            "failed_checks": attention_failed_checks,
        },
        RESPONSE_KEY_SESSION_CLOSED: bool(session_closed),
        RESPONSE_KEY_CLEAR_CLIENT_STATE: bool(clear_client_state),
        RESPONSE_KEY_WORKFLOW_STATUS: {
            "stage": stage,
            "stage_updated_at": (
                stage_updated_at.isoformat() if hasattr(stage_updated_at, "isoformat") else stage_updated_at
            ),
            "stage_stale_seconds": stage_stale_seconds,
            "escalation_recommended": bool(stage_escalation_recommended),
        },
    }
