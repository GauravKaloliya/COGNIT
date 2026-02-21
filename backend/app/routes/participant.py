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
    error_response,
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

    db = get_db()
    iph = get_ip_hash()
    ua = request.headers.get("User-Agent", "")[:512]

    try:
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
        return jsonify({"status": "created", "public_id": public_id}), 201
    except Exception as e:
        db.rollback()
        if "unique" in str(e).lower():
            return create_error_response("PARTICIPANT_EXISTS")
        from flask import current_app
        current_app.logger.exception("create_participant failed")
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
    db = get_db()
    exists = db.execute(text("""
        SELECT 1 FROM participants
        WHERE username = :un AND is_deleted = false
        LIMIT 1
    """), {"un": username}).scalar()
    return jsonify({"available": not bool(exists)})


@participant_bp.route("/check-email")
@limiter.limit("30 per minute")
@track_performance
def check_email():
    """Check if email is already registered."""
    email = request.args.get("email", "").strip().lower()
    if not email:
        return create_error_response("MISSING_FIELDS", {"fields": ["email"]})
    db = get_db()
    exists = db.execute(text("""
        SELECT 1 FROM participants
        WHERE email = :em AND is_deleted = false
        LIMIT 1
    """), {"em": email}).scalar()
    return jsonify({"available": not bool(exists)})


@participant_bp.route("/check-phone")
@limiter.limit("30 per minute")
@track_performance
def check_phone():
    """Check if phone number is already registered."""
    phone = request.args.get("phone", "").strip()
    if not phone:
        return create_error_response("MISSING_FIELDS", {"fields": ["phone"]})
    db = get_db()
    exists = db.execute(text("""
        SELECT 1 FROM participants
        WHERE phone = :ph AND is_deleted = false
        LIMIT 1
    """), {"ph": phone}).scalar()
    return jsonify({"available": not bool(exists)})


@participant_bp.route("/consent", methods=["POST"])
@limiter.limit("20 per minute")
@track_performance
def record_consent():
    """Record participant consent agreement."""
    data = request.json or {}
    public_id = data.get("public_id")
    if not public_id:
        return create_error_response("MISSING_FIELDS", {"fields": ["public_id"]})

    db = get_db()
    try:
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
        return jsonify({"status": "consent recorded"})
    except Exception:
        db.rollback()
        from flask import current_app
        current_app.logger.exception("consent failed")
        return create_error_response("INTERNAL_ERROR")