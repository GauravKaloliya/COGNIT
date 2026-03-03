"""
Participant routes module for C.O.G.N.I.T. backend.
Handles participant registration, validation, and consent.
"""

import re

from flask import jsonify, request
from sqlalchemy import text

from app.extensions import limiter
from app.database import get_db
from app.utils.helpers import (
    get_ip_hash,
    log_audit,
    create_error_response,
)
from app.utils.decorators import track_performance


# ────────────────────────────────────────────────
# Blueprint Setup
# ────────────────────────────────────────────────

from flask import Blueprint
participant_bp = Blueprint('participant', __name__)


# ────────────────────────────────────────────────
# Routes
# ────────────────────────────────────────────────

@participant_bp.route("/participants", methods=["POST"])
@limiter.limit("30 per minute")
@track_performance
def create_participant():
    """Create a new participant registration."""
    data = request.json or {}
    required = ["public_id", "session_id", "username", "email", "phone", "gender_code", "age", "location", "language_code", "prior_experience"]
    missing = [f for f in required if f not in data or not data[f]]
    if missing:
        return create_error_response("MISSING_FIELDS", {"fields": missing})

    public_id = str(data["public_id"]).strip()
    if not re.match(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', public_id, re.I):
        return create_error_response("INVALID_UUID", {"field": "public_id"})

    iph = get_ip_hash()
    ua = request.headers.get("User-Agent", "")[:512]

    try:
        db = get_db()
        result = db.execute(text("""
            INSERT INTO participants (
                public_id, session_id, username, email, phone,
                gender_code, age, location, language_code, prior_experience,
                ip_hash, user_agent, extra_metadata
            ) VALUES (
                :pub, :sid, :un, :em, :ph, :gc, :age, :loc, :lc, :pe, :iph, :ua, '{}'
            )
            RETURNING id
        """), {
            "pub": public_id,
            "sid": str(data["session_id"]).strip()[:128],
            "un": str(data["username"]).strip()[:50],
            "em": str(data["email"]).strip().lower()[:255],
            "ph": str(data["phone"]).strip()[:20],
            "gc": str(data["gender_code"]).strip().lower()[:32],
            "age": int(data["age"]),
            "loc": str(data["location"]).strip()[:120],
            "lc": str(data["language_code"]).strip().lower()[:20],
            "pe": str(data.get("prior_experience", "")).strip()[:120],
            "iph": iph,
            "ua": ua
        })
        participant_id = result.scalar()
        if participant_id is None:
            raise RuntimeError("participant insert did not return id")
        
        log_audit(db, "participant_created", participant_id=participant_id, details=f"public_id={public_id}")
        db.commit()
        print(f"[INFO] Participant created: {public_id[:8]}...", flush=True)
        return jsonify({"status": "created", "public_id": public_id}), 201
    except Exception as e:
        try:
            db.rollback()
        except:
            pass
        error_str = str(e).lower()
        
        # Handle unique/duplicate constraint violations
        if "unique" in error_str or "duplicate" in error_str:
            if "username" in error_str:
                return create_error_response("DUP_USERNAME")
            elif "email" in error_str:
                return create_error_response("DUP_EMAIL")
            elif "phone" in error_str:
                return create_error_response("DUP_PHONE")
            elif "public_id" in error_str:
                return create_error_response("DUP_PUBLIC_ID")
            return create_error_response("PARTICIPANT_EXISTS")
        
        # Handle foreign key constraint violations
        if "foreign key" in error_str or "violates foreign key constraint" in error_str:
            if "gender_code" in error_str:
                return create_error_response("VAL_GENDER_REQUIRED")
            elif "language_code" in error_str:
                return create_error_response("VAL_LANGUAGE_REQUIRED")
            print(f"[ERROR] Foreign key violation in create_participant: {e}", flush=True)
            return create_error_response("DATABASE_ERROR")
        
        # Handle check constraint violations
        if "check constraint" in error_str or "violates check constraint" in error_str:
            if "chk_email_format" in error_str or "email" in error_str:
                return create_error_response("VAL_EMAIL_INVALID")
            elif "chk_phone_format" in error_str or "phone" in error_str:
                return create_error_response("VAL_PHONE_INVALID")
            elif "chk_age" in error_str or "age" in error_str:
                return create_error_response("VAL_AGE_INVALID")
            print(f"[ERROR] Check constraint violation in create_participant: {e}", flush=True)
            return create_error_response("DATABASE_ERROR")
        
        print(f"[ERROR] create_participant failed: {e}", flush=True)
        return create_error_response("DATABASE_ERROR")


@participant_bp.route("/check-username")
@limiter.limit("30 per minute")
@track_performance
def check_username():
    """Check if username is available for registration."""
    username = request.args.get("username", "").strip()
    if not username:
        return create_error_response("MISSING_FIELDS", {"fields": ["username"]})
    if len(username) < 2:
        return jsonify({"available": True})
    try:
        db = get_db()
        exists = db.execute(text("""
            SELECT 1 FROM participants
            WHERE username = :un AND is_deleted = false
            LIMIT 1
        """), {"un": username}).scalar()
        return jsonify({"available": not bool(exists)})
    except Exception as e:
        print(f"[ERROR] check_username failed: {e}", flush=True)
        return create_error_response("DATABASE_ERROR")


@participant_bp.route("/check-email")
@limiter.limit("30 per minute")
@track_performance
def check_email():
    """Check if email is already registered."""
    email = request.args.get("email", "").strip().lower()
    if not email:
        return create_error_response("MISSING_FIELDS", {"fields": ["email"]})
    try:
        db = get_db()
        exists = db.execute(text("""
            SELECT 1 FROM participants
            WHERE email = :em AND is_deleted = false
            LIMIT 1
        """), {"em": email}).scalar()
        return jsonify({"available": not bool(exists)})
    except Exception as e:
        print(f"[ERROR] check_email failed: {e}", flush=True)
        return create_error_response("DATABASE_ERROR")


@participant_bp.route("/check-phone")
@limiter.limit("30 per minute")
@track_performance
def check_phone():
    """Check if phone number is already registered."""
    phone = request.args.get("phone", "").strip()
    if not phone:
        return create_error_response("MISSING_FIELDS", {"fields": ["phone"]})
    try:
        db = get_db()
        exists = db.execute(text("""
            SELECT 1 FROM participants
            WHERE phone = :ph AND is_deleted = false
            LIMIT 1
        """), {"ph": phone}).scalar()
        return jsonify({"available": not bool(exists)})
    except Exception as e:
        print(f"[ERROR] check_phone failed: {e}", flush=True)
        return create_error_response("DATABASE_ERROR")


@participant_bp.route("/consent", methods=["POST"])
@limiter.limit("20 per minute")
@track_performance
def record_consent():
    """Record participant consent agreement."""
    data = request.json or {}
    public_id = data.get("public_id")
    if not public_id:
        return create_error_response("MISSING_FIELDS", {"fields": ["public_id"]})

    try:
        db = get_db()
        row = db.execute(text("""
            SELECT id FROM participants
            WHERE public_id = :pub AND is_deleted = false
            FOR UPDATE
        """), {"pub": public_id}).fetchone()
        if not row:
            return create_error_response("PARTICIPANT_NOT_FOUND")
        pid = row[0]

        db.execute(text("""
            UPDATE participants
            SET consent_given = true, consent_at = CURRENT_TIMESTAMP
            WHERE id = :pid
        """), {"pid": pid})
        log_audit(db, "consent_recorded", participant_id=pid)
        db.commit()
        print(f"[INFO] Consent recorded for participant: {public_id[:8]}...", flush=True)
        return jsonify({"status": "consent recorded"})
    except Exception as e:
        try:
            db.rollback()
        except:
            pass
        print(f"[ERROR] consent failed: {e}", flush=True)
        return create_error_response("INTERNAL_ERROR")


@participant_bp.route("/participants/<public_id>/payment-status")
@limiter.limit("30 per minute")
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
        
        # If payment is not verified, return error
        if not is_paid:
            return create_error_response("PAYMENT_NOT_VERIFIED")
        
        # Check for any successful payment record
        payment_row = db.execute(text("""
            SELECT public_id, status, verified_at, detected_app
            FROM payments
            WHERE participant_id = :pid AND status = 'success'
            ORDER BY created_at DESC
            LIMIT 1
        """), {"pid": participant_id}).fetchone()
        
        return jsonify({
            "payment_status": payment_status,
            "is_verified": True,
            "current_stage": current_stage,
            "payment_id": str(payment_row[0]) if payment_row else None,
            "verified_at": payment_row[2].isoformat() if payment_row and payment_row[2] else None,
            "detected_app": payment_row[3] if payment_row else None
        })
    except Exception as e:
        print(f"[ERROR] get_participant_payment_status failed: {e}", flush=True)
        return create_error_response("DATABASE_ERROR")
