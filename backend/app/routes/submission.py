"""
Submission routes module for C.O.G.N.I.T. backend.
Handles survey submissions and survey telemetry capture.
"""

import logging

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
    SUBMIT_RATE_LIMIT,
)
from app.constants.event_constants import HTTP_METHOD_POST
from app.constants.log_messages import LOG_SUBMISSION_FAILED
from app.constants.participant_constants import (
    PARTICIPANT_STAGE_SURVEY,
    PARTICIPANT_STAGE_POST_SURVEY,
)
from app.utils.observability import log_event
from app.constants.request_keys import (
    REQUEST_KEY_AVG_KEYSTROKE_INTERVAL_SECONDS,
    REQUEST_KEY_AVG_PAUSE_DURATION_SECONDS,
    REQUEST_KEY_BACKSPACE_COUNT,
    REQUEST_KEY_CONFIDENCE_RATING,
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
    OBS_EVENT_SUBMISSION_ROLLBACK_FAILED,
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
    clear_participant_cookies,
    compute_alignment,
    load_idempotent_response,
    save_idempotent_response,
    clamp_time_spent_seconds,
    normalize_engagement_counts,
    enqueue_submit_post_commit_tasks,
    StateTransitionError,
    emit_domain_event,
    extract_submission_phase_metrics,
    extract_survey_metrics,
    infer_device_type,
    process_submission_workflow,
    SubmissionWorkflowError,
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
        difficulty_self_report = int(d[REQUEST_KEY_DIFFICULTY_SELF_REPORT])
        if not MIN_RATING <= difficulty_self_report <= MAX_RATING:
            raise ValueError
    except Exception:
        return create_error_response("VAL_RATING_INVALID")

    try:
        confidence_rating = int(d[REQUEST_KEY_CONFIDENCE_RATING])
        if not MIN_RATING <= confidence_rating <= MAX_RATING:
            raise ValueError
    except Exception:
        return create_error_response("VAL_RATING_INVALID")

    word_count = count_words(description)
    if word_count < MIN_WORD_COUNT:
        return create_error_response("VAL_WORD_COUNT", {"actual": word_count})

    ts = clamp_time_spent_seconds(d.get(REQUEST_KEY_TIME_SPENT_SECONDS))

    iph = get_ip_hash()
    ua = request.headers.get("User-Agent", "")[:512]
    device_type = infer_device_type(ua)
    request_hash = build_request_hash({
        REQUEST_KEY_PUBLIC_ID: public_id,
        REQUEST_KEY_IMAGE_ID: image_id_str,
        REQUEST_KEY_DESCRIPTION: description,
        REQUEST_KEY_FEEDBACK: feedback,
        REQUEST_KEY_DIFFICULTY_SELF_REPORT: difficulty_self_report,
        REQUEST_KEY_CONFIDENCE_RATING: confidence_rating,
        REQUEST_KEY_SESSION_ID: d.get(REQUEST_KEY_SESSION_ID),
        REQUEST_KEY_TIME_SPENT_SECONDS: ts,
        REQUEST_KEY_TAB_SWITCH_COUNT: d.get(REQUEST_KEY_TAB_SWITCH_COUNT),
        REQUEST_KEY_PAGE_CLOSE_ATTEMPTS: d.get(REQUEST_KEY_PAGE_CLOSE_ATTEMPTS),
        REQUEST_KEY_NETWORK_DISCONNECTS: d.get(REQUEST_KEY_NETWORK_DISCONNECTS),
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
    d[REQUEST_KEY_CONFIDENCE_RATING] = confidence_rating
    phase_data = extract_submission_phase_metrics(d, description=description)

    try:
        db = get_db()
        response_payload, status_code = process_submission_workflow(
            db=db,
            engine=engine,
            emit_domain_event_fn=emit_domain_event,
            enqueue_submit_post_commit_tasks_fn=enqueue_submit_post_commit_tasks,
            load_idempotent_response_fn=load_idempotent_response,
            save_idempotent_response_fn=save_idempotent_response,
            request_hash=request_hash,
            idempotency_key=idempotency_key,
            public_id=public_id,
            image_id_str=image_id_str,
            description=description,
            feedback=feedback,
            word_count=word_count,
            time_spent_seconds=ts,
            ip_hash=iph,
            user_agent=ua,
            device_type=device_type,
            payload_session_id=str(d.get(REQUEST_KEY_SESSION_ID) or "").strip()[:128],
            survey_metrics=survey_metrics,
            phase_data=phase_data,
            request_payload=d,
            route_path=SUBMIT_ROUTE,
            request_id=getattr(g, "request_id", None),
        )
        response = success_response(response_payload)
        if response_payload.get("session_closed") or response_payload.get("clear_client_state"):
            response = clear_participant_cookies(response)
        return response
    except SubmissionWorkflowError as exc:
        response, status_code = create_error_response(exc.code, exc.details)
        if (exc.details or {}).get("session_closed") or (exc.details or {}).get("clear_client_state"):
            response = clear_participant_cookies(response)
        return response, status_code

    except Exception as exc:
        try:
            db.rollback()
        except Exception:
            log_event(logger, OBS_EVENT_SUBMISSION_ROLLBACK_FAILED, level=logging.WARNING, error=str(exc))
        if "unique" in str(exc).lower() and "survey_index" in str(exc):
            return create_error_response("DUP_SURVEY_ROUND")
        logger.error(LOG_SUBMISSION_FAILED, getattr(g, "request_id", None), public_id, exc)
        return create_error_response("SYS_SUBMISSION_SAVE_FAILED")
