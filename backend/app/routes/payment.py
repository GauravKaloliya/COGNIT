"""
Payment routes module for C.O.G.N.I.T. backend.
Handles payment creation, screenshot upload, verification, and status.
"""

import base64
import json
import logging
import uuid
from datetime import datetime, timedelta, timezone
from io import BytesIO

from flask import request, g
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
import qrcode

from app.config import (
    PAYMENT_EXPIRY_SECONDS,
    PAYMENT_CREATE_RATE_LIMIT,
    PAYMENT_VERIFY_UPLOAD_RATE_LIMIT,
    PAYMENT_STATUS_RATE_LIMIT,
)
from app.extensions import limiter
from app.database import get_db
from app.utils.helpers import (
    create_error_response,
    get_ip_hash,
    success_response,
)
from app.utils.runtime_cache import resolve_participant_id
from app.utils.security import (
    generate_payment_signature,
    generate_upi_link,
)
from app.utils.decorators import track_performance
from app.services.payment_verify_service import process_verify_upload, process_internal_verify
from app.services import (
    build_request_hash,
    load_idempotent_response,
    save_idempotent_response,
)
from middleware.payment_flow import require_valid_payment_session


# ────────────────────────────────────────────────
# Blueprint Setup
# ────────────────────────────────────────────────

from flask import Blueprint
payment_bp = Blueprint('payment', __name__)
logger = logging.getLogger(__name__)
_QR_BASE64_CACHE = {}


def _log_payment_audit(
    db,
    event_type: str,
    payment_id=None,
    participant_id=None,
    details: str = "",
    request_data=None,
    response_data=None,
    fraud_signals=None
):
    """Best-effort payment audit log writer; never breaks request flow."""
    try:
        db.execute(text("""
            INSERT INTO payment_audit_log (
                event_type, payment_id, participant_id, ip_hash, user_agent,
                device_fingerprint, request_data, response_data, fraud_signals, details
            ) VALUES (
                :event_type, :payment_id, :participant_id, :ip_hash, :user_agent,
                :device_fingerprint, CAST(:request_data AS jsonb), CAST(:response_data AS jsonb), CAST(:fraud_signals AS jsonb), :details
            )
        """), {
            "event_type": event_type,
            "payment_id": payment_id,
            "participant_id": participant_id,
            "ip_hash": get_ip_hash(),
            "user_agent": request.headers.get("User-Agent", "")[:512],
            "device_fingerprint": getattr(g, "device_fingerprint", None),
            "request_data": json.dumps(request_data or {}),
            "response_data": json.dumps(response_data or {}),
            "fraud_signals": json.dumps(fraud_signals or {}),
            "details": (details or "")[:8000],
        })
    except Exception as exc:
        logger.warning("payment_audit_log insert failed request_id=%s error=%s", getattr(g, "request_id", None), exc)


def _build_qr_base64(upi_link: str) -> str:
    cached = _QR_BASE64_CACHE.get(upi_link)
    if cached:
        return cached
    qr = qrcode.make(upi_link)
    buffer = BytesIO()
    qr.save(buffer, format="PNG")
    encoded = base64.b64encode(buffer.getvalue()).decode()
    _QR_BASE64_CACHE[upi_link] = encoded
    return encoded


# ────────────────────────────────────────────────
# Routes
# ────────────────────────────────────────────────

@payment_bp.route("/payments/create", methods=["POST"])
@limiter.limit(PAYMENT_CREATE_RATE_LIMIT)
@track_performance
def create_payment():
    """Create a new payment session with timer."""
    data = request.json or {}
    logger.info("create_payment request_id=%s", getattr(g, "request_id", None))
    public_id = data.get("public_id")
    amount = data.get("amount")
    idempotency_key = (
        request.headers.get("X-Idempotency-Key")
        or data.get("idempotency_key")
        or ""
    ).strip()[:128]

    if not public_id or not amount:
        return create_error_response("MISSING_FIELDS", {"fields": ["public_id", "amount"]})

    try:
        amount = round(float(amount), 2)
        if amount <= 0:
            raise ValueError
    except:
        return create_error_response("INVALID_AMOUNT")

    try:
        db = get_db()
    except Exception as e:
        logger.error("create_payment db connection failed request_id=%s error=%s", getattr(g, "request_id", None), e)
        return create_error_response("INTERNAL_ERROR", custom_message="Payment creation failed. Please try again.")

    participant_id = resolve_participant_id(db, str(public_id).strip())
    if not participant_id:
        return create_error_response("PARTICIPANT_NOT_FOUND")
    request_hash = ""
    if idempotency_key:
        request_hash = build_request_hash({
            "public_id": str(public_id).strip(),
            "amount": amount,
        })
        _idem, replay = load_idempotent_response(
            db,
            endpoint="/payments/create",
            idempotency_key=idempotency_key,
            participant_public_id=str(public_id).strip(),
            request_hash=request_hash,
        )
        if replay:
            payload, status_code = replay
            return success_response(payload), status_code

    # Mark any existing pending/processing payments as failed
    db.execute(text("""
        UPDATE payments
        SET status = 'failed',
            updated_at = CURRENT_TIMESTAMP
        WHERE participant_id = :pid
          AND status IN ('pending', 'processing')
    """), {"pid": participant_id})

    # Timer starts immediately when payment is created
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=PAYMENT_EXPIRY_SECONDS)
    expires_str = expires_at.isoformat()
    payment_public_id = str(uuid.uuid4())

    signature = generate_payment_signature(public_id, str(amount), expires_str)

    try:
        payment_row = db.execute(text("""
            INSERT INTO payments (
                participant_id, public_id, amount, signature, expires_at, timer_activated_at, detected_app, metadata
            ) VALUES (
                :pid, :pub_id, :amt, :sig, :exp, :timer_time, :detected_app,
                '{}'::jsonb
            )
            RETURNING id, public_id
        """), {
            "pid": participant_id,
            "pub_id": payment_public_id,
            "amt": amount,
            "sig": signature,
            "exp": expires_at,
            "timer_time": datetime.now(timezone.utc),
            "detected_app": "unknown",
        }).fetchone()

        # Generate UPI link and QR code
        upi_link = generate_upi_link(amount)
        
        logger.info(
            "payment created request_id=%s payment_id=%s participant_public_id=%s",
            getattr(g, "request_id", None), payment_row[1], public_id[:8]
        )

        qr_base64 = _build_qr_base64(upi_link)

        _log_payment_audit(
            db,
            "payment_create_success",
            payment_id=payment_row[0],
            participant_id=participant_id,
            details="payment created",
            request_data={"amount": amount, "public_id_prefix": public_id[:8]},
            response_data={"payment_public_id": str(payment_row[1]), "expires_at": expires_str},
        )

        response_payload = {
            "payment_id": str(payment_row[1]),
            "amount": amount,
            "expires_at": expires_str,
            "signature": signature,
            "upi_link": upi_link,
            "qr_base64": qr_base64,
            "timer_activated": True,
            "time_remaining_seconds": PAYMENT_EXPIRY_SECONDS
        }
        if idempotency_key:
            save_idempotent_response(
                db,
                endpoint="/payments/create",
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
        except:
            pass
        # Handle concurrent duplicate create calls (e.g., frontend double-invoke)
        # by returning the existing active payment instead of failing with 500.
        if isinstance(e, IntegrityError) or "idx_payments_one_active_per_participant" in str(e):
            try:
                existing = db.execute(text("""
                    SELECT public_id, amount, expires_at, metadata
                    FROM payments
                    WHERE participant_id = :pid
                      AND status IN ('pending', 'processing')
                    ORDER BY created_at DESC
                    LIMIT 1
                """), {"pid": participant_id}).fetchone()
                if existing:
                    existing_payment_id, existing_amount, existing_expires_at, _existing_metadata = existing
                    upi_link = generate_upi_link(float(existing_amount))
                    qr_base64 = _build_qr_base64(upi_link)
                    remaining_seconds = max(
                        0,
                        int((existing_expires_at - datetime.now(timezone.utc)).total_seconds())
                    ) if existing_expires_at else PAYMENT_EXPIRY_SECONDS

                    _log_payment_audit(
                        db,
                        "payment_create_reused_active",
                        participant_id=participant_id,
                        details="reused existing active payment",
                        request_data={"amount": amount, "public_id_prefix": public_id[:8]},
                        response_data={"payment_public_id": str(existing_payment_id)},
                    )
                    response_payload = {
                        "payment_id": str(existing_payment_id),
                        "amount": float(existing_amount),
                        "expires_at": existing_expires_at.isoformat() if existing_expires_at else None,
                        "signature": signature,
                        "upi_link": upi_link,
                        "qr_base64": qr_base64,
                        "timer_activated": True,
                        "time_remaining_seconds": remaining_seconds
                    }
                    if idempotency_key:
                        save_idempotent_response(
                            db,
                            endpoint="/payments/create",
                            idempotency_key=idempotency_key,
                            participant_public_id=str(public_id).strip(),
                            request_hash=request_hash,
                            response_body=response_payload,
                            status_code=200,
                        )
                    db.commit()
                    return success_response(response_payload)
            except Exception:
                pass
        logger.error("payment creation failed request_id=%s error=%s", getattr(g, "request_id", None), e)
        _log_payment_audit(
            db,
            "payment_create_failed",
            participant_id=participant_id,
            details=f"payment creation failed: {str(e)[:300]}",
            request_data={"amount": amount, "public_id_prefix": public_id[:8]},
        )
        return create_error_response("INTERNAL_ERROR", custom_message="Payment creation failed. Please try again.")


@payment_bp.route("/payments/<payment_public_id>/verify-upload", methods=["POST"])
@require_valid_payment_session
@limiter.limit(PAYMENT_VERIFY_UPLOAD_RATE_LIMIT)
@track_performance
def verify_and_upload_payment(payment_public_id):
    logger.info("verify_upload request_id=%s payment_id=%s", getattr(g, "request_id", None), payment_public_id)
    data = request.json or {}
    try:
        db = get_db()
    except Exception as e:
        logger.error("verify_and_upload_payment db connection failed request_id=%s error=%s", getattr(g, "request_id", None), e)
        return create_error_response("INTERNAL_ERROR", custom_message="Payment verification failed. Please try again.")

    return process_verify_upload(
        db=db,
        payment_public_id=payment_public_id,
        data=data,
        request_id=str(getattr(g, "request_id", None) or ""),
        device_fingerprint=getattr(g, "device_fingerprint", None),
        idempotency_key_header=request.headers.get("X-Idempotency-Key"),
        user_agent=request.headers.get("User-Agent", "")[:512],
        ip_hash=get_ip_hash(),
        payment_audit_logger=_log_payment_audit,
    )


@payment_bp.route("/payments/<payment_public_id>/status", methods=["GET"])
@limiter.limit(PAYMENT_STATUS_RATE_LIMIT)
@track_performance
def get_payment_status(payment_public_id):
    """Get current payment status including expiry check."""
    logger.info("payment_status request_id=%s payment_id=%s", getattr(g, "request_id", None), payment_public_id)
    try:
        db = get_db()

        row = db.execute(text("""
            SELECT p.id, p.participant_id, p.status, p.expires_at, p.amount, p.verified_at, p.verification_details, p.detected_app, p.auto_rejected, p.verification_attempts
            FROM payments p
            WHERE p.public_id = :pid
        """), {"pid": payment_public_id}).fetchone()

        if not row:
            return create_error_response("PAYMENT_NOT_FOUND")

        payment_id, participant_id, status, expires_at, amount, verified_at, verification_details, detected_app, auto_rejected, verification_attempts = row

        # Check if payment should be marked as expired
        now = datetime.now(timezone.utc)
        is_expired = expires_at and now > expires_at

        if is_expired and status in ("pending", "processing"):
            db.execute(text("""
                UPDATE payments
                SET status = 'expired', updated_at = CURRENT_TIMESTAMP
                WHERE id = :pid
            """), {"pid": payment_id})
            db.commit()
            status = "expired"

        response = {
            "payment_id": payment_public_id,
            "status": status,
            "amount": float(amount) if amount else None,
            "expires_at": expires_at.isoformat() if expires_at else None,
            "is_expired": status == "expired",
            "time_remaining_seconds": max(0, int((expires_at - now).total_seconds())) if expires_at and status in ("pending", "processing") else 0,
            "verified_at": verified_at.isoformat() if verified_at else None,
            "verification_attempts": int(verification_attempts or 0)
        }

        if verification_details:
            response["verification_details"] = verification_details
        if detected_app:
            response["detected_app"] = detected_app
        if auto_rejected:
            response["auto_rejected"] = True

        return success_response(response)
    except Exception as e:
        logger.error("get payment status failed request_id=%s payment_id=%s error=%s", getattr(g, "request_id", None), payment_public_id, e)
        return create_error_response("DATABASE_ERROR")


@payment_bp.route("/internal/payments/<payment_public_id>/verify", methods=["POST"])
@limiter.exempt
def verify_payment(payment_public_id):
    """Internal endpoint for payment verification (no rate limit)."""
    logger.info("internal_verify request_id=%s payment_id=%s", getattr(g, "request_id", None), payment_public_id)
    try:
        db = get_db()
    except Exception as e:
        logger.error("internal verify payment db failed request_id=%s payment_id=%s error=%s", getattr(g, "request_id", None), payment_public_id, e)
        return create_error_response("DATABASE_ERROR")

    return process_internal_verify(
        db=db,
        payment_public_id=payment_public_id,
    )
