"""Participant routes module for C.O.G.N.I.T. backend."""

import hashlib
import json
import logging
from contextlib import suppress

from flask import Blueprint, g, request

from app.constants.event_constants import (
    AUDIT_EVENT_CONSENT_RECORDED,
    HTTP_METHOD_GET,
    HTTP_METHOD_POST,
)
from app.constants.log_messages import (
    LOG_CHECK_EMAIL_FAILED,
    LOG_CHECK_USERNAME_FAILED,
    LOG_CONSENT_FAILED,
    LOG_PARTICIPANT_CREATE_FAILED,
    LOG_PARTICIPANT_OPTIONS_FAILED,
)
from app.utils.observability import log_event
from app.constants.audit_details import (
    AUDIT_DETAIL_CONSENT_RECORDED,
)
from app.constants.observability_constants import OBS_EVENT_PARTICIPANT_CREATE_ROLLBACK_FAILED
from app.constants.participant_constants import (
    PARTICIPANT_FIELD_EMAIL,
    PARTICIPANT_FIELD_USERNAME,
    PARTICIPANT_STATUS_CONSENT_RECORDED,
)
from app.constants.request_keys import (
    REQUEST_KEY_EMAIL,
    REQUEST_KEY_EMAIL_UPDATE,
    REQUEST_KEY_IDEMPOTENCY_KEY,
    REQUEST_KEY_OTP,
    REQUEST_KEY_PRESENCE_STATE,
    REQUEST_KEY_PUBLIC_ID,
    REQUEST_KEY_SESSION_ID,
    REQUEST_KEY_TURNSTILE_TOKEN,
)
from app.constants.response_keys import (
    RESPONSE_KEY_AVAILABLE,
    RESPONSE_KEY_CLEAR_CLIENT_STATE,
    RESPONSE_KEY_PRESENCE_STATE,
    RESPONSE_KEY_PUBLIC_ID,
    RESPONSE_KEY_SESSION_CLOSED,
    RESPONSE_KEY_SESSION_ID,
    RESPONSE_KEY_STATUS,
)
from app.constants.route_constants import (
    CHECK_EMAIL_ROUTE,
    CHECK_USERNAME_ROUTE,
    CONSENT_ROUTE,
    EMAIL_OTP_REQUEST_ROUTE,
    EMAIL_OTP_VERIFY_ROUTE,
    PARTICIPANTS_ROUTE,
    PARTICIPANT_OPTIONS_ROUTE,
    PARTICIPANT_SESSION_ROUTE,
    PARTICIPANT_SESSION_PRESENCE_ROUTE,
    PARTICIPANT_SESSION_CLOSE_ROUTE,
)
from app.config import (
    CONSENT_RATE_LIMIT,
    EMAIL_OTP_LENGTH,
    EMAIL_OTP_REQUEST_RATE_LIMIT,
    EMAIL_OTP_VERIFY_RATE_LIMIT,
    PARTICIPANT_CHECK_RATE_LIMIT,
    PARTICIPANT_CREATE_RATE_LIMIT,
    PARTICIPANT_SESSION_RATE_LIMIT,
    PARTICIPANT_PUBLIC_COOKIE_NAME,
    PARTICIPANT_SESSION_COOKIE_NAME,
    PARTICIPANT_OPTIONS_CACHE_TTL_SECONDS,
)
from app.database import get_db
from app.extensions import limiter
from app.services import (
    close_participant_session_by_key,
    clear_participant_cookies,
    collect_missing_participant_fields,
    fetch_participant_session_status,
    fetch_participant_options,
    generate_public_id,
    generate_session_id,
    ensure_participant_session,
    is_participant_session_stale,
    is_participant_field_available,
    is_valid_public_id,
    mark_participant_session_hidden,
    set_participant_cookies,
    touch_participant_session,
    create_participant_workflow,
    request_email_otp_workflow,
    verify_email_otp_workflow,
)
from app.services.participant_state_service import (
    apply_participant_stage_event,
    record_participant_consent,
)
from app.services.state_machine_service import PARTICIPANT_STAGE_EVENTS
from app.utils.decorators import require_idempotency_key, track_performance
from app.utils.helpers import (
    create_error_response,
    get_ip_hash,
    log_audit,
    success_response,
)
from app.utils.turnstile import verify_turnstile_token
from app.utils.cache import cache


participant_bp = Blueprint('participant', __name__)
logger = logging.getLogger(__name__)
PARTICIPANT_OPTIONS_CACHE_KEY = "participant_options:v1"

# ────────────────────────────────────────────────
# Routes
# ────────────────────────────────────────────────

@participant_bp.route(PARTICIPANTS_ROUTE, methods=[HTTP_METHOD_POST])
@limiter.limit(PARTICIPANT_CREATE_RATE_LIMIT)
@track_performance
@require_idempotency_key
def create_participant():
    """Create a new participant registration."""
    data = request.json or {}
    turnstile_token = (data.get(REQUEST_KEY_TURNSTILE_TOKEN) or "").strip()
    idempotency_key = (
        request.headers.get("X-Idempotency-Key")
        or data.get(REQUEST_KEY_IDEMPOTENCY_KEY)
        or ""
    ).strip()[:128]
    missing = collect_missing_participant_fields(data)
    if missing:
        return create_error_response("VAL_PARTICIPANT_CREATE_FIELDS_REQUIRED", fields=missing)

    public_id = generate_public_id(data)
    if data.get("public_id") and not is_valid_public_id(public_id):
        return create_error_response("VAL_INVALID_REQUEST_ID", {"field": "public_id"})
    iph = get_ip_hash()
    ua = request.headers.get("User-Agent", "")[:512]

    ok, _ts_data = verify_turnstile_token(
        turnstile_token,
        request.remote_addr,
        request.host,
        endpoint=request.path,
        idempotency_key=idempotency_key,
    )
    if not ok:
        return create_error_response("BOT_PARTICIPANT_CREATE_FAILED")

    try:
        db = get_db()

        result = create_participant_workflow(
            db=db,
            payload=data,
            public_id=public_id,
            ip_hash=iph,
            user_agent=ua,
        )
        return result.response, result.status_code
    except Exception as e:
        try:
            db.rollback()
        except Exception:
            log_event(logger, OBS_EVENT_PARTICIPANT_CREATE_ROLLBACK_FAILED, level=logging.WARNING, error=str(e))
        logger.error(LOG_PARTICIPANT_CREATE_FAILED, e, getattr(g, "request_id", None))
        return create_error_response("SYS_PARTICIPANT_CREATE_FAILED")


@participant_bp.route(CHECK_USERNAME_ROUTE)
@limiter.limit(PARTICIPANT_CHECK_RATE_LIMIT)
@track_performance
def check_username():
    """Check if username is available for registration."""
    username = request.args.get("username", "").strip()
    if not username:
        return create_error_response("VAL_USERNAME_CHECK_REQUIRED")
    if len(username) < 2:
        return success_response({RESPONSE_KEY_AVAILABLE: True})
    try:
        db = get_db()
        return success_response({RESPONSE_KEY_AVAILABLE: is_participant_field_available(db, field_name=PARTICIPANT_FIELD_USERNAME, value=username)})
    except Exception as e:
        logger.error(LOG_CHECK_USERNAME_FAILED, e, getattr(g, "request_id", None))
        return create_error_response("SYS_CHECK_USERNAME_FAILED")


@participant_bp.route(CHECK_EMAIL_ROUTE)
@limiter.limit(PARTICIPANT_CHECK_RATE_LIMIT)
@track_performance
def check_email():
    """Check if email is already registered."""
    email = request.args.get("email", "").strip().lower()
    if not email:
        return create_error_response("VAL_EMAIL_CHECK_REQUIRED")
    try:
        db = get_db()
        return success_response({RESPONSE_KEY_AVAILABLE: is_participant_field_available(db, field_name=PARTICIPANT_FIELD_EMAIL, value=email)})
    except Exception as e:
        logger.error(LOG_CHECK_EMAIL_FAILED, e, getattr(g, "request_id", None))
        return create_error_response("SYS_CHECK_EMAIL_FAILED")


@participant_bp.route(CONSENT_ROUTE, methods=[HTTP_METHOD_POST])
@limiter.limit(CONSENT_RATE_LIMIT)
@track_performance
def record_consent():
    """Record participant consent agreement."""
    data = request.json or {}
    public_id = data.get(REQUEST_KEY_PUBLIC_ID)
    if not public_id:
        return create_error_response("VAL_CONSENT_PUBLIC_ID_REQUIRED")

    try:
        db = get_db()
        session_id = generate_session_id(data)
        row = record_participant_consent(db, public_id=public_id, session_id=session_id)
        if not row:
            return create_error_response("NF_CONSENT_PARTICIPANT_NOT_FOUND")
        pid = row[0]
        current_stage = row[1]
        active_session_id = str(row[2] or "").strip()
        if active_session_id:
            participant_session_id = ensure_participant_session(
                db,
                participant_id=int(pid),
                session_id=active_session_id,
            )
            if participant_session_id is None:
                return create_error_response("VAL_INVALID_STATE", {
                    "current_stage": current_stage,
                    "reason": "session_closed",
                    "session_closed": True,
                    "clear_client_state": True,
                    "session_id": active_session_id,
                })
        apply_participant_stage_event(
            db,
            participant_id=int(pid),
            current_stage=current_stage,
            event=PARTICIPANT_STAGE_EVENTS["consent_recorded"],
        )
        log_audit(
            db,
            AUDIT_EVENT_CONSENT_RECORDED,
            participant_id=pid,
            details=AUDIT_DETAIL_CONSENT_RECORDED.format(participant_id=pid),
        )
        response_payload = {
            RESPONSE_KEY_STATUS: PARTICIPANT_STATUS_CONSENT_RECORDED,
            RESPONSE_KEY_SESSION_ID: active_session_id or None,
        }
        db.commit()
        response = success_response(response_payload)
        if active_session_id:
            response = set_participant_cookies(response, public_id, active_session_id)
        return response
    except Exception as e:
        with suppress(Exception):
            db.rollback()
        logger.error(LOG_CONSENT_FAILED, e, getattr(g, "request_id", None))
        return create_error_response("SYS_CONSENT_RECORD_FAILED")


@participant_bp.route(PARTICIPANT_SESSION_ROUTE, methods=[HTTP_METHOD_GET])
@limiter.limit(PARTICIPANT_SESSION_RATE_LIMIT)
@track_performance
def get_participant_session():
    """Return participant identifiers from httpOnly cookies (if present)."""
    public_id = (request.cookies.get(PARTICIPANT_PUBLIC_COOKIE_NAME) or "").strip()
    session_id = (request.cookies.get(PARTICIPANT_SESSION_COOKIE_NAME) or "").strip()
    if public_id and session_id:
        try:
            db = get_db()
            session_row = fetch_participant_session_status(db, public_id=public_id, session_id=session_id)
            if session_row is not None:
                ended_at = session_row[1]
                last_seen_at = session_row[2]
                hidden_at = session_row[3]
                if ended_at is not None or is_participant_session_stale(last_seen_at, hidden_at):
                    if ended_at is None:
                        close_participant_session_by_key(db, public_id=public_id, session_id=session_id)
                        db.commit()
                    response = success_response({
                        RESPONSE_KEY_PUBLIC_ID: None,
                        RESPONSE_KEY_SESSION_ID: None,
                        RESPONSE_KEY_SESSION_CLOSED: True,
                        RESPONSE_KEY_CLEAR_CLIENT_STATE: True,
                    })
                    return clear_participant_cookies(response)
                touch_participant_session(db, public_id=public_id, session_id=session_id)
                db.commit()
        except Exception:
            pass
    return success_response({
        RESPONSE_KEY_PUBLIC_ID: public_id or None,
        RESPONSE_KEY_SESSION_ID: session_id or None,
        RESPONSE_KEY_SESSION_CLOSED: False,
        RESPONSE_KEY_CLEAR_CLIENT_STATE: False,
    })


@participant_bp.route(PARTICIPANT_SESSION_PRESENCE_ROUTE, methods=[HTTP_METHOD_POST])
@limiter.limit(PARTICIPANT_SESSION_RATE_LIMIT)
@track_performance
def update_participant_session_presence():
    payload = request.json or {}
    public_id = str(
        payload.get(REQUEST_KEY_PUBLIC_ID)
        or request.cookies.get(PARTICIPANT_PUBLIC_COOKIE_NAME)
        or ""
    ).strip()
    session_id = str(
        payload.get(REQUEST_KEY_SESSION_ID)
        or request.cookies.get(PARTICIPANT_SESSION_COOKIE_NAME)
        or ""
    ).strip()
    presence_state = str(payload.get(REQUEST_KEY_PRESENCE_STATE) or "").strip().lower()

    if not public_id or not session_id:
        response = success_response({
            RESPONSE_KEY_PRESENCE_STATE: "ignored",
            RESPONSE_KEY_SESSION_CLOSED: False,
            RESPONSE_KEY_CLEAR_CLIENT_STATE: False,
        })
        return clear_participant_cookies(response)

    if presence_state not in {"active", "hidden"}:
        return create_error_response("VAL_INVALID_STATE", {"field": REQUEST_KEY_PRESENCE_STATE})

    try:
        db = get_db()
        if presence_state == "hidden":
            row = mark_participant_session_hidden(db, public_id=public_id, session_id=session_id)
        else:
            row = touch_participant_session(db, public_id=public_id, session_id=session_id)
        db.commit()
        if row is None:
            response = success_response({
                RESPONSE_KEY_PRESENCE_STATE: presence_state,
                RESPONSE_KEY_SESSION_CLOSED: True,
                RESPONSE_KEY_CLEAR_CLIENT_STATE: True,
            })
            return clear_participant_cookies(response)
    except Exception:
        return success_response({
            RESPONSE_KEY_PRESENCE_STATE: presence_state,
            RESPONSE_KEY_SESSION_CLOSED: False,
            RESPONSE_KEY_CLEAR_CLIENT_STATE: False,
        })

    return success_response({
        RESPONSE_KEY_PRESENCE_STATE: presence_state,
        RESPONSE_KEY_SESSION_CLOSED: False,
        RESPONSE_KEY_CLEAR_CLIENT_STATE: False,
    })


@participant_bp.route(PARTICIPANT_SESSION_CLOSE_ROUTE, methods=[HTTP_METHOD_POST])
@limiter.limit(PARTICIPANT_SESSION_RATE_LIMIT)
@track_performance
def close_participant_session():
    payload = request.json or {}
    public_id = str(
        payload.get(REQUEST_KEY_PUBLIC_ID)
        or request.cookies.get(PARTICIPANT_PUBLIC_COOKIE_NAME)
        or ""
    ).strip()
    session_id = str(
        payload.get(REQUEST_KEY_SESSION_ID)
        or request.cookies.get(PARTICIPANT_SESSION_COOKIE_NAME)
        or ""
    ).strip()
    if not public_id or not session_id:
        response = success_response({"closed": False, "ignored": True})
        return clear_participant_cookies(response)

    try:
        db = get_db()
        close_participant_session_by_key(db, public_id=public_id, session_id=session_id)
        db.commit()
    except Exception:
        pass

    response = success_response({
        "closed": True,
        RESPONSE_KEY_SESSION_CLOSED: True,
        RESPONSE_KEY_CLEAR_CLIENT_STATE: True,
    })
    return clear_participant_cookies(response)


@participant_bp.route(PARTICIPANT_OPTIONS_ROUTE, methods=[HTTP_METHOD_GET])
@limiter.limit(PARTICIPANT_CHECK_RATE_LIMIT)
@track_performance
def get_participant_options():
    """Return participant form options sourced from the database."""
    try:
        cached = cache.get_json(PARTICIPANT_OPTIONS_CACHE_KEY)
        if cached and isinstance(cached, dict) and cached.get("payload") and cached.get("etag"):
            etag = str(cached["etag"])
            if request.headers.get("If-None-Match") == etag:
                return ("", 304, {
                    "ETag": etag,
                    "Cache-Control": f"public, max-age={PARTICIPANT_OPTIONS_CACHE_TTL_SECONDS}",
                })
            response = success_response(cached["payload"])
            response.headers["ETag"] = etag
            response.headers["Cache-Control"] = f"public, max-age={PARTICIPANT_OPTIONS_CACHE_TTL_SECONDS}"
            return response

        db = get_db()
        payload = fetch_participant_options(db)
        serialized = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
        etag = hashlib.sha256(serialized.encode("utf-8")).hexdigest()
        cache.set_json(
            PARTICIPANT_OPTIONS_CACHE_KEY,
            {"payload": payload, "etag": etag},
            ttl_seconds=PARTICIPANT_OPTIONS_CACHE_TTL_SECONDS,
        )
        if request.headers.get("If-None-Match") == etag:
            return ("", 304, {
                "ETag": etag,
                "Cache-Control": f"public, max-age={PARTICIPANT_OPTIONS_CACHE_TTL_SECONDS}",
            })
        response = success_response(payload)
        response.headers["ETag"] = etag
        response.headers["Cache-Control"] = f"public, max-age={PARTICIPANT_OPTIONS_CACHE_TTL_SECONDS}"
        return response
    except Exception as e:
        logger.error(LOG_PARTICIPANT_OPTIONS_FAILED, e, getattr(g, "request_id", None))
        return create_error_response("SYS_PARTICIPANT_OPTIONS_FAILED")


@participant_bp.route(EMAIL_OTP_REQUEST_ROUTE, methods=[HTTP_METHOD_POST])
@limiter.limit(EMAIL_OTP_REQUEST_RATE_LIMIT)
@track_performance
def request_email_otp():
    """Request a verification OTP to be sent via email."""
    payload = request.json or {}
    public_id = str(payload.get(REQUEST_KEY_PUBLIC_ID) or "").strip()
    email = str(payload.get(REQUEST_KEY_EMAIL) or "").strip().lower()
    email_update = bool(payload.get(REQUEST_KEY_EMAIL_UPDATE))
    if not public_id or not email:
        return create_error_response("VAL_EMAIL_OTP_REQUEST_FIELDS_REQUIRED")
    if not is_valid_public_id(public_id):
        return create_error_response("VAL_INVALID_REQUEST_ID")
    try:
        db = get_db()
        result = request_email_otp_workflow(
            db=db,
            public_id=public_id,
            email=email,
            email_update=email_update,
            request_id=getattr(g, "request_id", None),
        )
        return result.response, result.status_code
    except Exception:
        return create_error_response("SYS_EMAIL_OTP_REQUEST_FAILED")


@participant_bp.route(EMAIL_OTP_VERIFY_ROUTE, methods=[HTTP_METHOD_POST])
@limiter.limit(EMAIL_OTP_VERIFY_RATE_LIMIT)
@track_performance
def verify_email_otp():
    """Verify an email OTP and mark participant email as verified."""
    payload = request.json or {}
    public_id = str(payload.get(REQUEST_KEY_PUBLIC_ID) or "").strip()
    email = str(payload.get(REQUEST_KEY_EMAIL) or "").strip().lower()
    otp = str(payload.get(REQUEST_KEY_OTP) or "").strip()
    if not public_id or not email or not otp:
        return create_error_response("VAL_EMAIL_OTP_VERIFY_FIELDS_REQUIRED")
    if not is_valid_public_id(public_id):
        return create_error_response("VAL_INVALID_REQUEST_ID")
    if not (otp.isdigit() and len(otp) == int(EMAIL_OTP_LENGTH)):
        return create_error_response("AUTH_EMAIL_OTP_INVALID")
    try:
        db = get_db()
        result = verify_email_otp_workflow(
            db=db,
            public_id=public_id,
            email=email,
            otp=otp,
        )
        return result.response, result.status_code
    except Exception:
        return create_error_response("SYS_EMAIL_OTP_VERIFY_FAILED")
