"""Submission lifecycle orchestration for the submit route."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone

from app.config import (
    ATTENTION_FLAG_MIN_CHECKS,
    ATTENTION_FLAG_THRESHOLD,
    ATTENTION_HARD_FLAG_CONSEC_FAILS,
    ATTENTION_MIN_CHAR_LENGTH,
    ATTENTION_MIN_DISTINCT_WORDS,
    ATTENTION_MIN_RECALL,
    STAGE_STALE_TIMEOUT_SECONDS,
    TOO_FAST_SECONDS,
)
from app.constants.observability_constants import (
    OBS_EVENT_SUBMISSION_RELEASE_RESERVATION_FAILED,
    OBS_EVENT_SUBMIT_BLOCKED_STATE_MACHINE,
)
from app.constants.submission_constants import (
    ATTENTION_FAILURE_LOW_EXPECTED_TERM_RECALL,
    ATTENTION_FAILURE_LOW_RECALL,
    ATTENTION_FAILURE_MISSING_EXPECTED_KEYWORD,
    SUBMISSION_META_KEY_ATTENTION,
    SUBMISSION_META_KEY_ATTENTION_CONFIDENCE,
    SUBMISSION_META_KEY_ATTENTION_TIER,
    SUBMISSION_META_KEY_FAILURE_REASONS,
    SUBMISSION_META_KEY_HARD_FAIL_REASONS,
    SUBMISSION_META_KEY_SOFT_RISK_REASONS,
    SUBMISSION_META_KEY_SUPPORTING_SIGNALS,
)
from app.services.submission_processing_service import (
    apply_attention_monitor,
    build_submission_response_payload,
    evaluate_attention_result,
    finalize_attention_assessment,
    merge_submission_engagement,
)
from app.services.submission_query_service import (
    end_participant_session,
    ensure_participant_session,
    fetch_attention_check,
    fetch_next_survey_index,
    fetch_participant_attention_stats,
    fetch_submission_counts,
    fetch_submission_image_target,
    fetch_submission_participant,
    has_copied_attention_pattern,
    has_duplicate_non_survey_submission,
    insert_attention_event_record,
    insert_submission_record,
    lock_submission_participant,
    release_all_participant_reservations,
    release_image_reservation,
    update_participant_attention_flag,
    update_participant_metadata,
)
from app.services.participant_state_service import apply_participant_stage_event
from app.services.submission_service import (
    alphabetic_tokens,
    build_attention_core_terms,
    count_attention_descriptive_tokens,
    detect_repetitive_attention_template,
    compute_alignment,
    dynamic_too_fast_threshold,
    extract_objects,
    get_ground_truth_objects,
    match_attention_terms,
    normalize_engagement_counts,
    normalize_for_attention,
    normalize_objects,
)
from app.services.state_machine_service import (
    PARTICIPANT_STAGE_EVENTS,
    StateTransitionError,
    require_participant_stage,
    transition_participant_stage,
)
from app.services.survey_sequence_service import (
    REQUIRED_SUBMISSIONS,
    STEP_ATTENTION,
    STEP_SURVEY,
    expected_step_for_submission_count,
    resolve_two_step_sequence,
)
from app.utils.observability import log_event

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class SubmissionWorkflowError(Exception):
    code: str
    details: dict | None = None

    def __str__(self) -> str:
        return self.code


def process_submission_workflow(
    *,
    db,
    engine,
    emit_domain_event_fn,
    enqueue_submit_post_commit_tasks_fn,
    load_idempotent_response_fn,
    save_idempotent_response_fn,
    request_hash: str,
    idempotency_key: str,
    public_id: str,
    image_id_str: str,
    description: str,
    feedback: str,
    rating: int,
    word_count: int,
    time_spent_seconds: float,
    ip_hash: str,
    user_agent: str,
    device_type: str,
    payload_session_id: str,
    survey_metrics: dict,
    phase_data: dict,
    request_payload: dict,
    route_path: str,
    request_id=None,
):
    _idem, replay = load_idempotent_response_fn(
        db,
        endpoint=route_path,
        idempotency_key=idempotency_key,
        participant_public_id=public_id,
        request_hash=request_hash,
    )
    if replay:
        payload, status_code = replay
        return payload, status_code

    p_row = fetch_submission_participant(db, public_id)
    if not p_row or p_row[2]:
        raise SubmissionWorkflowError("NF_SUBMISSION_PARTICIPANT_NOT_FOUND")
    if not p_row[1]:
        raise SubmissionWorkflowError("AUTH_CONSENT_REQUIRED")

    current_stage = str(p_row[4] or "")
    try:
        current_stage = require_participant_stage(
            current_stage,
            allowed_stages={"survey"},
            event="submit_submission",
        )
    except StateTransitionError:
        log_event(
            logger,
            OBS_EVENT_SUBMIT_BLOCKED_STATE_MACHINE,
            level=logging.WARNING,
            request_id=request_id,
            public_id=public_id,
            reason=f"Submission not allowed when stage='{current_stage}'",
        )
        raise SubmissionWorkflowError("VAL_INVALID_STATE", {"current_stage": current_stage})

    participant_id = p_row[0]
    participant_meta = p_row[3] or {}
    stage_updated_at = p_row[5]
    pre_is_flagged = bool(p_row[6])
    pre_total_checks = int(p_row[7] or 0)
    pre_passed_checks = int(p_row[8] or 0)
    pre_failed_checks = int(p_row[9] or 0)
    pre_attention_score = float(p_row[10] or 1.0)
    stored_session_id = str(p_row[11] or "").strip()
    if not isinstance(participant_meta, dict):
        participant_meta = {}

    sequence_order, sequence_created = resolve_two_step_sequence(participant_meta)
    if sequence_created:
        update_participant_metadata(db, participant_id=participant_id, participant_meta=participant_meta)

    if pre_is_flagged:
        raise SubmissionWorkflowError("AUTH_ACCOUNT_FLAGGED")
    if pre_total_checks >= ATTENTION_FLAG_MIN_CHECKS and pre_attention_score < float(ATTENTION_FLAG_THRESHOLD):
        raise SubmissionWorkflowError("AUTH_ACCOUNT_FLAGGED")

    stage_stale_seconds = None
    stage_escalation_recommended = False
    if stage_updated_at is not None:
        try:
            now_utc = datetime.now(timezone.utc)
            stage_stale_seconds = max(0, int((now_utc - stage_updated_at).total_seconds()))
            stage_escalation_recommended = stage_stale_seconds >= STAGE_STALE_TIMEOUT_SECONDS
            if stage_escalation_recommended:
                log_event(
                    logger,
                    OBS_EVENT_SUBMIT_BLOCKED_STATE_MACHINE,
                    level=logging.WARNING,
                    request_id=request_id,
                    public_id=public_id,
                    reason="stage_stale_timeout_exceeded",
                    stage=current_stage,
                    stage_stale_seconds=stage_stale_seconds,
                )
        except Exception:
            stage_stale_seconds = None
            stage_escalation_recommended = False

    img_row = fetch_submission_image_target(db, image_id_str)
    if not img_row:
        raise SubmissionWorkflowError("VAL_INVALID_IMAGE_ID")
    image_id_fk = img_row[0]
    is_survey_image = bool(img_row[1])

    lock_submission_participant(db, participant_id)
    submission_counts = fetch_submission_counts(db, participant_id=participant_id)
    total_submissions = submission_counts["total_submissions"]
    attention_submissions = submission_counts["attention_submissions"]
    survey_submissions = submission_counts["survey_submissions"]

    if total_submissions >= REQUIRED_SUBMISSIONS:
        raise SubmissionWorkflowError(
            "VAL_INVALID_STATE",
            {"current_stage": current_stage, "reason": "submission_limit_reached"},
        )

    survey_index = fetch_next_survey_index(db, participant_id)
    ac_row = fetch_attention_check(db, image_id_fk)
    is_attention = ac_row is not None
    is_survey = bool(is_survey_image and not is_attention)

    if not is_survey and has_duplicate_non_survey_submission(db, participant_id=participant_id, image_id_fk=image_id_fk):
        raise SubmissionWorkflowError("DUP_SUBMISSION")

    submitted_step = STEP_ATTENTION if is_attention else STEP_SURVEY
    expected_step = expected_step_for_submission_count(sequence_order, total_submissions)
    if expected_step is not None and submitted_step != expected_step:
        raise SubmissionWorkflowError(
            "VAL_INVALID_STATE",
            {
                "current_stage": current_stage,
                "reason": "invalid_submission_order",
                "expected_step": expected_step,
                "received_step": submitted_step,
            },
        )
    if is_attention and attention_submissions >= 1:
        raise SubmissionWorkflowError(
            "VAL_INVALID_STATE",
            {"current_stage": current_stage, "reason": "duplicate_attention_submission"},
        )
    if (not is_attention) and survey_submissions >= 1:
        raise SubmissionWorkflowError(
            "VAL_INVALID_STATE",
            {"current_stage": current_stage, "reason": "duplicate_survey_submission"},
        )

    distinct_word_count = len(set(alphabetic_tokens(description)))
    dynamic_threshold = dynamic_too_fast_threshold(
        TOO_FAST_SECONDS,
        word_count,
        is_attention=bool(is_attention),
        description=description,
        behavior_metrics=phase_data["behavior_metrics"],
    )
    too_fast = time_spent_seconds is not None and time_spent_seconds < dynamic_threshold

    gt_objects = get_ground_truth_objects(db, image_id_fk)
    attention_result = evaluate_attention_result(
        db=db,
        is_attention=is_attention,
        attention_check_row=ac_row,
        ground_truth_objects=gt_objects,
        description=description,
        count_attention_descriptive_tokens=count_attention_descriptive_tokens,
        detect_repetitive_attention_template=detect_repetitive_attention_template,
        normalize_for_attention=normalize_for_attention,
        build_attention_core_terms=build_attention_core_terms,
        match_attention_terms=match_attention_terms,
        has_copied_attention_pattern=has_copied_attention_pattern,
        image_id_fk=image_id_fk,
        participant_id=participant_id,
        distinct_word_count=distinct_word_count,
        attention_min_char_length=ATTENTION_MIN_CHAR_LENGTH,
        attention_min_distinct_words=ATTENTION_MIN_DISTINCT_WORDS,
        attention_min_recall=ATTENTION_MIN_RECALL,
        too_fast=bool(is_attention and too_fast),
    )
    attention_passed = attention_result["attention_passed"]
    attention_expected_terms = attention_result["attention_expected_terms"]
    attention_matched_terms = attention_result["attention_matched_terms"]
    attention_failure_reasons = attention_result["attention_failure_reasons"]
    hard_fail_reasons = attention_result["hard_fail_reasons"]
    soft_risk_reasons = attention_result["soft_risk_reasons"]
    description_fingerprint = attention_result["description_fingerprint"]
    submission_meta = attention_result["submission_meta"]
    attention_recall_weak = bool(attention_result["attention_recall_weak"])
    attention_keyword_missing = bool(attention_result["attention_keyword_missing"])
    copied_pattern_detected = bool(attention_result["copied_pattern_detected"])
    descriptive_token_count = int(attention_result["descriptive_token_count"] or 0)

    user_objects = extract_objects(description)
    normalized_user_objects = normalize_objects(user_objects)
    normalized_gt_objects = normalize_objects(gt_objects)
    alignment_reference_objects = (
        normalize_objects(attention_expected_terms)
        if is_attention and attention_expected_terms
        else normalized_gt_objects
    )
    alignment = compute_alignment(normalized_user_objects, alignment_reference_objects, description)
    alignment_score = alignment["f1"] if alignment else None
    alignment_recall = float(alignment["recall"]) if alignment else 0.0
    expected_term_recall = 0.0
    attention_meta_seed = submission_meta.get(SUBMISSION_META_KEY_ATTENTION, {}) if isinstance(submission_meta, dict) else {}
    if isinstance(attention_meta_seed, dict):
        expected_term_recall = float(attention_meta_seed.get("expected_term_recall", 0.0) or 0.0)
    if alignment:
        submission_meta = dict(submission_meta)
        submission_meta["alignment"] = {
            "precision": alignment["precision"],
            "recall": alignment["recall"],
            "f1": alignment["f1"],
            "object_f1": alignment["object_f1"],
            "relation_score": alignment["relation_score"],
            "scene_consistency_score": alignment["scene_consistency_score"],
            "wrong_object_penalty": alignment["wrong_object_penalty"],
            "natural_language_score": alignment["natural_language_score"],
            "stuffing_penalty": alignment["stuffing_penalty"],
            "style_metrics": alignment["alignment_style_metrics"],
            "relation_hits": alignment["relation_hits"],
            "correct": alignment["correct"],
            "wrong": alignment["wrong"],
            "missed": alignment["missed"],
        }
    finalized_attention = finalize_attention_assessment(
        is_attention=is_attention,
        attention_expected_terms=attention_expected_terms,
        attention_matched_terms=attention_matched_terms,
        hard_fail_reasons=hard_fail_reasons,
        soft_risk_reasons=soft_risk_reasons,
        attention_recall_weak=attention_recall_weak,
        attention_keyword_missing=attention_keyword_missing,
        copied_pattern_detected=copied_pattern_detected,
        repetitive_template_detected=bool(attention_result.get("repetitive_template_detected")),
        descriptive_token_count=descriptive_token_count,
        distinct_word_count=distinct_word_count,
        alignment_recall=alignment_recall,
        alignment_score=alignment_score,
        expected_term_recall=expected_term_recall,
    )
    attention_passed = finalized_attention["attention_passed"]
    attention_suspicious = finalized_attention["attention_suspicious"]
    attention_tier = finalized_attention["attention_tier"]
    attention_confidence = finalized_attention["attention_confidence"]
    hard_fail_reasons = finalized_attention["hard_fail_reasons"]
    soft_risk_reasons = finalized_attention["soft_risk_reasons"]
    attention_failure_reasons = finalized_attention["failure_reasons"]
    supporting_signals = finalized_attention["supporting_signals"]

    submission_meta = dict(submission_meta)
    if is_attention:
        attention_meta = dict(submission_meta.get(SUBMISSION_META_KEY_ATTENTION, {}))
        attention_meta.update({
            "core_term_count": len(attention_expected_terms),
            "keyword_missing": attention_keyword_missing,
            "recall_weak": attention_recall_weak,
            "alignment_weak": alignment_recall < float(ATTENTION_MIN_RECALL),
            "alignment_recall": round(alignment_recall, 4),
            "descriptive_token_count": descriptive_token_count,
            "repetitive_template_detected": bool(attention_result.get("repetitive_template_detected")),
            "suspicious": attention_suspicious,
            SUBMISSION_META_KEY_ATTENTION_TIER: attention_tier,
            SUBMISSION_META_KEY_ATTENTION_CONFIDENCE: attention_confidence,
            SUBMISSION_META_KEY_HARD_FAIL_REASONS: hard_fail_reasons,
            SUBMISSION_META_KEY_SOFT_RISK_REASONS: soft_risk_reasons,
            SUBMISSION_META_KEY_SUPPORTING_SIGNALS: supporting_signals,
        })
        attention_meta[SUBMISSION_META_KEY_FAILURE_REASONS] = attention_failure_reasons
        submission_meta[SUBMISSION_META_KEY_ATTENTION] = attention_meta

    engagement_result = merge_submission_engagement(
        normalize_engagement_counts=normalize_engagement_counts,
        payload=request_payload,
        survey_metrics=survey_metrics,
        time_spent_seconds=time_spent_seconds,
    )
    tab_switch_count = engagement_result["tab_switch_count"]
    page_close_attempts = engagement_result["page_close_attempts"]
    network_disconnects = engagement_result["network_disconnects"]
    survey_metrics = engagement_result["survey_metrics"]

    writing_quality_score, behavior_risk_score, quality = calculate_quality(
        word_count=word_count,
        attention_passed=attention_passed,
        attention_suspicious=attention_suspicious,
        attention_confidence=attention_confidence,
        time_spent_seconds=time_spent_seconds,
        feedback=feedback,
        distinct_word_count=distinct_word_count,
        tab_switch_count=tab_switch_count,
        page_close_attempts=page_close_attempts,
        network_disconnects=network_disconnects,
        dynamic_too_fast_threshold=dynamic_threshold,
        alignment_score=alignment_score,
        alignment=alignment,
        too_fast=too_fast,
        copied_pattern_detected=copied_pattern_detected,
        behavior_metrics=phase_data["behavior_metrics"],
    )
    submission_meta["scores"] = {
        "quality_score": float(quality),
        "writing_quality_score": float(writing_quality_score),
        "behavior_risk_score": float(behavior_risk_score),
    }

    effective_session_id = payload_session_id or stored_session_id
    participant_session_id = ensure_participant_session(
        db,
        participant_id=participant_id,
        session_id=effective_session_id,
    )

    submission_id = insert_submission_record(
        db,
        participant_id=participant_id,
        participant_session_id=participant_session_id,
        image_id_fk=image_id_fk,
        survey_index=survey_index,
        description=description,
        word_count=word_count,
        rating=rating,
        feedback=feedback,
        time_spent_seconds=time_spent_seconds,
        is_survey=is_survey,
        is_attention=is_attention,
        attention_passed=attention_passed,
        too_fast=too_fast,
        quality=quality,
        alignment_score=alignment_score,
        ip_hash=ip_hash,
        user_agent=user_agent,
        device_type=device_type,
        submission_meta=submission_meta,
        tab_switch_count=tab_switch_count,
        page_close_attempts=page_close_attempts,
        network_disconnects=network_disconnects,
        survey_metrics=survey_metrics,
        phase_metrics=phase_data["phase_metrics"],
        behavior_metrics=phase_data["behavior_metrics"],
    )

    next_total_submissions = total_submissions + 1
    next_stage = apply_participant_stage_event(
        db,
        participant_id=participant_id,
        current_stage=current_stage,
        event=PARTICIPANT_STAGE_EVENTS["submission_completed"],
        survey_completed=next_total_submissions >= REQUIRED_SUBMISSIONS,
    )
    if next_stage == "post-survey":
        end_participant_session(db, participant_id=participant_id, participant_session_id=participant_session_id)
        current_stage = next_stage
        stage_updated_at = datetime.now(timezone.utc)

    monitor_result = apply_attention_monitor(
        participant_meta=participant_meta,
        attention_passed=attention_passed,
        attention_tier=attention_tier,
        attention_confidence=attention_confidence,
        hard_fail_reasons=hard_fail_reasons,
        soft_risk_reasons=soft_risk_reasons,
        is_attention=is_attention,
        hard_flag_consecutive_fails=ATTENTION_HARD_FLAG_CONSEC_FAILS,
        attention_flag_min_checks=ATTENTION_FLAG_MIN_CHECKS,
        attention_flag_threshold=ATTENTION_FLAG_THRESHOLD,
    )
    consecutive_failures = monitor_result["consecutive_failures"]
    recent_attention_score = monitor_result["recent_attention_score"]
    hard_flag_triggered = monitor_result["hard_flag_triggered"]
    soft_flag_triggered = monitor_result["soft_flag_triggered"]

    if is_attention:
        update_participant_metadata(db, participant_id=participant_id, participant_meta=monitor_result["participant_meta"])
        insert_attention_event_record(
            db,
            participant_id=participant_id,
            submission_id=submission_id,
            image_id_fk=image_id_fk,
            attention_expected_terms=attention_expected_terms,
            attention_matched_terms=attention_matched_terms,
            attention_failure_reasons=attention_failure_reasons,
            strict=bool(ac_row[1]),
            attention_passed=bool(attention_passed),
            response_seconds=time_spent_seconds,
            distinct_word_count=distinct_word_count,
            description_fingerprint=description_fingerprint,
        )
        update_participant_attention_flag(
            db,
            participant_id=participant_id,
            hard_flag_triggered=hard_flag_triggered,
            soft_flag_triggered=soft_flag_triggered,
            attention_score=recent_attention_score,
        )

    post_stats_row = fetch_participant_attention_stats(db, participant_id=participant_id)
    if post_stats_row:
        post_total_checks = int(post_stats_row[0] or 0)
        post_passed_checks = int(post_stats_row[1] or 0)
        post_failed_checks = int(post_stats_row[2] or 0)
        post_attention_score = float(post_stats_row[3] or 1.0)
        post_is_flagged = bool(post_stats_row[4])
    else:
        post_total_checks = pre_total_checks
        post_passed_checks = pre_passed_checks
        post_failed_checks = pre_failed_checks
        post_attention_score = pre_attention_score
        post_is_flagged = pre_is_flagged

    recent_attention_score = post_attention_score
    soft_flag_triggered = (
        post_total_checks >= ATTENTION_FLAG_MIN_CHECKS
        and post_attention_score < float(ATTENTION_FLAG_THRESHOLD)
    )
    hard_flag_triggered = bool(post_is_flagged and not soft_flag_triggered)

    try:
        release_image_reservation(db, image_id=image_id_str, participant_id=participant_id)
        if next_total_submissions >= REQUIRED_SUBMISSIONS:
            release_all_participant_reservations(db, participant_id=participant_id)
    except Exception:
        log_event(logger, OBS_EVENT_SUBMISSION_RELEASE_RESERVATION_FAILED, level=logging.WARNING)

    db.commit()
    enqueue_submit_post_commit_tasks_fn(
        engine=engine,
        emit_domain_event_fn=emit_domain_event_fn,
        participant_id=int(participant_id),
        submission_id=int(submission_id),
        image_id_str=str(image_id_str),
        is_survey=bool(is_survey),
        is_attention=bool(is_attention),
        survey_index=survey_index,
        quality=float(quality),
        word_count=word_count,
        idempotency_key=str(idempotency_key or ""),
    )

    response_payload = build_submission_response_payload(
        word_count=word_count,
        quality=quality,
        writing_quality_score=writing_quality_score,
        behavior_risk_score=behavior_risk_score,
        attention_passed=attention_passed,
        too_fast=too_fast,
        survey_index=survey_index,
        is_survey=is_survey,
        is_attention=is_attention,
        tab_switch_count=tab_switch_count,
        page_close_attempts=page_close_attempts,
        network_disconnects=network_disconnects,
        survey_metrics=survey_metrics,
        attention_expected_terms=attention_expected_terms,
        attention_matched_terms=attention_matched_terms,
        attention_failure_reasons=attention_failure_reasons,
        attention_tier=attention_tier,
        attention_confidence=attention_confidence,
        hard_fail_reasons=hard_fail_reasons,
        soft_risk_reasons=soft_risk_reasons,
        supporting_signals=supporting_signals,
        consecutive_failures=consecutive_failures,
        recent_attention_score=recent_attention_score,
        hard_flag_triggered=hard_flag_triggered,
        attention_total_checks=post_total_checks,
        attention_passed_checks=post_passed_checks,
        attention_failed_checks=post_failed_checks,
        stage=current_stage,
        stage_updated_at=stage_updated_at,
        stage_stale_seconds=stage_stale_seconds,
        stage_escalation_recommended=stage_escalation_recommended,
    )
    save_idempotent_response_fn(
        db,
        endpoint=route_path,
        idempotency_key=idempotency_key,
        participant_public_id=public_id,
        request_hash=request_hash,
        response_body=response_payload,
        status_code=200,
    )
    db.commit()
    return response_payload, 200


def calculate_quality(
    *,
    word_count: int,
    attention_passed,
    attention_suspicious: bool,
    attention_confidence,
    time_spent_seconds: float,
    feedback: str,
    distinct_word_count: int,
    tab_switch_count: int,
    page_close_attempts: int,
    network_disconnects: int,
    dynamic_too_fast_threshold: float,
    alignment_score,
    alignment,
    too_fast: bool,
    copied_pattern_detected: bool,
    behavior_metrics: dict,
):
    from app.utils.helpers import (
        calculate_behavior_risk_score,
        calculate_quality_score,
        calculate_writing_quality_score,
    )

    writing_quality = calculate_writing_quality_score(
        word_count,
        time_spent_seconds,
        len(feedback),
        distinct_word_count=distinct_word_count,
        alignment_score=alignment_score,
    )
    behavior_risk = calculate_behavior_risk_score(
        attention_suspicious=bool(attention_suspicious),
        too_fast=bool(too_fast),
        tab_switch_count=tab_switch_count,
        page_close_attempts=page_close_attempts,
        network_disconnects=network_disconnects,
        copied_pattern=bool(copied_pattern_detected),
        behavior_metrics=behavior_metrics,
    )
    quality = calculate_quality_score(
        writing_quality_score=writing_quality,
        behavior_risk_score=behavior_risk,
        alignment_score=alignment_score,
        attention_trust_score=attention_confidence if attention_passed is not None else None,
        bot=False,
    )
    if alignment_score is not None and alignment and alignment["wrong"]:
        quality *= 0.95
    quality = round(max(0.0, min(1.0, quality)), 4)
    return round(writing_quality, 4), round(behavior_risk, 4), quality
