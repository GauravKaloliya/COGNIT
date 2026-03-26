"""
Submission routes module for C.O.G.N.I.T. backend.
Handles survey submissions and survey telemetry capture.
"""

import logging
from datetime import datetime, timezone

from flask import request, g
from sqlalchemy import text

from app.config import (
    MIN_DESCRIPTION_LENGTH,
    MAX_DESCRIPTION_LENGTH,
    MIN_FEEDBACK_LENGTH,
    MAX_FEEDBACK_LENGTH,
    MIN_RATING,
    MAX_RATING,
    MIN_WORD_COUNT,
    TOO_FAST_SECONDS,
    STAGE_STALE_TIMEOUT_SECONDS,
    ATTENTION_HARD_FLAG_CONSEC_FAILS,
    ATTENTION_FLAG_MIN_CHECKS,
    ATTENTION_FLAG_THRESHOLD,
    ATTENTION_MIN_DISTINCT_WORDS,
    ATTENTION_MIN_CHAR_LENGTH,
    ATTENTION_MIN_RECALL,
    SUBMIT_RATE_LIMIT,
)
from app.constants.event_constants import HTTP_METHOD_POST
from app.constants.log_messages import LOG_SUBMISSION_FAILED
from app.constants.participant_constants import (
    PARTICIPANT_STAGE_SURVEY,
    PARTICIPANT_STAGE_POST_SURVEY,
)
from app.constants.submission_constants import (
    ATTENTION_FAILURE_LOW_RECALL,
    SUBMISSION_META_KEY_ATTENTION,
    SUBMISSION_META_KEY_FAILURE_REASONS,
)
from app.utils.observability import log_event
from app.constants.request_keys import (
    REQUEST_KEY_AVG_KEYSTROKE_INTERVAL_SECONDS,
    REQUEST_KEY_AVG_PAUSE_DURATION_SECONDS,
    REQUEST_KEY_BACKSPACE_COUNT,
    REQUEST_KEY_CONFIDENCE_SCORE,
    REQUEST_KEY_DESCRIPTION,
    REQUEST_KEY_DIFFICULTY_SELF_REPORT,
    REQUEST_KEY_EDIT_COUNT,
    REQUEST_KEY_FEEDBACK,
    REQUEST_KEY_FIRST_VIEW_DURATION_SECONDS,
    REQUEST_KEY_IDEMPOTENCY_KEY,
    REQUEST_KEY_IMAGE_ID,
    REQUEST_KEY_KEYSTROKE_VARIANCE,
    REQUEST_KEY_NETWORK_DISCONNECTS,
    REQUEST_KEY_PAGE_CLOSE_ATTEMPTS,
    REQUEST_KEY_PAUSE_COUNT,
    REQUEST_KEY_PUBLIC_ID,
    REQUEST_KEY_RATING,
    REQUEST_KEY_SESSION_ID,
    REQUEST_KEY_SURVEY_CLICKS,
    REQUEST_KEY_SURVEY_KEYPRESSES,
    REQUEST_KEY_SURVEY_MAX_SCROLL_DEPTH_PCT,
    REQUEST_KEY_SURVEY_NETWORK_DISCONNECTS,
    REQUEST_KEY_SURVEY_PAGE_CLOSE_ATTEMPTS,
    REQUEST_KEY_SURVEY_PAGE_VIEWS,
    REQUEST_KEY_SURVEY_TAB_SWITCHES,
    REQUEST_KEY_SURVEY_TIME_SPENT_SECONDS,
    REQUEST_KEY_TAB_SWITCH_COUNT,
    REQUEST_KEY_TIME_BEFORE_TYPING_SECONDS,
    REQUEST_KEY_TIME_SPENT_SECONDS,
    REQUEST_KEY_TURNSTILE_TOKEN,
    REQUEST_KEY_WRITING_DURATION_SECONDS,
)
from app.constants.route_constants import SUBMIT_ROUTE
from app.constants.observability_constants import (
    OBS_EVENT_SUBMISSION_COMMIT_FAILED,
    OBS_EVENT_SUBMISSION_RELEASE_RESERVATION_FAILED,
    OBS_EVENT_SUBMISSION_ROLLBACK_FAILED,
    OBS_EVENT_SUBMIT_BLOCKED_STATE_MACHINE,
)
from app.extensions import limiter
from app.database import get_db, engine
from app.utils.helpers import (
    get_ip_hash,
    count_words,
    calculate_quality_score,
    create_error_response,
    success_response,
)
from app.utils.decorators import track_performance, require_idempotency_key
from app.utils.turnstile import verify_turnstile_token
from app.services import (
    alphabetic_tokens,
    build_request_hash,
    compute_alignment,
    load_idempotent_response,
    save_idempotent_response,
    clamp_time_spent_seconds,
    normalize_engagement_counts,
    dynamic_too_fast_threshold as compute_dynamic_too_fast_threshold,
    end_participant_session,
    enqueue_submit_post_commit_tasks,
    ensure_participant_session,
    extract_objects,
    fetch_participant_attention_stats,
    StateTransitionError,
    emit_domain_event,
    extract_expected_terms,
    extract_submission_phase_metrics,
    extract_survey_metrics,
    fetch_attention_check,
    fetch_next_survey_index,
    fetch_submission_image_target,
    fetch_submission_participant,
    get_ground_truth_objects,
    has_copied_attention_pattern,
    has_duplicate_non_survey_submission,
    insert_attention_event_record,
    insert_submission_record,
    infer_device_type,
    lock_submission_participant,
    match_attention_terms,
    normalize_objects,
    normalize_for_attention,
    release_image_reservation,
    update_participant_attention_flag,
    update_participant_metadata,
    update_participant_stage,
)
from app.services.submission_processing_service import (
    apply_attention_monitor,
    build_submission_response_payload,
    evaluate_attention_result,
    merge_submission_engagement,
)
from app.services.survey_sequence_service import (
    REQUIRED_SUBMISSIONS,
    STEP_ATTENTION,
    STEP_SURVEY,
    expected_step_for_submission_count,
    resolve_two_step_sequence,
)


# ────────────────────────────────────────────────
# Blueprint Setup
# ────────────────────────────────────────────────

from flask import Blueprint
submission_bp = Blueprint('submission', __name__)
logger = logging.getLogger(__name__)


# ────────────────────────────────────────────────
# Routes
# ────────────────────────────────────────────────

@submission_bp.route(SUBMIT_ROUTE, methods=[HTTP_METHOD_POST])
@limiter.limit(SUBMIT_RATE_LIMIT)
@track_performance
@require_idempotency_key
def submit():
    """Submit an image description or survey response."""
    d = request.json or {}
    turnstile_token = (d.get(REQUEST_KEY_TURNSTILE_TOKEN) or "").strip()
    idempotency_key = (
        request.headers.get("X-Idempotency-Key")
        or d.get(REQUEST_KEY_IDEMPOTENCY_KEY)
        or ""
    ).strip()[:128]
    public_id = d.get(REQUEST_KEY_PUBLIC_ID)
    if not public_id:
        return create_error_response("VAL_SUBMISSION_PUBLIC_ID_REQUIRED")

    turnstile_ok, _ts_data = verify_turnstile_token(
        turnstile_token,
        request.remote_addr,
        request.host,
        endpoint=request.path,
        idempotency_key=idempotency_key,
    )
    if not turnstile_ok:
        return create_error_response("BOT_SUBMISSION_FAILED")

    image_id_str = d.get(REQUEST_KEY_IMAGE_ID)
    if not image_id_str:
        return create_error_response("VAL_SUBMISSION_IMAGE_ID_REQUIRED")

    description = (d.get(REQUEST_KEY_DESCRIPTION) or "").strip()
    if len(description) < MIN_DESCRIPTION_LENGTH or len(description) > MAX_DESCRIPTION_LENGTH:
        return create_error_response("VAL_DESC_LENGTH")

    feedback = (d.get(REQUEST_KEY_FEEDBACK) or "").strip()
    if len(feedback) < MIN_FEEDBACK_LENGTH or len(feedback) > MAX_FEEDBACK_LENGTH:
        return create_error_response("VAL_FEEDBACK_LENGTH")

    try:
        rating = int(d[REQUEST_KEY_RATING])
        if not MIN_RATING <= rating <= MAX_RATING:
            raise ValueError
    except Exception:
        return create_error_response("VAL_RATING_INVALID")

    try:
        difficulty_self_report = int(d[REQUEST_KEY_DIFFICULTY_SELF_REPORT])
        if not MIN_RATING <= difficulty_self_report <= MAX_RATING:
            raise ValueError
    except Exception:
        return create_error_response("VAL_RATING_INVALID")

    try:
        confidence_score = int(d[REQUEST_KEY_CONFIDENCE_SCORE])
        if not MIN_RATING <= confidence_score <= MAX_RATING:
            raise ValueError
    except Exception:
        return create_error_response("VAL_RATING_INVALID")

    word_count = count_words(description)
    if word_count < MIN_WORD_COUNT:
        return create_error_response("VAL_WORD_COUNT", {"actual": word_count})

    ts = clamp_time_spent_seconds(d.get(REQUEST_KEY_TIME_SPENT_SECONDS))

    # Derive survey/attention behavior from selected image, not client defaults.
    is_survey = False
    survey_index = None

    iph = get_ip_hash()
    ua = request.headers.get("User-Agent", "")[:512]
    device_type = infer_device_type(ua)
    request_hash = build_request_hash({
        REQUEST_KEY_PUBLIC_ID: public_id,
        REQUEST_KEY_IMAGE_ID: image_id_str,
        REQUEST_KEY_DESCRIPTION: description,
        REQUEST_KEY_FEEDBACK: feedback,
        REQUEST_KEY_RATING: rating,
        REQUEST_KEY_SESSION_ID: d.get(REQUEST_KEY_SESSION_ID),
        REQUEST_KEY_TIME_SPENT_SECONDS: ts,
        REQUEST_KEY_TAB_SWITCH_COUNT: d.get(REQUEST_KEY_TAB_SWITCH_COUNT),
        REQUEST_KEY_PAGE_CLOSE_ATTEMPTS: d.get(REQUEST_KEY_PAGE_CLOSE_ATTEMPTS),
        REQUEST_KEY_NETWORK_DISCONNECTS: d.get(REQUEST_KEY_NETWORK_DISCONNECTS),
        REQUEST_KEY_CONFIDENCE_SCORE: d.get(REQUEST_KEY_CONFIDENCE_SCORE),
        REQUEST_KEY_DIFFICULTY_SELF_REPORT: d.get(REQUEST_KEY_DIFFICULTY_SELF_REPORT),
        REQUEST_KEY_TIME_BEFORE_TYPING_SECONDS: d.get(REQUEST_KEY_TIME_BEFORE_TYPING_SECONDS),
        REQUEST_KEY_EDIT_COUNT: d.get(REQUEST_KEY_EDIT_COUNT),
        REQUEST_KEY_BACKSPACE_COUNT: d.get(REQUEST_KEY_BACKSPACE_COUNT),
        REQUEST_KEY_FIRST_VIEW_DURATION_SECONDS: d.get(REQUEST_KEY_FIRST_VIEW_DURATION_SECONDS),
        REQUEST_KEY_WRITING_DURATION_SECONDS: d.get(REQUEST_KEY_WRITING_DURATION_SECONDS),
        REQUEST_KEY_AVG_KEYSTROKE_INTERVAL_SECONDS: d.get(REQUEST_KEY_AVG_KEYSTROKE_INTERVAL_SECONDS),
        REQUEST_KEY_KEYSTROKE_VARIANCE: d.get(REQUEST_KEY_KEYSTROKE_VARIANCE),
        REQUEST_KEY_PAUSE_COUNT: d.get(REQUEST_KEY_PAUSE_COUNT),
        REQUEST_KEY_AVG_PAUSE_DURATION_SECONDS: d.get(REQUEST_KEY_AVG_PAUSE_DURATION_SECONDS),
    })
    survey_metrics = extract_survey_metrics({
        REQUEST_KEY_SURVEY_TIME_SPENT_SECONDS: d.get(REQUEST_KEY_SURVEY_TIME_SPENT_SECONDS),
        REQUEST_KEY_SURVEY_PAGE_VIEWS: d.get(REQUEST_KEY_SURVEY_PAGE_VIEWS),
        REQUEST_KEY_SURVEY_TAB_SWITCHES: d.get(REQUEST_KEY_SURVEY_TAB_SWITCHES),
        REQUEST_KEY_SURVEY_PAGE_CLOSE_ATTEMPTS: d.get(REQUEST_KEY_SURVEY_PAGE_CLOSE_ATTEMPTS),
        REQUEST_KEY_SURVEY_NETWORK_DISCONNECTS: d.get(REQUEST_KEY_SURVEY_NETWORK_DISCONNECTS),
        REQUEST_KEY_SURVEY_MAX_SCROLL_DEPTH_PCT: d.get(REQUEST_KEY_SURVEY_MAX_SCROLL_DEPTH_PCT),
        REQUEST_KEY_SURVEY_CLICKS: d.get(REQUEST_KEY_SURVEY_CLICKS),
        REQUEST_KEY_SURVEY_KEYPRESSES: d.get(REQUEST_KEY_SURVEY_KEYPRESSES),
    })
    d[REQUEST_KEY_DIFFICULTY_SELF_REPORT] = difficulty_self_report
    d[REQUEST_KEY_CONFIDENCE_SCORE] = confidence_score
    phase_data = extract_submission_phase_metrics(d, description=description)

    try:
        db = get_db()
        _idem, replay = load_idempotent_response(
            db,
            endpoint=SUBMIT_ROUTE,
            idempotency_key=idempotency_key,
            participant_public_id=public_id,
            request_hash=request_hash,
        )
        if replay:
            payload, status_code = replay
            return success_response(payload), status_code

        p_row = fetch_submission_participant(db, public_id)

        if not p_row or p_row[2]:
            return create_error_response("NF_SUBMISSION_PARTICIPANT_NOT_FOUND")
        if not p_row[1]:
            return create_error_response("AUTH_CONSENT_REQUIRED")
        current_stage = str(p_row[4] or "")
        if current_stage != PARTICIPANT_STAGE_SURVEY:
            workflow_err = StateTransitionError(f"Submission not allowed when stage='{current_stage}'")
            log_event(
                logger,
                OBS_EVENT_SUBMIT_BLOCKED_STATE_MACHINE,
                level=logging.WARNING,
                request_id=getattr(g, "request_id", None),
                public_id=public_id,
                reason=str(workflow_err),
            )
            return create_error_response("VAL_INVALID_STATE", {"current_stage": current_stage})

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
            return create_error_response("AUTH_ACCOUNT_FLAGGED")

        # Additional moderation guard from aggregated DB stats.
        if pre_total_checks >= ATTENTION_FLAG_MIN_CHECKS and pre_attention_score < float(ATTENTION_FLAG_THRESHOLD):
            return create_error_response("AUTH_ACCOUNT_FLAGGED")

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
                        request_id=getattr(g, "request_id", None),
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
            return create_error_response("VAL_INVALID_IMAGE_ID")
        image_id_fk = img_row[0]
        is_survey_image = bool(img_row[1])

        lock_submission_participant(db, participant_id)
        submission_stats_row = db.execute(
            text(
                """
                SELECT
                    COUNT(*) AS total_submissions,
                    COUNT(*) FILTER (WHERE is_attention_check = true) AS attention_submissions,
                    COUNT(*) FILTER (WHERE is_attention_check IS DISTINCT FROM true) AS survey_submissions
                FROM submissions
                WHERE participant_id = :pid
                """
            ),
            {"pid": int(participant_id)},
        ).fetchone()
        total_submissions = int(submission_stats_row[0] or 0) if submission_stats_row else 0
        attention_submissions = int(submission_stats_row[1] or 0) if submission_stats_row else 0
        survey_submissions = int(submission_stats_row[2] or 0) if submission_stats_row else 0

        if total_submissions >= REQUIRED_SUBMISSIONS:
            return create_error_response(
                "VAL_INVALID_STATE",
                {
                    "current_stage": current_stage,
                    "reason": "submission_limit_reached",
                },
            )

        survey_index = fetch_next_survey_index(db, participant_id) if is_survey_image else None

        ac_row = fetch_attention_check(db, image_id_fk)

        is_attention = ac_row is not None
        is_survey = bool(is_survey_image and not is_attention)
        if not is_survey:
            survey_index = None
            if has_duplicate_non_survey_submission(db, participant_id=participant_id, image_id_fk=image_id_fk):
                return create_error_response("DUP_SUBMISSION")
        submitted_step = STEP_ATTENTION if is_attention else STEP_SURVEY
        expected_step = expected_step_for_submission_count(sequence_order, total_submissions)
        if expected_step is not None and submitted_step != expected_step:
            return create_error_response(
                "VAL_INVALID_STATE",
                {
                    "current_stage": current_stage,
                    "reason": "invalid_submission_order",
                    "expected_step": expected_step,
                    "received_step": submitted_step,
                },
            )
        if is_attention and attention_submissions >= 1:
            return create_error_response(
                "VAL_INVALID_STATE",
                {
                    "current_stage": current_stage,
                    "reason": "duplicate_attention_submission",
                },
            )
        if (not is_attention) and survey_submissions >= 1:
            return create_error_response(
                "VAL_INVALID_STATE",
                {
                    "current_stage": current_stage,
                    "reason": "duplicate_survey_submission",
                },
            )

        distinct_word_count = len(set(alphabetic_tokens(description)))
        dynamic_too_fast_threshold = compute_dynamic_too_fast_threshold(TOO_FAST_SECONDS, word_count)
        too_fast = ts is not None and ts < dynamic_too_fast_threshold
        attention_result = evaluate_attention_result(
            db=db,
            is_attention=is_attention,
            attention_check_row=ac_row,
            description=description,
            normalize_for_attention=normalize_for_attention,
            extract_expected_terms=extract_expected_terms,
            match_attention_terms=match_attention_terms,
            has_copied_attention_pattern=has_copied_attention_pattern,
            image_id_fk=image_id_fk,
            participant_id=participant_id,
            distinct_word_count=distinct_word_count,
            attention_min_char_length=ATTENTION_MIN_CHAR_LENGTH,
            attention_min_distinct_words=ATTENTION_MIN_DISTINCT_WORDS,
            too_fast=bool(is_attention and too_fast),
        )
        attention_passed = attention_result["attention_passed"]
        attention_expected_terms = attention_result["attention_expected_terms"]
        attention_matched_terms = attention_result["attention_matched_terms"]
        attention_failure_reasons = attention_result["attention_failure_reasons"]
        description_fingerprint = attention_result["description_fingerprint"]
        submission_meta = attention_result["submission_meta"]

        user_objects = extract_objects(description)
        gt_objects = get_ground_truth_objects(db, image_id_fk)
        normalized_user_objects = normalize_objects(user_objects)
        normalized_gt_objects = normalize_objects(gt_objects)
        alignment = compute_alignment(normalized_user_objects, normalized_gt_objects)
        alignment_score = alignment["f1"] if alignment else None
        if alignment:
            submission_meta = dict(submission_meta)
            submission_meta["alignment"] = {
                "precision": alignment["precision"],
                "recall": alignment["recall"],
                "f1": alignment["f1"],
                "correct": alignment["correct"],
                "wrong": alignment["wrong"],
                "missed": alignment["missed"],
            }
            if is_attention and alignment["recall"] < float(ATTENTION_MIN_RECALL):
                attention_passed = False
                if ATTENTION_FAILURE_LOW_RECALL not in attention_failure_reasons:
                    attention_failure_reasons.append(ATTENTION_FAILURE_LOW_RECALL)
                if SUBMISSION_META_KEY_ATTENTION in submission_meta:
                    attention_meta = dict(submission_meta[SUBMISSION_META_KEY_ATTENTION])
                    reasons = list(attention_meta.get(SUBMISSION_META_KEY_FAILURE_REASONS, []))
                    if ATTENTION_FAILURE_LOW_RECALL not in reasons:
                        reasons.append(ATTENTION_FAILURE_LOW_RECALL)
                    attention_meta[SUBMISSION_META_KEY_FAILURE_REASONS] = reasons
                    submission_meta[SUBMISSION_META_KEY_ATTENTION] = attention_meta

        engagement_result = merge_submission_engagement(
            normalize_engagement_counts=normalize_engagement_counts,
            payload=d,
            survey_metrics=survey_metrics,
            time_spent_seconds=ts,
        )
        tab_switch_count = engagement_result["tab_switch_count"]
        page_close_attempts = engagement_result["page_close_attempts"]
        network_disconnects = engagement_result["network_disconnects"]
        survey_metrics = engagement_result["survey_metrics"]

        quality = calculate_quality_score(
            word_count,
            attention_passed,
            ts,
            len(feedback),
            False,
            distinct_word_count=distinct_word_count,
            tab_switch_count=tab_switch_count,
            page_close_attempts=page_close_attempts,
            network_disconnects=network_disconnects,
            too_fast_threshold=dynamic_too_fast_threshold,
        )
        if alignment_score is not None:
            quality = (0.6 * quality) + (0.4 * alignment_score)
            if alignment and alignment["wrong"]:
                quality *= 0.9
            quality = round(max(0.0, min(1.0, quality)), 4)

        payload_session_id = str(d.get(REQUEST_KEY_SESSION_ID) or "").strip()[:128]
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
            time_spent_seconds=ts,
            is_survey=is_survey,
            is_attention=is_attention,
            attention_passed=attention_passed,
            too_fast=too_fast,
            quality=quality,
            alignment_score=alignment_score,
            ip_hash=iph,
            user_agent=ua,
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
        if next_total_submissions >= REQUIRED_SUBMISSIONS:
            update_participant_stage(
                db,
                participant_id=participant_id,
                stage=PARTICIPANT_STAGE_POST_SURVEY,
            )
            end_participant_session(
                db,
                participant_id=participant_id,
                participant_session_id=participant_session_id,
            )
            current_stage = PARTICIPANT_STAGE_POST_SURVEY
            stage_updated_at = datetime.now(timezone.utc)

        monitor_result = apply_attention_monitor(
            participant_meta=participant_meta,
            attention_passed=attention_passed,
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
                response_seconds=ts,
                distinct_word_count=distinct_word_count,
                description_fingerprint=description_fingerprint,
            )
            update_participant_attention_flag(
                db,
                participant_id=participant_id,
                hard_flag_triggered=hard_flag_triggered,
                soft_flag_triggered=soft_flag_triggered,
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

        # Prefer DB aggregate stats over metadata-derived score for moderation and response.
        recent_attention_score = post_attention_score
        soft_flag_triggered = (
            post_total_checks >= ATTENTION_FLAG_MIN_CHECKS
            and post_attention_score < float(ATTENTION_FLAG_THRESHOLD)
        )
        hard_flag_triggered = bool(post_is_flagged and not soft_flag_triggered)

        # Release image reservation on successful submission (soft release).
        try:
            release_image_reservation(db, image_id=image_id_str, participant_id=participant_id)
        except Exception:
            log_event(logger, OBS_EVENT_SUBMISSION_RELEASE_RESERVATION_FAILED, level=logging.WARNING)

        db.commit()
        enqueue_submit_post_commit_tasks(
            engine=engine,
            emit_domain_event_fn=emit_domain_event,
            participant_id=int(participant_id),
            submission_id=int(submission_id),
            image_id_str=str(image_id_str),
            is_survey=bool(is_survey),
            is_attention=bool(is_attention),
            survey_index=survey_index,
            quality=float(quality),
            word_count=int(word_count),
            idempotency_key=str(idempotency_key or ""),
        )

        response_payload = build_submission_response_payload(
            word_count=word_count,
            quality=quality,
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
        save_idempotent_response(
            db,
            endpoint=SUBMIT_ROUTE,
            idempotency_key=idempotency_key,
            participant_public_id=public_id,
            request_hash=request_hash,
            response_body=response_payload,
            status_code=200,
        )
        try:
            db.commit()
        except Exception:
            log_event(logger, OBS_EVENT_SUBMISSION_COMMIT_FAILED, level=logging.WARNING)
        return success_response(response_payload)

    except Exception as exc:
        try:
            db.rollback()
        except Exception:
            log_event(logger, OBS_EVENT_SUBMISSION_ROLLBACK_FAILED, level=logging.WARNING, error=str(exc))
        if "unique" in str(exc).lower() and "survey_index" in str(exc):
            return create_error_response("DUP_SURVEY_ROUND")
        logger.error(LOG_SUBMISSION_FAILED, getattr(g, "request_id", None), public_id, exc)
        return create_error_response("SYS_SUBMISSION_SAVE_FAILED")
