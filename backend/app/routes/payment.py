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
from concurrent.futures import ThreadPoolExecutor

from flask import request, g
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
import qrcode

from app.config import (
    PAYMENT_EXPIRY_SECONDS,
    PAYMENT_UPLOAD_URL_EXPIRY_SECONDS,
    PAYMENT_MAX_IMAGE_MB,
    PAYMENT_AMOUNT,
    S3_BUCKET_NAME,
    PAYMENT_CREATE_RATE_LIMIT,
    PAYMENT_VERIFY_UPLOAD_RATE_LIMIT,
    PAYMENT_STATUS_RATE_LIMIT,
    PAYMENT_STATUS_RATE_LIMIT_PER_PAYMENT,
    PAYMENT_TOKEN_RATE_LIMIT,
    PAYMENT_TOKEN_RATE_LIMIT_PER_PAYMENT,
    INTERNAL_VERIFY_TOKEN,
    INTERNAL_VERIFY_RATE_LIMIT,
    PARTICIPANT_SESSION_COOKIE_NAME,
    PARTICIPANT_PUBLIC_COOKIE_NAME,
)
from app.extensions import limiter, s3
from app.database import get_db, engine
from app.utils.helpers import (
    create_error_response,
    get_ip_hash,
    success_response,
    validate_image_extension,
)
from app.utils.runtime_cache import resolve_participant_id
from app.utils.security import (
    generate_payment_signature,
    generate_upi_link,
    generate_payment_write_token,
)
from app.utils.decorators import track_performance, require_idempotency_key
from flask_limiter.util import get_remote_address
from app.utils.turnstile import verify_turnstile_token
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
_PAYMENT_AUDIT_EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="payment-audit")


def _payment_rate_key():
    payment_id = (getattr(request, "view_args", {}) or {}).get("payment_public_id") or ""
    return f"{get_remote_address()}:{payment_id}"


def _issue_payment_write_token(
    db,
    *,
    payment_id: int,
    payment_public_id: str,
    participant_id: int,
    expires_at,
    payment_signature: str,
    device_fingerprint: str = "",
    session_id: str = "",
) -> str:
    nonce = uuid.uuid4().hex
    db.execute(text("""
        UPDATE payments
        SET metadata = COALESCE(metadata, '{}'::jsonb) || CAST(:patch AS jsonb),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = :pid
    """), {
        "pid": int(payment_id),
        "patch": json.dumps({
            "payment_write_nonce": nonce,
            "payment_write_nonce_issued_at": datetime.now(timezone.utc).isoformat(),
        }),
    })
    return generate_payment_write_token(
        payment_public_id,
        int(participant_id),
        expires_at,
        payment_signature,
        device_fingerprint=device_fingerprint,
        session_id=session_id,
        nonce=nonce,
    )


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


def _enqueue_payment_audit(
    *,
    event_type: str,
    payment_id=None,
    participant_id=None,
    details: str = "",
    request_data=None,
    response_data=None,
    fraud_signals=None,
    ip_hash: str = "",
    user_agent: str = "",
    device_fingerprint: str = "",
):
    """Best-effort async payment audit writer."""
    def _write():
        try:
            with engine.begin() as conn:
                conn.execute(text("""
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
                    "ip_hash": ip_hash,
                    "user_agent": user_agent[:512],
                    "device_fingerprint": (device_fingerprint or "")[:128],
                    "request_data": json.dumps(request_data or {}),
                    "response_data": json.dumps(response_data or {}),
                    "fraud_signals": json.dumps(fraud_signals or {}),
                    "details": (details or "")[:8000],
                })
        except Exception:
            pass

    try:
        _PAYMENT_AUDIT_EXECUTOR.submit(_write)
    except Exception:
        pass


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
@require_idempotency_key
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
    turnstile_token = (data.get("turnstile_token") or "").strip()

    if not public_id:
        return create_error_response("MISSING_FIELDS", {"fields": ["public_id"]})

    try:
        amount = round(float(amount if amount is not None else PAYMENT_AMOUNT), 2)
    except Exception:
        amount = PAYMENT_AMOUNT

    if round(float(PAYMENT_AMOUNT), 2) != amount:
        return create_error_response("INVALID_AMOUNT")

    try:
        db = get_db()
    except Exception as e:
        logger.error("create_payment db connection failed request_id=%s error=%s", getattr(g, "request_id", None), e)
        return create_error_response("INTERNAL_ERROR", custom_message="Payment creation failed. Please try again.")

    participant_id = resolve_participant_id(db, str(public_id).strip())
    if not participant_id:
        return create_error_response("PARTICIPANT_NOT_FOUND")

    ok, _ts_data = verify_turnstile_token(turnstile_token, request.remote_addr)
    if not ok:
        return create_error_response("BOT_CHALLENGE_FAILED")

    participant_session_id = db.execute(text("""
        SELECT session_id FROM participants WHERE id = :pid
    """), {"pid": participant_id}).scalar()
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

        response_payload = {
            "payment_id": str(payment_row[1]),
            "amount": amount,
            "expires_at": expires_str,
            "signature": signature,
            "payment_token": _issue_payment_write_token(
                db,
                payment_id=int(payment_row[0]),
                payment_public_id=str(payment_row[1]),
                participant_id=int(participant_id),
                expires_at=expires_at,
                payment_signature=signature,
                device_fingerprint=getattr(g, "device_fingerprint", None) or "",
                session_id=participant_session_id or "",
            ),
            "upi_link": upi_link,
            "qr_ready": True,
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
        _enqueue_payment_audit(
            event_type="payment_create_success",
            payment_id=payment_row[0],
            participant_id=participant_id,
            details="payment created",
            request_data={"amount": amount, "public_id_prefix": public_id[:8]},
            response_data={"payment_public_id": str(payment_row[1]), "expires_at": expires_str},
            ip_hash=get_ip_hash(),
            user_agent=request.headers.get("User-Agent", "")[:512],
            device_fingerprint=getattr(g, "device_fingerprint", None) or "",
        )
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
                    SELECT id, public_id, amount, expires_at, signature
                    FROM payments
                    WHERE participant_id = :pid
                      AND status IN ('pending', 'processing')
                    ORDER BY created_at DESC
                    LIMIT 1
                """), {"pid": participant_id}).fetchone()
                if existing:
                    existing_payment_row_id, existing_payment_id, existing_amount, existing_expires_at, existing_signature = existing
                    upi_link = generate_upi_link(float(existing_amount))
                    remaining_seconds = max(
                        0,
                        int((existing_expires_at - datetime.now(timezone.utc)).total_seconds())
                    ) if existing_expires_at else PAYMENT_EXPIRY_SECONDS

                    response_payload = {
                        "payment_id": str(existing_payment_id),
                        "amount": float(existing_amount),
                        "expires_at": existing_expires_at.isoformat() if existing_expires_at else None,
                        "signature": existing_signature or signature,
                        "payment_token": _issue_payment_write_token(
                            db,
                            payment_id=int(existing_payment_row_id),
                            payment_public_id=str(existing_payment_id),
                            participant_id=int(participant_id),
                            expires_at=existing_expires_at or (datetime.now(timezone.utc) + timedelta(seconds=PAYMENT_EXPIRY_SECONDS)),
                            payment_signature=existing_signature or signature,
                            device_fingerprint=getattr(g, "device_fingerprint", None) or "",
                            session_id=participant_session_id or "",
                        ),
                        "upi_link": upi_link,
                        "qr_ready": True,
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
                    _enqueue_payment_audit(
                        event_type="payment_create_reused_active",
                        participant_id=participant_id,
                        details="reused existing active payment",
                        request_data={"amount": amount, "public_id_prefix": public_id[:8]},
                        response_data={"payment_public_id": str(existing_payment_id)},
                        ip_hash=get_ip_hash(),
                        user_agent=request.headers.get("User-Agent", "")[:512],
                        device_fingerprint=getattr(g, "device_fingerprint", None) or "",
                    )
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

@payment_bp.route("/payments/<payment_public_id>/qr", methods=["GET"])
@limiter.limit(PAYMENT_STATUS_RATE_LIMIT)
@track_performance
def get_payment_qr(payment_public_id):
    """Return payment QR code lazily to keep /payments/create lightweight."""
    try:
        db = get_db()
        row = db.execute(text("""
            SELECT amount, status
            FROM payments
            WHERE public_id = :pid
            LIMIT 1
        """), {"pid": payment_public_id}).fetchone()
        if not row:
            return create_error_response("PAYMENT_NOT_FOUND")
        amount, status = row
        if status in ("expired", "failed", "rejected_fraud", "refunded"):
            return create_error_response("PAYMENT_INVALID_STATE")

        upi_link = generate_upi_link(float(amount))
        return success_response({
            "payment_id": payment_public_id,
            "qr_base64": _build_qr_base64(upi_link),
        })
    except Exception as exc:
        logger.error(
            "get_payment_qr failed request_id=%s payment_id=%s error=%s",
            getattr(g, "request_id", None),
            payment_public_id,
            exc,
        )
        return create_error_response("SYS_INTERNAL_ERROR", custom_message="Failed to load payment QR. Please retry.")


@payment_bp.route("/payments/<payment_public_id>/upload-url", methods=["POST"])
@require_valid_payment_session(require_write_token=True)
@limiter.limit(PAYMENT_VERIFY_UPLOAD_RATE_LIMIT)
@track_performance
def get_payment_upload_url(payment_public_id):
    data = request.json or {}
    file_extension = (data.get("file_extension", "jpg") or "jpg").lower().strip(".")
    sha256_hash = (data.get("sha256") or "").strip().lower()
    mime_type = (data.get("mime_type") or "").strip()[:120]
    file_size = data.get("file_size")

    if not sha256_hash:
        return create_error_response("PAY_INVALID_SHA256")

    if len(sha256_hash) != 64 or any(ch not in "0123456789abcdef" for ch in sha256_hash):
        return create_error_response("PAY_INVALID_SHA256")

    valid_ext, ext, content_type = validate_image_extension(f"file.{file_extension}")
    if not valid_ext:
        return create_error_response("PAY_INVALID_IMAGE_TYPE")

    if file_size is not None:
        try:
            normalized_size = int(file_size)
            max_bytes = max(1, int(PAYMENT_MAX_IMAGE_MB)) * 1024 * 1024
            if normalized_size < 0 or normalized_size > max_bytes:
                return create_error_response(
                    "VAL_FILE_TOO_LARGE",
                    details={"max_mb": int(PAYMENT_MAX_IMAGE_MB), "reason": "payment_image_too_large"},
                    custom_message=f"The file is too large. Please upload an image smaller than {int(PAYMENT_MAX_IMAGE_MB)}MB.",
                )
        except Exception:
            return create_error_response("VAL_INVALID_FORMAT", details={"field": "file_size"})

    object_key = f"payments/staging/{payment_public_id}/{uuid.uuid4().hex}.{ext}"
    try:
        presigned_url = s3.generate_presigned_url(
            ClientMethod="put_object",
            Params={
                "Bucket": S3_BUCKET_NAME,
                "Key": object_key,
                "ContentType": mime_type or content_type,
            },
            ExpiresIn=max(60, int(PAYMENT_UPLOAD_URL_EXPIRY_SECONDS)),
            HttpMethod="PUT",
        )
    except Exception as exc:
        logger.error(
            "get_payment_upload_url failed request_id=%s payment_id=%s error=%s",
            getattr(g, "request_id", None),
            payment_public_id,
            exc,
        )
        return create_error_response("SYS_INTERNAL_ERROR", custom_message="Failed to prepare upload URL. Please try again.")

    return success_response({
        "upload_url": presigned_url,
        "upload_object_key": object_key,
        "upload_content_type": mime_type or content_type,
        "expires_in_seconds": max(60, int(PAYMENT_UPLOAD_URL_EXPIRY_SECONDS)),
    })


@payment_bp.route("/payments/<payment_public_id>/verify-upload", methods=["POST"])
@require_valid_payment_session(require_write_token=True)
@limiter.limit(PAYMENT_VERIFY_UPLOAD_RATE_LIMIT)
@track_performance
@require_idempotency_key
def verify_and_upload_payment(payment_public_id):
    logger.info("verify_upload request_id=%s payment_id=%s", getattr(g, "request_id", None), payment_public_id)
    data = request.json or {}
    turnstile_token = (data.get("turnstile_token") or "").strip()
    try:
        db = get_db()
    except Exception as e:
        logger.error("verify_and_upload_payment db connection failed request_id=%s error=%s", getattr(g, "request_id", None), e)
        return create_error_response("INTERNAL_ERROR", custom_message="Payment verification failed. Please try again.")

    ok, _ts_data = verify_turnstile_token(turnstile_token, request.remote_addr)
    if not ok:
        return create_error_response("BOT_CHALLENGE_FAILED")

    return process_verify_upload(
        db=db,
        payment_public_id=payment_public_id,
        data=data,
        request_id=str(getattr(g, "request_id", None) or ""),
        device_fingerprint=getattr(g, "device_fingerprint", None),
        device_fingerprint_variants=getattr(g, "device_fingerprint_variants", None),
        idempotency_key_header=request.headers.get("X-Idempotency-Key"),
        user_agent=request.headers.get("User-Agent", "")[:512],
        ip_hash=get_ip_hash(),
        payment_audit_logger=_log_payment_audit,
    )


@payment_bp.route("/payments/<payment_public_id>/status", methods=["GET"])
@require_valid_payment_session(
    require_write_token=True,
    allowed_states=["pending", "processing", "success", "expired", "rejected_fraud", "failed"],
    skip_expiry_check=True,
)
@limiter.limit(PAYMENT_STATUS_RATE_LIMIT)
@limiter.limit(PAYMENT_STATUS_RATE_LIMIT_PER_PAYMENT, key_func=_payment_rate_key)
@track_performance
def get_payment_status(payment_public_id):
    """Get current payment status including expiry check."""
    logger.info("payment_status request_id=%s payment_id=%s", getattr(g, "request_id", None), payment_public_id)
    try:
        db = get_db()

        row = db.execute(text("""
            SELECT p.id, p.participant_id, p.status, p.expires_at, p.amount, p.verified_at, p.verification_details, p.detected_app, p.auto_rejected, p.verification_attempts, p.signature, pr.session_id
            FROM payments p
            JOIN participants pr ON pr.id = p.participant_id
            WHERE p.public_id = :pid
        """), {"pid": payment_public_id}).fetchone()

        if not row:
            return create_error_response("PAYMENT_NOT_FOUND")

        payment_id, participant_id, status, expires_at, amount, verified_at, verification_details, detected_app, auto_rejected, verification_attempts, signature, participant_session_id = row

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


@payment_bp.route("/payments/<payment_public_id>/token", methods=["POST"])
@limiter.limit(PAYMENT_TOKEN_RATE_LIMIT)
@limiter.limit(PAYMENT_TOKEN_RATE_LIMIT_PER_PAYMENT, key_func=_payment_rate_key)
@track_performance
def mint_payment_token(payment_public_id):
    """Mint a new payment write token for an active session."""
    data = request.json or {}
    public_id = (data.get("public_id") or "").strip()
    session_id = (data.get("session_id") or "").strip()
    if not session_id:
        session_id = (request.cookies.get(PARTICIPANT_SESSION_COOKIE_NAME) or "").strip()
    if not public_id:
        public_id = (request.cookies.get(PARTICIPANT_PUBLIC_COOKIE_NAME) or "").strip()
    missing = []
    if not public_id:
        missing.append("public_id")
    if not session_id:
        missing.append("session_id")
    if missing:
        return create_error_response("MISSING_FIELDS", {"fields": missing})
    try:
        db = get_db()
        row = db.execute(text("""
            SELECT p.id, p.participant_id, p.status, p.expires_at, p.signature, pr.session_id
            FROM payments p
            JOIN participants pr ON pr.id = p.participant_id
            WHERE p.public_id = :pid
              AND pr.public_id = :pub
              AND pr.session_id = :sid
            LIMIT 1
        """), {"pid": payment_public_id, "pub": public_id, "sid": session_id}).fetchone()
        if not row:
            return create_error_response("AUTH_ACCESS_DENIED")

        payment_id, participant_id, status, expires_at, signature, participant_session_id = row
        now = datetime.now(timezone.utc)
        if expires_at and now > expires_at:
            return create_error_response("PAYMENT_EXPIRED")
        if status not in ("pending", "processing"):
            return create_error_response("PAYMENT_INVALID_STATE")

        token = _issue_payment_write_token(
            db,
            payment_id=int(payment_id),
            payment_public_id=str(payment_public_id),
            participant_id=int(participant_id),
            expires_at=expires_at,
            payment_signature=signature,
            device_fingerprint=getattr(g, "device_fingerprint", None) or "",
            session_id=participant_session_id or "",
        )
        db.commit()
        return success_response({
            "payment_id": payment_public_id,
            "payment_token": token,
            "expires_at": expires_at.isoformat() if expires_at else None,
        })
    except Exception as e:
        logger.error("mint payment token failed request_id=%s payment_id=%s error=%s", getattr(g, "request_id", None), payment_public_id, e)
        return create_error_response("DATABASE_ERROR")


@payment_bp.route("/internal/payments/<payment_public_id>/verify", methods=["POST"])
@limiter.limit(INTERNAL_VERIFY_RATE_LIMIT)
def verify_payment(payment_public_id):
    """Internal endpoint for payment verification (auth + rate limited)."""
    logger.info("internal_verify request_id=%s payment_id=%s", getattr(g, "request_id", None), payment_public_id)
    internal_token = (request.headers.get("X-Internal-Token") or "").strip()
    if not INTERNAL_VERIFY_TOKEN or internal_token != INTERNAL_VERIFY_TOKEN:
        return create_error_response("AUTH_ACCESS_DENIED")
    try:
        db = get_db()
    except Exception as e:
        logger.error("internal verify payment db failed request_id=%s payment_id=%s error=%s", getattr(g, "request_id", None), payment_public_id, e)
        return create_error_response("DATABASE_ERROR")

    return process_internal_verify(
        db=db,
        payment_public_id=payment_public_id,
    )
