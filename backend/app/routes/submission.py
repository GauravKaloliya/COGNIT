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
    SUBMIT_ENDPOINT,
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

@submission_bp.route("/submit", methods=["POST"])
@require_payment_completed
@limiter.limit(SUBMIT_RATE_LIMIT)
@track_performance
@require_idempotency_key
def submit():
    """Submit an image description or survey response."""
    d = request.json or {}
    turnstile_token = (d.get("turnstile_token") or "").strip()
    logger.info("submit request_id=%s", getattr(g, "request_id", None))
    idempotency_key = (
        request.headers.get("X-Idempotency-Key")
        or d.get("idempotency_key")
        or ""
    ).strip()[:128]
    public_id = d.get("public_id")
    if not public_id:
        return create_error_response("MISSING_FIELDS", {"fields": ["public_id"]})

    turnstile_ok, _ts_data = verify_turnstile_token(turnstile_token, request.remote_addr, request.host)
    if not turnstile_ok:
        return create_error_response("BOT_CHALLENGE_FAILED")

    image_id_str = d.get("image_id")
    if not image_id_str:
        return create_error_response("MISSING_FIELDS", {"fields": ["image_id"]})

    description = (d.get("description") or "").strip()
    if len(description) < MIN_DESCRIPTION_LENGTH or len(description) > MAX_DESCRIPTION_LENGTH:
        return create_error_response("DESCRIPTION_LENGTH")

    feedback = (d.get("feedback") or "").strip()
    if len(feedback) < MIN_FEEDBACK_LENGTH or len(feedback) > MAX_FEEDBACK_LENGTH:
        return create_error_response("FEEDBACK_LENGTH")

    try:
        rating = int(d["rating"])
        if not MIN_RATING <= rating <= MAX_RATING:
            raise ValueError
    except:
        return create_error_response("RATING_INVALID")

    word_count = count_words(description)
    if word_count < MIN_WORD_COUNT:
        return create_error_response("WORD_COUNT", {"actual": word_count})

    ts = clamp_time_spent_seconds(d.get("time_spent_seconds"))

    # Derive survey/attention behavior from selected image, not client defaults.
    is_survey = False
    survey_index = None

    iph = get_ip_hash()
    ua = request.headers.get("User-Agent", "")[:512]
    request_hash = build_request_hash({
        "public_id": public_id,
        "image_id": image_id_str,
        "description": description,
        "feedback": feedback,
        "rating": rating,
        "time_spent_seconds": ts,
        "tab_switch_count": d.get("tab_switch_count"),
        "page_close_attempts": d.get("page_close_attempts"),
        "network_disconnects": d.get("network_disconnects"),
    })
    survey_metrics = extract_survey_metrics({
        "survey_time_spent_ms": d.get("survey_time_spent_ms"),
        "survey_page_views": d.get("survey_page_views"),
        "survey_tab_switches": d.get("survey_tab_switches"),
        "survey_page_close_attempts": d.get("survey_page_close_attempts"),
        "survey_network_disconnects": d.get("survey_network_disconnects"),
        "survey_max_scroll_depth_pct": d.get("survey_max_scroll_depth_pct"),
        "survey_clicks": d.get("survey_clicks"),
        "survey_keypresses": d.get("survey_keypresses"),
    })

    try:
        db = get_db()
        _idem, replay = load_idempotent_response(
            db,
            endpoint=SUBMIT_ENDPOINT,
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
            logger.warning(
                "submit blocked by state machine request_id=%s public_id=%s reason=%s",
                getattr(g, "request_id", None),
                public_id,
                workflow_err,
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
            pass

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
        logger.info(
            "submission accepted request_id=%s participant_id=%s submission_id=%s image_id=%s attention=%s passed=%s",
            getattr(g, "request_id", None),
            participant_id,
            submission_id,
            image_id_str,
            is_attention,
            attention_passed,
        )

        response_payload = {
            "status": SUBMISSION_RESPONSE_STATUS,
            "word_count": word_count,
            "quality_score": quality,
            "attention_passed": attention_passed,
            "flagged_too_fast": too_fast,
            "survey_index": survey_index,
            "is_survey": is_survey,
            "is_attention_check": is_attention,
            "engagement": {
                "tab_switch_count": tab_switch_count,
                "page_close_attempts": page_close_attempts,
                "network_disconnects": network_disconnects,
                "survey_metrics": survey_metrics,
            },
            "attention_status": {
                "is_attention_check": is_attention,
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
            endpoint=SUBMIT_ENDPOINT,
            idempotency_key=idempotency_key,
            participant_public_id=public_id,
            request_hash=request_hash,
            response_body=response_payload,
            status_code=200,
        )
        try:
            db.commit()
        except Exception:
            pass
        return success_response(response_payload)

    except Exception as exc:
        try:
            db.rollback()
        except:
            pass
        if "unique" in str(exc).lower() and "survey_index" in str(exc):
            return create_error_response("SURVEY_EXISTS")
        logger.error("submit failed request_id=%s public_id=%s error=%s", getattr(g, "request_id", None), public_id, exc)
        return create_error_response("DATABASE_ERROR")
