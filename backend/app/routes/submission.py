"""
Submission routes module for C.O.G.N.I.T. backend.
Handles survey submissions and survey telemetry capture.
"""

import hashlib
import logging
from datetime import datetime, timezone

from flask import request, g

from app.config import (
    MIN_DESCRIPTION_LENGTH,
    MAX_DESCRIPTION_LENGTH,
    MIN_FEEDBACK_LENGTH,
    MAX_FEEDBACK_LENGTH,
    MIN_RATING,
    MAX_RATING,
    MIN_WORD_COUNT,
    TOO_FAST_SECONDS,
    ATTENTION_HARD_FLAG_CONSEC_FAILS,
    ATTENTION_MIN_DISTINCT_WORDS,
    ATTENTION_MIN_CHAR_LENGTH,
    PRIORITY_WORD_THRESHOLD,
    PRIORITY_ROUNDS_THRESHOLD,
    PRIORITY_ATTENTION_THRESHOLD,
    SUBMIT_RATE_LIMIT,
)
from app.constants.event_constants import HTTP_METHOD_POST
from app.constants.log_messages import LOG_SUBMISSION_FAILED
from app.utils.observability import log_event
from app.constants.request_keys import (
    REQUEST_KEY_DESCRIPTION,
    REQUEST_KEY_FEEDBACK,
    REQUEST_KEY_IDEMPOTENCY_KEY,
    REQUEST_KEY_IMAGE_ID,
    REQUEST_KEY_NETWORK_DISCONNECTS,
    REQUEST_KEY_PAGE_CLOSE_ATTEMPTS,
    REQUEST_KEY_PUBLIC_ID,
    REQUEST_KEY_RATING,
    REQUEST_KEY_SURVEY_CLICKS,
    REQUEST_KEY_SURVEY_KEYPRESSES,
    REQUEST_KEY_SURVEY_MAX_SCROLL_DEPTH_PCT,
    REQUEST_KEY_SURVEY_NETWORK_DISCONNECTS,
    REQUEST_KEY_SURVEY_PAGE_CLOSE_ATTEMPTS,
    REQUEST_KEY_SURVEY_PAGE_VIEWS,
    REQUEST_KEY_SURVEY_TAB_SWITCHES,
    REQUEST_KEY_SURVEY_TIME_SPENT_MS,
    REQUEST_KEY_TAB_SWITCH_COUNT,
    REQUEST_KEY_TIME_SPENT_SECONDS,
    REQUEST_KEY_TURNSTILE_TOKEN,
)
from app.constants.route_constants import SUBMIT_ROUTE
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
    load_idempotent_response,
    save_idempotent_response,
    clamp_time_spent_seconds,
    normalize_engagement_counts,
    dynamic_too_fast_threshold as compute_dynamic_too_fast_threshold,
    evaluate_priority_and_rewards,
    ensure_submission_workflow_state,
    enqueue_submit_post_commit_tasks,
    StateTransitionError,
    emit_domain_event,
    extract_expected_terms,
    extract_survey_metrics,
    fetch_attention_check,
    fetch_latest_success_payment_id,
    fetch_next_survey_index,
    fetch_submission_image_target,
    fetch_submission_participant,
    has_copied_attention_pattern,
    has_duplicate_non_survey_submission,
    insert_attention_event_record,
    insert_submission_record,
    link_payment_submission,
    lock_submission_participant,
    match_attention_terms,
    normalize_for_attention,
    release_image_reservation,
    update_participant_attention_flag,
    update_participant_metadata,
    upsert_participant_activity_stats,
)
from middleware.payment_flow import require_payment_completed


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
@require_payment_completed
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
        return create_error_response("MISSING_FIELDS", {"fields": ["public_id"]})

    turnstile_ok, _ts_data = verify_turnstile_token(turnstile_token, request.remote_addr, request.host)
    if not turnstile_ok:
        return create_error_response("BOT_CHALLENGE_FAILED")

    image_id_str = d.get(REQUEST_KEY_IMAGE_ID)
    if not image_id_str:
        return create_error_response("MISSING_FIELDS", {"fields": ["image_id"]})

    description = (d.get(REQUEST_KEY_DESCRIPTION) or "").strip()
    if len(description) < MIN_DESCRIPTION_LENGTH or len(description) > MAX_DESCRIPTION_LENGTH:
        return create_error_response("DESCRIPTION_LENGTH")

    feedback = (d.get(REQUEST_KEY_FEEDBACK) or "").strip()
    if len(feedback) < MIN_FEEDBACK_LENGTH or len(feedback) > MAX_FEEDBACK_LENGTH:
        return create_error_response("FEEDBACK_LENGTH")

    try:
        rating = int(d[REQUEST_KEY_RATING])
        if not MIN_RATING <= rating <= MAX_RATING:
            raise ValueError
    except Exception:
        return create_error_response("RATING_INVALID")

    word_count = count_words(description)
    if word_count < MIN_WORD_COUNT:
        return create_error_response("WORD_COUNT", {"actual": word_count})

    ts = clamp_time_spent_seconds(d.get(REQUEST_KEY_TIME_SPENT_SECONDS))

    # Derive survey/attention behavior from selected image, not client defaults.
    is_survey = False
    survey_index = None

    iph = get_ip_hash()
    ua = request.headers.get("User-Agent", "")[:512]
    request_hash = build_request_hash({
        REQUEST_KEY_PUBLIC_ID: public_id,
        REQUEST_KEY_IMAGE_ID: image_id_str,
        REQUEST_KEY_DESCRIPTION: description,
        REQUEST_KEY_FEEDBACK: feedback,
        REQUEST_KEY_RATING: rating,
        REQUEST_KEY_TIME_SPENT_SECONDS: ts,
        REQUEST_KEY_TAB_SWITCH_COUNT: d.get(REQUEST_KEY_TAB_SWITCH_COUNT),
        REQUEST_KEY_PAGE_CLOSE_ATTEMPTS: d.get(REQUEST_KEY_PAGE_CLOSE_ATTEMPTS),
        REQUEST_KEY_NETWORK_DISCONNECTS: d.get(REQUEST_KEY_NETWORK_DISCONNECTS),
    })
    survey_metrics = extract_survey_metrics({
        REQUEST_KEY_SURVEY_TIME_SPENT_MS: d.get(REQUEST_KEY_SURVEY_TIME_SPENT_MS),
        REQUEST_KEY_SURVEY_PAGE_VIEWS: d.get(REQUEST_KEY_SURVEY_PAGE_VIEWS),
        REQUEST_KEY_SURVEY_TAB_SWITCHES: d.get(REQUEST_KEY_SURVEY_TAB_SWITCHES),
        REQUEST_KEY_SURVEY_PAGE_CLOSE_ATTEMPTS: d.get(REQUEST_KEY_SURVEY_PAGE_CLOSE_ATTEMPTS),
        REQUEST_KEY_SURVEY_NETWORK_DISCONNECTS: d.get(REQUEST_KEY_SURVEY_NETWORK_DISCONNECTS),
        REQUEST_KEY_SURVEY_MAX_SCROLL_DEPTH_PCT: d.get(REQUEST_KEY_SURVEY_MAX_SCROLL_DEPTH_PCT),
        REQUEST_KEY_SURVEY_CLICKS: d.get(REQUEST_KEY_SURVEY_CLICKS),
        REQUEST_KEY_SURVEY_KEYPRESSES: d.get(REQUEST_KEY_SURVEY_KEYPRESSES),
    })

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
            return create_error_response("PARTICIPANT_NOT_FOUND")
        if not p_row[1]:
            return create_error_response("CONSENT_REQUIRED")
        try:
            ensure_submission_workflow_state(p_row[4], p_row[5])
        except StateTransitionError as workflow_err:
            log_event(
                logger,
                OBS_EVENT_SUBMIT_BLOCKED_STATE_MACHINE,
                level=logging.WARNING,
                request_id=getattr(g, "request_id", None),
                public_id=public_id,
                reason=str(workflow_err),
            )
            return create_error_response("PAYMENT_INVALID_STATE")

        participant_id = p_row[0]
        participant_meta = p_row[3] or {}
        if not isinstance(participant_meta, dict):
            participant_meta = {}

        if p_row[6]:
            return create_error_response("FLAGGED_ACCOUNT")

        img_row = fetch_submission_image_target(db, image_id_str)
        if not img_row:
            return create_error_response("INVALID_IMAGE_ID")
        image_id_fk = img_row[0]
        is_survey = bool(img_row[1])

        if is_survey:
            lock_submission_participant(db, participant_id)
            survey_index = fetch_next_survey_index(db, participant_id)
        else:
            survey_index = None

            if has_duplicate_non_survey_submission(db, participant_id=participant_id, image_id_fk=image_id_fk):
                return create_error_response("DUPLICATE_SUBMISSION")

        ac_row = fetch_attention_check(db, image_id_fk)

        is_attention = ac_row is not None
        attention_passed = None
        attention_expected_terms = []
        attention_matched_terms = []
        attention_failure_reasons = []
        description_fingerprint = hashlib.sha256(normalize_for_attention(description).encode("utf-8")).hexdigest()
        distinct_word_count = len(set(alphabetic_tokens(description)))
        if is_attention:
            expected = ac_row[0].strip().lower()
            strict = ac_row[1]
            attention_expected_terms = extract_expected_terms(expected) or [normalize_for_attention(expected)]
            attention_matched_terms = match_attention_terms(description, attention_expected_terms, strict)
            attention_passed = len(attention_matched_terms) > 0
            if not attention_passed:
                attention_failure_reasons.append(ATTENTION_FAILURE_MISSING_EXPECTED_KEYWORD)

            if len(description.strip()) < ATTENTION_MIN_CHAR_LENGTH:
                attention_passed = False
                attention_failure_reasons.append(ATTENTION_FAILURE_TOO_SHORT)

            if distinct_word_count < ATTENTION_MIN_DISTINCT_WORDS:
                attention_passed = False
                attention_failure_reasons.append(ATTENTION_FAILURE_LOW_DISTINCT_WORD_COUNT)

            copied = has_copied_attention_pattern(
                db,
                image_id_fk=image_id_fk,
                description_fingerprint=description_fingerprint,
                participant_id=participant_id,
            )
            if copied:
                attention_passed = False
                attention_failure_reasons.append(ATTENTION_FAILURE_COPIED_PATTERN)

        dynamic_too_fast_threshold = compute_dynamic_too_fast_threshold(TOO_FAST_SECONDS, word_count)
        too_fast = ts is not None and ts < dynamic_too_fast_threshold
        if is_attention and too_fast:
            attention_passed = False
            attention_failure_reasons.append(ATTENTION_FAILURE_TOO_FAST)

        submission_meta = {}
        if is_attention:
            submission_meta[SUBMISSION_META_KEY_ATTENTION] = {
                SUBMISSION_META_KEY_STRICT: bool(ac_row[1]),
                SUBMISSION_META_KEY_EXPECTED_TERMS: attention_expected_terms,
                SUBMISSION_META_KEY_MATCHED_TERMS: attention_matched_terms,
                SUBMISSION_META_KEY_FAILURE_REASONS: attention_failure_reasons,
                SUBMISSION_META_KEY_DISTINCT_WORD_COUNT: distinct_word_count,
                SUBMISSION_META_KEY_CONTENT_FINGERPRINT: description_fingerprint,
            }

        engagement = normalize_engagement_counts(d)
        tab_switch_count = engagement["tab_switch_count"]
        page_close_attempts = engagement["page_close_attempts"]
        network_disconnects = engagement["network_disconnects"]
        if survey_metrics["survey_time_spent_ms"] == 0 and ts is not None:
            survey_metrics["survey_time_spent_ms"] = max(0, int(float(ts) * 1000))
        if survey_metrics["survey_page_views"] == 0:
            survey_metrics["survey_page_views"] = 1
        if survey_metrics["survey_tab_switches"] == 0:
            survey_metrics["survey_tab_switches"] = tab_switch_count
        if survey_metrics["survey_page_close_attempts"] == 0:
            survey_metrics["survey_page_close_attempts"] = page_close_attempts
        if survey_metrics["survey_network_disconnects"] == 0:
            survey_metrics["survey_network_disconnects"] = network_disconnects

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

        submission_id = insert_submission_record(
            db,
            participant_id=participant_id,
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
            ip_hash=iph,
            user_agent=ua,
            submission_meta=submission_meta,
            tab_switch_count=tab_switch_count,
            page_close_attempts=page_close_attempts,
            network_disconnects=network_disconnects,
            survey_metrics=survey_metrics,
        )

        consecutive_failures = 0
        recent_attention_score = None
        hard_flag_triggered = False

        if is_attention:
            monitor = participant_meta.get(PARTICIPANT_META_KEY_ATTENTION_MONITOR, {})
            recent_results = monitor.get(PARTICIPANT_META_KEY_RECENT_RESULTS, [])
            if not isinstance(recent_results, list):
                recent_results = []
            recent_results = [bool(x) for x in recent_results[-9:]]
            recent_results.append(bool(attention_passed))

            for result in reversed(recent_results):
                if result:
                    break
                consecutive_failures += 1

            recent_attention_score = round(sum(1 for x in recent_results if x) / len(recent_results), 4)
            hard_flag_triggered = consecutive_failures >= ATTENTION_HARD_FLAG_CONSEC_FAILS

            participant_meta[PARTICIPANT_META_KEY_ATTENTION_MONITOR] = {
                PARTICIPANT_META_KEY_RECENT_RESULTS: recent_results,
                PARTICIPANT_META_KEY_CONSECUTIVE_FAILURES: consecutive_failures,
                PARTICIPANT_META_KEY_RECENT_ATTENTION_SCORE: recent_attention_score,
                PARTICIPANT_META_KEY_LAST_CHECKED_AT: datetime.now(timezone.utc).isoformat(),
            }

            update_participant_metadata(db, participant_id=participant_id, participant_meta=participant_meta)
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
            update_participant_attention_flag(db, participant_id=participant_id, hard_flag_triggered=hard_flag_triggered)

        upsert_participant_activity_stats(
            db,
            participant_id=participant_id,
            word_count=word_count,
            survey_round_increment=1 if is_survey else 0,
            priority_word_threshold=PRIORITY_WORD_THRESHOLD,
            priority_rounds_threshold=PRIORITY_ROUNDS_THRESHOLD,
            priority_attention_threshold=PRIORITY_ATTENTION_THRESHOLD,
        )

        # Link submission to participant's latest successful payment (if any).
        latest_success_payment_id = fetch_latest_success_payment_id(db, participant_id)
        if latest_success_payment_id:
            link_payment_submission(db, payment_id=latest_success_payment_id, submission_id=submission_id)

        # Release image reservation on successful submission (soft release).
        try:
            release_image_reservation(db, image_id=image_id_str, participant_id=participant_id)
        except Exception:
            log_event(logger, OBS_EVENT_SUBMISSION_RELEASE_RESERVATION_FAILED, level=logging.WARNING)

        db.commit()
        enqueue_submit_post_commit_tasks(
            engine=engine,
            emit_domain_event_fn=emit_domain_event,
            evaluate_priority_and_rewards_fn=evaluate_priority_and_rewards,
            participant_id=int(participant_id),
            submission_id=int(submission_id),
            image_id_str=str(image_id_str),
            is_survey=bool(is_survey),
            is_attention=bool(is_attention),
            survey_index=survey_index,
            quality=float(quality),
            word_count=int(word_count),
        )

        response_payload = {
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
                "hard_flag_triggered": hard_flag_triggered
            }
        }
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
            return create_error_response("SURVEY_EXISTS")
        logger.error(LOG_SUBMISSION_FAILED, getattr(g, "request_id", None), public_id, exc)
        return create_error_response("DATABASE_ERROR")
