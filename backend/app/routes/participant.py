"""Participant routes module for C.O.G.N.I.T. backend."""

import logging
from flask import request, g
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.constants.event_constants import (
    AUDIT_EVENT_PARTICIPANT_CREATED,
    HTTP_METHOD_GET,
    HTTP_METHOD_POST,
    PAYMENT_NOT_VERIFIED_REASON,
)
from app.constants.log_messages import (
    LOG_CHECK_EMAIL_FAILED,
    LOG_CHECK_PHONE_FAILED,
    LOG_CHECK_USERNAME_FAILED,
    LOG_CONSENT_FAILED,
    LOG_PARTICIPANT_CREATE_FAILED,
    LOG_PARTICIPANT_OPTIONS_FAILED,
    LOG_PARTICIPANT_PAYMENT_STATUS_FAILED,
)
from app.utils.observability import log_event
from app.constants.audit_details import AUDIT_DETAIL_PARTICIPANT_CREATED
from app.constants.observability_constants import OBS_EVENT_PARTICIPANT_CREATE_ROLLBACK_FAILED
from app.constants.participant_constants import (
    PARTICIPANT_FIELD_EMAIL,
    PARTICIPANT_FIELD_PHONE,
    PARTICIPANT_FIELD_USERNAME,
    PARTICIPANT_PAYMENT_STATUS_PAID,
    PARTICIPANT_STATUS_CONSENT_RECORDED,
    PARTICIPANT_STATUS_CREATED,
)
from app.constants.payment_constants import PAYMENT_STATUS_SUCCESS
from app.constants.request_keys import (
    REQUEST_KEY_EMAIL,
    REQUEST_KEY_EMAIL_UPDATE,
    REQUEST_KEY_IDEMPOTENCY_KEY,
    REQUEST_KEY_OTP,
    REQUEST_KEY_PHONE,
    REQUEST_KEY_PUBLIC_ID,
    REQUEST_KEY_TURNSTILE_TOKEN,
    REQUEST_KEY_USERNAME,
)
from app.constants.response_keys import (
    RESPONSE_KEY_AVAILABLE,
    RESPONSE_KEY_CURRENT_STAGE,
    RESPONSE_KEY_DETECTED_APP,
    RESPONSE_KEY_EMAIL,
    RESPONSE_KEY_EMAIL_VERIFIED,
    RESPONSE_KEY_EXPIRES_AT,
    RESPONSE_KEY_PAYMENT_ID,
    RESPONSE_KEY_PUBLIC_ID,
    RESPONSE_KEY_REASON,
    RESPONSE_KEY_SESSION_ID,
    RESPONSE_KEY_STATUS,
    RESPONSE_KEY_VERIFIED_AT,
)
from app.constants.route_constants import (
    CHECK_EMAIL_ROUTE,
    CHECK_PHONE_ROUTE,
    CHECK_USERNAME_ROUTE,
    CONSENT_ROUTE,
    EMAIL_OTP_REQUEST_ROUTE,
    EMAIL_OTP_VERIFY_ROUTE,
    PARTICIPANTS_ROUTE,
    PARTICIPANT_OPTIONS_ROUTE,
    PARTICIPANT_PAYMENT_STATUS_ROUTE,
    PARTICIPANT_SESSION_ROUTE,
)
from app.extensions import limiter
from app.database import get_db
from app.utils.helpers import (
    get_ip_hash,
    log_audit,
    create_error_response,
    success_response,
)
from app.utils.runtime_cache import set_cached_participant_id
from app.utils.decorators import track_performance, require_idempotency_key
from app.utils.turnstile import verify_turnstile_token
from app.services import (
    build_request_hash,
    collect_missing_participant_fields,
    fetch_participant_options,
    find_existing_participant_conflict,
    generate_public_id,
    generate_session_id,
    get_existing_session_id_for_public_id,
    insert_participant,
    is_participant_field_available,
    is_valid_public_id,
    load_idempotent_response,
    save_idempotent_response,
    set_participant_cookies,
    build_email_otp_payload,
    email_in_use_by_other,
    fetch_latest_email_otp,
    fetch_participant_by_public_email,
    fetch_participant_by_public_id,
    generate_email_otp,
    hash_email_otp,
    increment_email_otp_attempts,
    insert_email_otp,
    mark_email_otp_used,
    mark_existing_otps_used,
    mark_participant_email_verified,
    update_participant_email,
    otp_expiry_timestamp,
    otp_is_expired,
    otp_is_over_attempts,
    send_email_otp,
)
from app.utils.error_mapping import map_participant_create_exception
from app.config import (
    PARTICIPANT_CREATE_RATE_LIMIT,
    PARTICIPANT_CHECK_RATE_LIMIT,
    CONSENT_RATE_LIMIT,
    PARTICIPANT_PAYMENT_STATUS_RATE_LIMIT,
    PARTICIPANT_SESSION_COOKIE_NAME,
    PARTICIPANT_PUBLIC_COOKIE_NAME,
    EMAIL_OTP_LENGTH,
    EMAIL_OTP_REQUEST_RATE_LIMIT,
    EMAIL_OTP_VERIFY_RATE_LIMIT,
)


# ────────────────────────────────────────────────
# Blueprint Setup
# ────────────────────────────────────────────────

from flask import Blueprint
participant_bp = Blueprint('participant', __name__)
logger = logging.getLogger(__name__)

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
    missing = collect_missing_participant_fields(data)
    if missing:
        return create_error_response("MISSING_FIELDS", {"fields": missing})

    public_id = generate_public_id(data)
    if data.get("public_id") and not is_valid_public_id(public_id):
        return create_error_response("INVALID_UUID", {"field": "public_id"})
    session_id = generate_session_id(data)

    iph = get_ip_hash()
    ua = request.headers.get("User-Agent", "")[:512]

    try:
        db = get_db()
        ok, _ts_data = verify_turnstile_token(turnstile_token, request.remote_addr, request.host)
        if not ok:
            return create_error_response("BOT_CHALLENGE_FAILED")

        username = str(data[REQUEST_KEY_USERNAME]).strip()[:50]
        email = str(data[REQUEST_KEY_EMAIL]).strip().lower()[:255]
        phone = str(data[REQUEST_KEY_PHONE]).strip()[:20]

        conflict_error_key = find_existing_participant_conflict(
            db,
            username=username,
            email=email,
            phone=phone,
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
        set_cached_participant_id(public_id, int(participant_id))
        
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
        return create_error_response("MISSING_FIELDS", {"fields": ["username"]})
    if len(username) < 2:
        return success_response({RESPONSE_KEY_AVAILABLE: True})
    try:
        db = get_db()
        return success_response({RESPONSE_KEY_AVAILABLE: is_participant_field_available(db, field_name=PARTICIPANT_FIELD_USERNAME, value=username)})
    except Exception as e:
        logger.error(LOG_CHECK_USERNAME_FAILED, e, getattr(g, "request_id", None))
        return create_error_response("DATABASE_ERROR")


@participant_bp.route(CHECK_EMAIL_ROUTE)
@limiter.limit(PARTICIPANT_CHECK_RATE_LIMIT)
@track_performance
def check_email():
    """Check if email is already registered."""
    email = request.args.get("email", "").strip().lower()
    if not email:
        return create_error_response("MISSING_FIELDS", {"fields": ["email"]})
    try:
        db = get_db()
        return success_response({RESPONSE_KEY_AVAILABLE: is_participant_field_available(db, field_name=PARTICIPANT_FIELD_EMAIL, value=email)})
    except Exception as e:
        logger.error(LOG_CHECK_EMAIL_FAILED, e, getattr(g, "request_id", None))
        return create_error_response("DATABASE_ERROR")


@participant_bp.route(CHECK_PHONE_ROUTE)
@limiter.limit(PARTICIPANT_CHECK_RATE_LIMIT)
@track_performance
def check_phone():
    """Check if phone number is already registered."""
    phone = request.args.get("phone", "").strip()
    if not phone:
        return create_error_response("MISSING_FIELDS", {"fields": ["phone"]})
    try:
        db = get_db()
        return success_response({RESPONSE_KEY_AVAILABLE: is_participant_field_available(db, field_name=PARTICIPANT_FIELD_PHONE, value=phone)})
    except Exception as e:
        logger.error(LOG_CHECK_PHONE_FAILED, e, getattr(g, "request_id", None))
        return create_error_response("DATABASE_ERROR")


@participant_bp.route(CONSENT_ROUTE, methods=[HTTP_METHOD_POST])
@limiter.limit(CONSENT_RATE_LIMIT)
@track_performance
def record_consent():
    """Record participant consent agreement."""
    data = request.json or {}
    public_id = data.get(REQUEST_KEY_PUBLIC_ID)
    idempotency_key = (
        request.headers.get("X-Idempotency-Key")
        or data.get(REQUEST_KEY_IDEMPOTENCY_KEY)
        or ""
    ).strip()[:128]
    if not public_id:
        return create_error_response("MISSING_FIELDS", {"fields": ["public_id"]})

    try:
        db = get_db()
        request_hash = ""
        if idempotency_key:
            request_hash = build_request_hash({
                REQUEST_KEY_PUBLIC_ID: str(public_id).strip(),
            })
            _idem, replay = load_idempotent_response(
                db,
                endpoint=CONSENT_ROUTE,
                idempotency_key=idempotency_key,
                participant_public_id=str(public_id).strip(),
                request_hash=request_hash,
            )
            if replay:
                payload, status_code = replay
                return success_response(payload), status_code

        row = db.execute(text("""
            UPDATE participants
            SET consent_given = true, consent_at = CURRENT_TIMESTAMP
            WHERE public_id = :pub AND is_deleted = false
            RETURNING id
        """), {"pub": public_id}).fetchone()
        if not row:
            return create_error_response("PARTICIPANT_NOT_FOUND")
        pid = row[0]
        log_audit(db, "consent_recorded", participant_id=pid)
        response_payload = {RESPONSE_KEY_STATUS: PARTICIPANT_STATUS_CONSENT_RECORDED}
        if idempotency_key:
            save_idempotent_response(
                db,
                endpoint=CONSENT_ROUTE,
                idempotency_key=idempotency_key,
                participant_public_id=str(public_id).strip(),
                request_hash=request_hash,
                response_body=response_payload,
                status_code=200,
            )
        db.commit()
        return success_response(response_payload)
    except Exception as e:
        try:
            db.rollback()
        except Exception:
            pass
        logger.error(LOG_CONSENT_FAILED, e, getattr(g, "request_id", None))
        return create_error_response("INTERNAL_ERROR")


@participant_bp.route(PARTICIPANT_PAYMENT_STATUS_ROUTE)
@limiter.limit(PARTICIPANT_PAYMENT_STATUS_RATE_LIMIT)
@track_performance
def get_participant_payment_status(public_id):
    """
    Get participant's payment status for frontend access control.
    Returns payment verification status to prevent unauthorized survey access.
    """
    if not public_id:
        return create_error_response("MISSING_FIELDS", {"fields": ["public_id"]})
    
    try:
        db = get_db()
        
        row = db.execute(text("""
            SELECT id, payment_status, current_stage
            FROM participants
            WHERE public_id = :pub AND is_deleted = false
        """), {"pub": public_id}).fetchone()
        
        if not row:
            return create_error_response("PARTICIPANT_NOT_FOUND")
        
        participant_id, payment_status, current_stage = row
        
        # Check for successful payment
        is_paid = payment_status == PARTICIPANT_PAYMENT_STATUS_PAID

        # Check for any successful payment record
        payment_row = db.execute(text("""
            SELECT public_id, status, verified_at, detected_app
            FROM payments
            WHERE participant_id = :pid AND status = :payment_success_status
            ORDER BY created_at DESC
            LIMIT 1
        """), {"pid": participant_id, "payment_success_status": PAYMENT_STATUS_SUCCESS}).fetchone()

        return success_response({
            "payment_status": payment_status,
            "is_verified": bool(is_paid and payment_row),
            RESPONSE_KEY_CURRENT_STAGE: current_stage,
            RESPONSE_KEY_PAYMENT_ID: str(payment_row[0]) if payment_row else None,
            RESPONSE_KEY_VERIFIED_AT: payment_row[2].isoformat() if payment_row and payment_row[2] else None,
            RESPONSE_KEY_DETECTED_APP: payment_row[3] if payment_row else None,
            RESPONSE_KEY_REASON: None if is_paid else PAYMENT_NOT_VERIFIED_REASON,
        })
    except Exception as e:
        logger.error(LOG_PARTICIPANT_PAYMENT_STATUS_FAILED, e, getattr(g, "request_id", None))
        return create_error_response("DATABASE_ERROR")


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
        db = get_db()
        return success_response(fetch_participant_options(db))
    except Exception as e:
        logger.error(LOG_PARTICIPANT_OPTIONS_FAILED, e, getattr(g, "request_id", None))
        return create_error_response("DATABASE_ERROR")


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
        return create_error_response("VAL_MISSING_FIELDS", fields=[REQUEST_KEY_PUBLIC_ID, REQUEST_KEY_EMAIL])
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
                return create_error_response("DATABASE_ERROR")
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
        try:
            send_email_otp(build_email_otp_payload(email=stored_email, otp=otp, public_id=public_id))
        except Exception:
            mark_email_otp_used(db, otp_id=otp_id)
            db.commit()
            return create_error_response("AUTH_EMAIL_OTP_SEND_FAILED")
        db.commit()
        return success_response({
            RESPONSE_KEY_EMAIL: stored_email,
            RESPONSE_KEY_EMAIL_VERIFIED: False,
            RESPONSE_KEY_EXPIRES_AT: expires_at.isoformat(),
        })
    except Exception:
        return create_error_response("DATABASE_ERROR")


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
        return create_error_response("VAL_MISSING_FIELDS", fields=[REQUEST_KEY_PUBLIC_ID, REQUEST_KEY_EMAIL, REQUEST_KEY_OTP])
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
        return create_error_response("DATABASE_ERROR")
