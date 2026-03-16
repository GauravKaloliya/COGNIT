"""Participant routes module for C.O.G.N.I.T. backend."""

import logging
from flask import request, g
from sqlalchemy.exc import IntegrityError

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
)
from app.utils.error_mapping import map_participant_create_exception
from app.config import (
    PARTICIPANT_CREATE_RATE_LIMIT,
    PARTICIPANT_CHECK_RATE_LIMIT,
    CONSENT_RATE_LIMIT,
    PARTICIPANT_PAYMENT_STATUS_RATE_LIMIT,
    PARTICIPANT_SESSION_COOKIE_NAME,
    PARTICIPANT_PUBLIC_COOKIE_NAME,
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

@participant_bp.route("/participants", methods=["POST"])
@limiter.limit(PARTICIPANT_CREATE_RATE_LIMIT)
@track_performance
@require_idempotency_key
def create_participant():
    """Create a new participant registration."""
    data = request.json or {}
    turnstile_token = (data.get("turnstile_token") or "").strip()
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

        username = str(data["username"]).strip()[:50]
        email = str(data["email"]).strip().lower()[:255]
        phone = str(data["phone"]).strip()[:20]

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
        
        log_audit(db, "participant_created", participant_id=participant_id, details=f"public_id={public_id}")
        db.commit()
        logger.info("participant created public_id_prefix=%s request_id=%s", public_id[:8], getattr(g, "request_id", None))
        response = success_response({"status": "created", "public_id": public_id, "session_id": session_id})
        response = set_participant_cookies(response, public_id, session_id)
        return response, 201
    except IntegrityError as e:
        try:
            db.rollback()
        except Exception:
            pass
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
            pass
        logger.error("create_participant failed error=%s request_id=%s", e, getattr(g, "request_id", None))
        return map_participant_create_exception(
            error=e,
            public_id=public_id,
            get_existing_session_id=lambda value: get_existing_session_id_for_public_id(db, value),
            set_cookies=set_participant_cookies,
        )


@participant_bp.route("/check-username")
@limiter.limit(PARTICIPANT_CHECK_RATE_LIMIT)
@track_performance
def check_username():
    """Check if username is available for registration."""
    username = request.args.get("username", "").strip()
    if not username:
        return create_error_response("MISSING_FIELDS", {"fields": ["username"]})
    if len(username) < 2:
        return success_response({"available": True})
    try:
        db = get_db()
        return success_response({"available": is_participant_field_available(db, field_name="username", value=username)})
    except Exception as e:
        logger.error("check_username failed error=%s request_id=%s", e, getattr(g, "request_id", None))
        return create_error_response("DATABASE_ERROR")


@participant_bp.route("/check-email")
@limiter.limit(PARTICIPANT_CHECK_RATE_LIMIT)
@track_performance
def check_email():
    """Check if email is already registered."""
    email = request.args.get("email", "").strip().lower()
    if not email:
        return create_error_response("MISSING_FIELDS", {"fields": ["email"]})
    try:
        db = get_db()
        return success_response({"available": is_participant_field_available(db, field_name="email", value=email)})
    except Exception as e:
        logger.error("check_email failed error=%s request_id=%s", e, getattr(g, "request_id", None))
        return create_error_response("DATABASE_ERROR")


@participant_bp.route("/check-phone")
@limiter.limit(PARTICIPANT_CHECK_RATE_LIMIT)
@track_performance
def check_phone():
    """Check if phone number is already registered."""
    phone = request.args.get("phone", "").strip()
    if not phone:
        return create_error_response("MISSING_FIELDS", {"fields": ["phone"]})
    try:
        db = get_db()
        return success_response({"available": is_participant_field_available(db, field_name="phone", value=phone)})
    except Exception as e:
        logger.error("check_phone failed error=%s request_id=%s", e, getattr(g, "request_id", None))
        return create_error_response("DATABASE_ERROR")


@participant_bp.route("/consent", methods=["POST"])
@limiter.limit(CONSENT_RATE_LIMIT)
@track_performance
def record_consent():
    """Record participant consent agreement."""
    data = request.json or {}
    public_id = data.get("public_id")
    idempotency_key = (
        request.headers.get("X-Idempotency-Key")
        or data.get("idempotency_key")
        or ""
    ).strip()[:128]
    if not public_id:
        return create_error_response("MISSING_FIELDS", {"fields": ["public_id"]})

    try:
        db = get_db()
        request_hash = ""
        if idempotency_key:
            request_hash = build_request_hash({
                "public_id": str(public_id).strip(),
            })
            _idem, replay = load_idempotent_response(
                db,
                endpoint="/consent",
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
        response_payload = {"status": "consent recorded"}
        if idempotency_key:
            save_idempotent_response(
                db,
                endpoint="/consent",
                idempotency_key=idempotency_key,
                participant_public_id=str(public_id).strip(),
                request_hash=request_hash,
                response_body=response_payload,
                status_code=200,
            )
        db.commit()
        logger.info("consent recorded public_id_prefix=%s request_id=%s", public_id[:8], getattr(g, "request_id", None))
        return success_response(response_payload)
    except Exception as e:
        try:
            db.rollback()
        except:
            pass
        logger.error("consent failed error=%s request_id=%s", e, getattr(g, "request_id", None))
        return create_error_response("INTERNAL_ERROR")


@participant_bp.route("/participants/<public_id>/payment-status")
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
        is_paid = payment_status == 'paid'

        # Check for any successful payment record
        payment_row = db.execute(text("""
            SELECT public_id, status, verified_at, detected_app
            FROM payments
            WHERE participant_id = :pid AND status = 'success'
            ORDER BY created_at DESC
            LIMIT 1
        """), {"pid": participant_id}).fetchone()

        return success_response({
            "payment_status": payment_status,
            "is_verified": bool(is_paid and payment_row),
            "current_stage": current_stage,
            "payment_id": str(payment_row[0]) if payment_row else None,
            "verified_at": payment_row[2].isoformat() if payment_row and payment_row[2] else None,
            "detected_app": payment_row[3] if payment_row else None,
            "reason": None if is_paid else "payment_not_verified",
        })
    except Exception as e:
        logger.error("get_participant_payment_status failed error=%s request_id=%s", e, getattr(g, "request_id", None))
        return create_error_response("DATABASE_ERROR")


@participant_bp.route("/participants/session", methods=["GET"])
@limiter.limit(PARTICIPANT_CHECK_RATE_LIMIT)
@track_performance
def get_participant_session():
    """Return participant identifiers from httpOnly cookies (if present)."""
    public_id = (request.cookies.get(PARTICIPANT_PUBLIC_COOKIE_NAME) or "").strip()
    session_id = (request.cookies.get(PARTICIPANT_SESSION_COOKIE_NAME) or "").strip()
    return success_response({
        "public_id": public_id or None,
        "session_id": session_id or None,
    })


@participant_bp.route("/participant-options", methods=["GET"])
@limiter.limit(PARTICIPANT_CHECK_RATE_LIMIT)
@track_performance
def get_participant_options():
    """Return participant form options sourced from the database."""
    try:
        db = get_db()
        return success_response(fetch_participant_options(db))
    except Exception as e:
        logger.error("get_participant_options failed error=%s request_id=%s", e, getattr(g, "request_id", None))
        return create_error_response("DATABASE_ERROR")
