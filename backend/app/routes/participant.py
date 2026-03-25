"""Participant routes module for C.O.G.N.I.T. backend."""

import hashlib
import json
import logging
from contextlib import suppress

from flask import Blueprint, g, request
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.constants.event_constants import (
    AUDIT_EVENT_CONSENT_RECORDED,
    AUDIT_EVENT_PARTICIPANT_CREATED,
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
from app.constants.audit_details import AUDIT_DETAIL_PARTICIPANT_CREATED
from app.constants.observability_constants import OBS_EVENT_PARTICIPANT_CREATE_ROLLBACK_FAILED
from app.constants.participant_constants import (
    PARTICIPANT_FIELD_EMAIL,
    PARTICIPANT_FIELD_USERNAME,
    PARTICIPANT_STAGE_CONSENT,
    PARTICIPANT_STAGE_USER_DETAILS,
    PARTICIPANT_STATUS_CONSENT_RECORDED,
    PARTICIPANT_STATUS_CREATED,
)
from app.constants.request_keys import (
    REQUEST_KEY_EMAIL,
    REQUEST_KEY_EMAIL_UPDATE,
    REQUEST_KEY_IDEMPOTENCY_KEY,
    REQUEST_KEY_OTP,
    REQUEST_KEY_PUBLIC_ID,
    REQUEST_KEY_TURNSTILE_TOKEN,
    REQUEST_KEY_USERNAME,
)
from app.constants.response_keys import (
    RESPONSE_KEY_AVAILABLE,
    RESPONSE_KEY_EMAIL,
    RESPONSE_KEY_EMAIL_VERIFIED,
    RESPONSE_KEY_EXPIRES_AT,
    RESPONSE_KEY_PUBLIC_ID,
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
)
from app.config import (
    CONSENT_RATE_LIMIT,
    EMAIL_OTP_LENGTH,
    EMAIL_OTP_REQUEST_RATE_LIMIT,
    EMAIL_OTP_VERIFY_RATE_LIMIT,
    PARTICIPANT_CHECK_RATE_LIMIT,
    PARTICIPANT_CREATE_RATE_LIMIT,
    PARTICIPANT_PUBLIC_COOKIE_NAME,
    PARTICIPANT_SESSION_COOKIE_NAME,
    PARTICIPANT_OPTIONS_CACHE_TTL_SECONDS,
)
from app.database import get_db
from app.extensions import limiter
from app.services import (
    EmailOtpSendError,
    build_email_otp_payload,
    collect_missing_participant_fields,
    email_in_use_by_other,
    enqueue_email_otp,
    fetch_latest_email_otp,
    fetch_participant_by_public_email,
    fetch_participant_by_public_id,
    fetch_participant_options,
    find_existing_participant_conflict,
    generate_email_otp,
    generate_public_id,
    generate_session_id,
    get_existing_session_id_for_public_id,
    hash_email_otp,
    increment_email_otp_attempts,
    insert_email_otp,
    insert_participant,
    is_participant_field_available,
    is_valid_prior_experience_code,
    is_valid_public_id,
    mark_email_otp_used,
    mark_existing_otps_used,
    mark_participant_email_verified,
    otp_expiry_timestamp,
    otp_is_expired,
    otp_is_over_attempts,
    set_participant_cookies,
    send_email_otp,
    update_participant_email,
)
from app.utils.decorators import require_idempotency_key, track_performance
from app.utils.error_mapping import map_participant_create_exception
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
    session_id = generate_session_id(data)

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

        username = str(data[REQUEST_KEY_USERNAME]).strip()[:50]
        email = str(data[REQUEST_KEY_EMAIL]).strip().lower()[:255]
        prior_experience = str(data.get("prior_experience", "")).strip()

        if not is_valid_prior_experience_code(db, prior_experience):
            return create_error_response("VAL_EXPERIENCE_REQUIRED")

        conflict_error_key = find_existing_participant_conflict(
            db,
            username=username,
            email=email,
        )
        if conflict_error_key:
            return create_error_response(conflict_error_key)

        participant_id = insert_participant(
            db,
            public_id=public_id,
            session_id=session_id,
            payload=data,
            ip_hash=iph,
            user_agent=ua,
        )
        log_audit(
            db,
            AUDIT_EVENT_PARTICIPANT_CREATED,
            participant_id=participant_id,
            details=AUDIT_DETAIL_PARTICIPANT_CREATED.format(public_id=public_id),
        )
        db.commit()
        response = success_response({RESPONSE_KEY_STATUS: PARTICIPANT_STATUS_CREATED, RESPONSE_KEY_PUBLIC_ID: public_id, RESPONSE_KEY_SESSION_ID: session_id})
        response = set_participant_cookies(response, public_id, session_id)
        return response, 201
    except IntegrityError as e:
        try:
            db.rollback()
        except Exception:
            log_event(logger, OBS_EVENT_PARTICIPANT_CREATE_ROLLBACK_FAILED, level=logging.WARNING, error=str(e))
        return map_participant_create_exception(
            error=e,
            public_id=public_id,
            get_existing_session_id=lambda value: get_existing_session_id_for_public_id(db, value),
            set_cookies=set_participant_cookies,
        )
    except Exception as e:
        try:
            db.rollback()
        except Exception:
            log_event(logger, OBS_EVENT_PARTICIPANT_CREATE_ROLLBACK_FAILED, level=logging.WARNING, error=str(e))
        logger.error(LOG_PARTICIPANT_CREATE_FAILED, e, getattr(g, "request_id", None))
        return map_participant_create_exception(
            error=e,
            public_id=public_id,
            get_existing_session_id=lambda value: get_existing_session_id_for_public_id(db, value),
            set_cookies=set_participant_cookies,
        )


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
        row = db.execute(text("""
            UPDATE participants
            SET consent_given = true,
                consent_at = CURRENT_TIMESTAMP,
                stage = CASE
                    WHEN stage = :consent_stage THEN :user_details_stage
                    ELSE stage
                END
            WHERE public_id = :pub AND is_deleted = false
            RETURNING id
        """), {
            "pub": public_id,
            "consent_stage": PARTICIPANT_STAGE_CONSENT,
            "user_details_stage": PARTICIPANT_STAGE_USER_DETAILS,
        }).fetchone()
        if not row:
            return create_error_response("NF_CONSENT_PARTICIPANT_NOT_FOUND")
        pid = row[0]
        log_audit(db, AUDIT_EVENT_CONSENT_RECORDED, participant_id=pid)
        response_payload = {RESPONSE_KEY_STATUS: PARTICIPANT_STATUS_CONSENT_RECORDED}
        db.commit()
        return success_response(response_payload)
    except Exception as e:
        with suppress(Exception):
            db.rollback()
        logger.error(LOG_CONSENT_FAILED, e, getattr(g, "request_id", None))
        return create_error_response("SYS_CONSENT_RECORD_FAILED")


@participant_bp.route(PARTICIPANT_SESSION_ROUTE, methods=[HTTP_METHOD_GET])
@limiter.limit(PARTICIPANT_CHECK_RATE_LIMIT)
@track_performance
def get_participant_session():
    """Return participant identifiers from httpOnly cookies (if present)."""
    public_id = (request.cookies.get(PARTICIPANT_PUBLIC_COOKIE_NAME) or "").strip()
    session_id = (request.cookies.get(PARTICIPANT_SESSION_COOKIE_NAME) or "").strip()
    return success_response({
        RESPONSE_KEY_PUBLIC_ID: public_id or None,
        RESPONSE_KEY_SESSION_ID: session_id or None,
    })


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
        participant_row = fetch_participant_by_public_id(db, public_id=public_id)
        if not participant_row:
            return create_error_response("AUTH_EMAIL_MISMATCH")
        participant_id, stored_email, email_verified = participant_row
        if stored_email == email and email_update:
            return create_error_response("AUTH_EMAIL_SAME")
        if stored_email != email:
            if email_in_use_by_other(db, public_id=public_id, email=email):
                return create_error_response("DUP_EMAIL")
            try:
                update_participant_email(db, participant_id=int(participant_id), email=email)
                stored_email = email
                email_verified = False
            except IntegrityError as exc:
                err = str(exc).lower()
                if "check constraint" in err:
                    return create_error_response("VAL_EMAIL_INVALID")
                if "duplicate key" in err or "unique constraint" in err:
                    return create_error_response("DUP_EMAIL")
                return create_error_response("SYS_EMAIL_OTP_REQUEST_FAILED")
        if email_verified:
            return success_response({
                RESPONSE_KEY_EMAIL: stored_email,
                RESPONSE_KEY_EMAIL_VERIFIED: True,
            })
        otp = generate_email_otp()
        otp_hash = hash_email_otp(public_id=public_id, email=email, otp=otp)
        expires_at = otp_expiry_timestamp()
        mark_existing_otps_used(db, public_id=public_id, email=stored_email)
        otp_id = insert_email_otp(db, public_id=public_id, email=stored_email, otp_hash=otp_hash, expires_at=expires_at)
        db.commit()
        try:
            enqueue_email_otp(
                build_email_otp_payload(email=stored_email, otp=otp, public_id=public_id),
                otp_id=otp_id,
                idempotency_key=f"email-otp-request:{public_id}:{otp_id}",
            )
        except Exception:
            try:
                send_email_otp(
                    build_email_otp_payload(email=stored_email, otp=otp, public_id=public_id),
                )
            except EmailOtpSendError as exc:
                error_key = "AUTH_EMAIL_OTP_SEND_FAILED"
                if exc.kind == "timeout":
                    error_key = "AUTH_EMAIL_OTP_SEND_TIMEOUT"
                elif exc.kind == "http_error":
                    error_key = "AUTH_EMAIL_OTP_SEND_HTTP_ERROR"
                logger.warning(
                    "email_otp_send_failed",
                    extra={
                        "event": "email_otp_send_failed",
                        "kind": exc.kind,
                        "status_code": exc.status_code,
                        "request_id": getattr(g, "request_id", None),
                    },
                )
                mark_email_otp_used(db, otp_id=otp_id)
                db.commit()
                return create_error_response(error_key)
            except Exception:
                mark_email_otp_used(db, otp_id=otp_id)
                db.commit()
                return create_error_response("AUTH_EMAIL_OTP_SEND_FAILED")
        return success_response({
            RESPONSE_KEY_EMAIL: stored_email,
            RESPONSE_KEY_EMAIL_VERIFIED: False,
            RESPONSE_KEY_EXPIRES_AT: expires_at.isoformat(),
        })
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
        participant_row = fetch_participant_by_public_email(db, public_id=public_id, email=email)
        if not participant_row:
            return create_error_response("AUTH_EMAIL_MISMATCH")
        participant_id, stored_email, email_verified = participant_row
        if email_verified:
            mark_participant_email_verified(db, participant_id=int(participant_id))
            db.commit()
            return success_response({
                RESPONSE_KEY_EMAIL: stored_email,
                RESPONSE_KEY_EMAIL_VERIFIED: True,
            })
        latest = fetch_latest_email_otp(db, public_id=public_id, email=email)
        if not latest:
            return create_error_response("AUTH_EMAIL_OTP_NOT_FOUND")
        otp_id, otp_hash, attempts, is_used, expires_at = latest
        if is_used:
            return create_error_response("AUTH_EMAIL_OTP_INVALID")
        if otp_is_over_attempts(attempts):
            return create_error_response("AUTH_EMAIL_OTP_TOO_MANY")
        if otp_is_expired(expires_at):
            return create_error_response("AUTH_EMAIL_OTP_EXPIRED")
        expected = hash_email_otp(public_id=public_id, email=email, otp=otp)
        if expected != otp_hash:
            increment_email_otp_attempts(db, otp_id=int(otp_id))
            db.commit()
            return create_error_response("AUTH_EMAIL_OTP_INVALID")
        mark_email_otp_used(db, otp_id=int(otp_id))
        mark_participant_email_verified(db, participant_id=int(participant_id))
        db.commit()
        return success_response({
            RESPONSE_KEY_EMAIL: stored_email,
            RESPONSE_KEY_EMAIL_VERIFIED: True,
        })
    except Exception:
        return create_error_response("SYS_EMAIL_OTP_VERIFY_FAILED")
