"""
Payment routes module for C.O.G.N.I.T. backend.
Handles payment creation, screenshot upload, verification, and status.
"""

import logging
from datetime import datetime, timezone

from flask import request, g
from sqlalchemy import text
from flask_limiter.util import get_remote_address

from app.config import (
    PAYMENT_EXPIRY_SECONDS,
    PAYMENT_UPLOAD_URL_EXPIRY_SECONDS,
    PAYMENT_MAX_IMAGE_MB,
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
from app.constants.event_constants import (
    AUDIT_EVENT_PAYMENT_CREATE_FAILED,
    AUDIT_EVENT_PAYMENT_CREATE_REUSED_ACTIVE,
    AUDIT_EVENT_PAYMENT_CREATE_SUCCESS,
    HTTP_METHOD_GET,
    HTTP_METHOD_POST,
)
from app.constants.error_codes import DETAIL_REASONS, ERROR_MESSAGE_TEMPLATES
from app.constants.audit_details import (
    AUDIT_DETAIL_PAYMENT_CREATED,
    AUDIT_DETAIL_PAYMENT_CREATE_FAILED,
    AUDIT_DETAIL_PAYMENT_REUSED,
)
from app.constants.log_messages import (
    LOG_INTERNAL_VERIFY_DB_FAILED,
    LOG_PAYMENT_CREATE_DB_FAILED,
    LOG_PAYMENT_CREATE_FAILED,
    LOG_PAYMENT_QR_FAILED,
    LOG_PAYMENT_STATUS_FAILED,
    LOG_PAYMENT_TOKEN_FAILED,
    LOG_PAYMENT_UPLOAD_URL_FAILED,
    LOG_PAYMENT_VERIFY_DB_FAILED,
)
from app.constants.request_keys import (
    REQUEST_KEY_AMOUNT,
    REQUEST_KEY_FILE_EXTENSION,
    REQUEST_KEY_FILE_SIZE,
    REQUEST_KEY_IDEMPOTENCY_KEY,
    REQUEST_KEY_MIME_TYPE,
    REQUEST_KEY_PUBLIC_ID,
    REQUEST_KEY_SHA256,
    REQUEST_KEY_TURNSTILE_TOKEN,
    REQUEST_KEY_UPLOAD_OBJECT_KEY,
)
from app.constants.response_keys import (
    RESPONSE_KEY_EXPIRES_AT,
    RESPONSE_KEY_PAYMENT_ID,
    RESPONSE_KEY_PAYMENT_TOKEN,
    RESPONSE_KEY_QR_BASE64,
)
from app.constants.payment_constants import (
    PAYMENT_ACTIVE_STATUSES,
    PAYMENT_QR_BLOCKED_STATUSES,
    PAYMENT_STATUS_FAILED,
    PAYMENT_STATUS_READ_ALLOWED,
)
from app.constants.route_constants import (
    INTERNAL_PAYMENT_VERIFY_ROUTE,
    PAYMENTS_CREATE_ROUTE,
    PAYMENT_QR_ROUTE,
    PAYMENT_STATUS_ROUTE,
    PAYMENT_TOKEN_ROUTE,
    PAYMENT_UPLOAD_URL_ROUTE,
    PAYMENT_VERIFY_UPLOAD_ENDPOINT_TEMPLATE,
    PAYMENT_VERIFY_UPLOAD_ROUTE,
)
from app.extensions import limiter, s3
from app.database import get_db
from app.utils.helpers import (
    create_error_response,
    get_ip_hash,
    success_response,
    validate_image_extension,
)
from app.utils.runtime_cache import resolve_participant_id
from app.utils.security import generate_upi_link
from app.utils.decorators import track_performance, require_idempotency_key
from app.utils.turnstile import verify_turnstile_token
from app.utils.observability import log_event
from app.constants.observability_constants import OBS_EVENT_PAYMENT_REUSE_PROBE_FAILED
from app.services.payment_verify_service import process_verify_upload, process_internal_verify
from app.services import (
    build_payment_response_payload,
    build_payment_status_response,
    build_qr_base64,
    build_reused_payment_response_payload,
    build_request_hash,
    create_payment_record,
    enqueue_payment_audit,
    expire_payment_if_needed,
    fetch_active_payment_for_reuse,
    fetch_payment_status_row,
    fetch_token_mint_row,
    get_participant_session_id,
    is_duplicate_active_payment_error,
    is_expected_payment_amount,
    log_payment_audit,
    load_idempotent_response,
    mark_existing_active_payments_failed,
    normalize_payment_amount,
    save_idempotent_response,
    issue_payment_write_token,
)
from middleware.payment_flow import require_valid_payment_session


# ────────────────────────────────────────────────
# Blueprint Setup
# ────────────────────────────────────────────────

from flask import Blueprint
payment_bp = Blueprint('payment', __name__)
logger = logging.getLogger(__name__)


def _payment_rate_key():
    payment_id = (getattr(request, "view_args", {}) or {}).get("payment_public_id") or ""
    return f"{get_remote_address()}:{payment_id}"

# ────────────────────────────────────────────────
# Routes
# ────────────────────────────────────────────────

@payment_bp.route(PAYMENTS_CREATE_ROUTE, methods=[HTTP_METHOD_POST])
@limiter.limit(PAYMENT_CREATE_RATE_LIMIT)
@track_performance
@require_idempotency_key
def create_payment():
    """Create a new payment session with timer."""
    data = request.json or {}
    public_id = data.get(REQUEST_KEY_PUBLIC_ID)
    amount = data.get(REQUEST_KEY_AMOUNT)
    idempotency_key = (
        request.headers.get("X-Idempotency-Key")
        or data.get(REQUEST_KEY_IDEMPOTENCY_KEY)
        or ""
    ).strip()[:128]
    turnstile_token = (data.get(REQUEST_KEY_TURNSTILE_TOKEN) or "").strip()

    if not public_id:
        return create_error_response("MISSING_FIELDS", {"fields": ["public_id"]})

    amount = normalize_payment_amount(amount)
    if not is_expected_payment_amount(amount):
        return create_error_response("INVALID_AMOUNT")

    try:
        db = get_db()
    except Exception as e:
        logger.error(LOG_PAYMENT_CREATE_DB_FAILED, getattr(g, "request_id", None), e)
        return create_error_response("INTERNAL_ERROR", custom_message=ERROR_MESSAGE_TEMPLATES["PAYMENT_CREATE_FAILED"])

    participant_id = resolve_participant_id(db, str(public_id).strip())
    if not participant_id:
        return create_error_response("PARTICIPANT_NOT_FOUND")

    ok, _ts_data = verify_turnstile_token(turnstile_token, request.remote_addr, request.host)
    if not ok:
        return create_error_response("BOT_CHALLENGE_FAILED")

    participant_session_id = get_participant_session_id(db, participant_id)
    request_hash = ""
    if idempotency_key:
        request_hash = build_request_hash({
            REQUEST_KEY_PUBLIC_ID: str(public_id).strip(),
            REQUEST_KEY_AMOUNT: amount,
        })
        _idem, replay = load_idempotent_response(
            db,
            endpoint=PAYMENTS_CREATE_ROUTE,
            idempotency_key=idempotency_key,
            participant_public_id=str(public_id).strip(),
            request_hash=request_hash,
        )
        if replay:
            payload, status_code = replay
            return success_response(payload), status_code

    mark_existing_active_payments_failed(db, participant_id)

    try:
        payment_row, signature, expires_at, expires_str = create_payment_record(
            db,
            participant_id=participant_id,
            public_id=public_id,
            amount=amount,
        )
        
        response_payload = build_payment_response_payload(
            db,
            payment_row_id=int(payment_row[0]),
            payment_public_id=str(payment_row[1]),
            participant_id=int(participant_id),
            public_id=str(public_id),
            amount=amount,
            expires_at=expires_at,
            expires_str=expires_str,
            signature=signature,
            device_fingerprint=getattr(g, "device_fingerprint", None) or "",
            session_id=participant_session_id or "",
            time_remaining_seconds=PAYMENT_EXPIRY_SECONDS,
        )
        if idempotency_key:
            save_idempotent_response(
                db,
                endpoint=PAYMENTS_CREATE_ROUTE,
                idempotency_key=idempotency_key,
                participant_public_id=str(public_id).strip(),
                request_hash=request_hash,
                response_body=response_payload,
                status_code=200,
            )
        db.commit()
        enqueue_payment_audit(
            event_type=AUDIT_EVENT_PAYMENT_CREATE_SUCCESS,
            payment_id=payment_row[0],
            participant_id=participant_id,
            details=AUDIT_DETAIL_PAYMENT_CREATED,
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
        if is_duplicate_active_payment_error(e):
            try:
                existing = fetch_active_payment_for_reuse(db, participant_id)
                if existing:
                    response_payload = build_reused_payment_response_payload(
                        db,
                        existing_payment_row=existing,
                        participant_id=int(participant_id),
                        participant_session_id=participant_session_id or "",
                        device_fingerprint=getattr(g, "device_fingerprint", None) or "",
                    )
                    if idempotency_key:
                        save_idempotent_response(
                            db,
                            endpoint=PAYMENTS_CREATE_ROUTE,
                            idempotency_key=idempotency_key,
                            participant_public_id=str(public_id).strip(),
                            request_hash=request_hash,
                            response_body=response_payload,
                            status_code=200,
                        )
                    db.commit()
                    enqueue_payment_audit(
                        event_type=AUDIT_EVENT_PAYMENT_CREATE_REUSED_ACTIVE,
                        participant_id=participant_id,
                        details=AUDIT_DETAIL_PAYMENT_REUSED,
                        request_data={"amount": amount, "public_id_prefix": public_id[:8]},
                        response_data={"payment_public_id": str(existing[1])},
                        ip_hash=get_ip_hash(),
                        user_agent=request.headers.get("User-Agent", "")[:512],
                        device_fingerprint=getattr(g, "device_fingerprint", None) or "",
                    )
                    return success_response(response_payload)
            except Exception as exc:
                log_event(
                    logger,
                    OBS_EVENT_PAYMENT_REUSE_PROBE_FAILED,
                    level=logging.WARNING,
                    error=str(exc),
                    request_id=getattr(g, "request_id", None),
                )
        logger.error(LOG_PAYMENT_CREATE_FAILED, getattr(g, "request_id", None), e)
        log_payment_audit(
            db,
            request=request,
            device_fingerprint=getattr(g, "device_fingerprint", None),
            event_type=AUDIT_EVENT_PAYMENT_CREATE_FAILED,
            participant_id=participant_id,
            details=AUDIT_DETAIL_PAYMENT_CREATE_FAILED.format(error=str(e)[:300]),
            request_data={"amount": amount, "public_id_prefix": public_id[:8]},
        )
        return create_error_response("INTERNAL_ERROR", custom_message=ERROR_MESSAGE_TEMPLATES["PAYMENT_CREATE_FAILED"])

@payment_bp.route(PAYMENT_QR_ROUTE, methods=[HTTP_METHOD_GET])
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
        actual_amount = round(float(amount), 2) if amount is not None else None
        if actual_amount is None or not is_expected_payment_amount(actual_amount):
            return create_error_response("INVALID_AMOUNT")
        if status in PAYMENT_QR_BLOCKED_STATUSES:
            return create_error_response("PAYMENT_INVALID_STATE")

        upi_link = generate_upi_link(float(amount))
        return success_response({
            RESPONSE_KEY_PAYMENT_ID: payment_public_id,
            RESPONSE_KEY_QR_BASE64: build_qr_base64(upi_link),
        })
    except Exception as exc:
        logger.error(LOG_PAYMENT_QR_FAILED, getattr(g, "request_id", None), payment_public_id, exc)
        return create_error_response("SYS_INTERNAL_ERROR", custom_message=ERROR_MESSAGE_TEMPLATES["PAYMENT_QR_FAILED"])


@payment_bp.route(PAYMENT_UPLOAD_URL_ROUTE, methods=[HTTP_METHOD_POST])
@require_valid_payment_session(require_write_token=True)
@limiter.limit(PAYMENT_VERIFY_UPLOAD_RATE_LIMIT)
@track_performance
def get_payment_upload_url(payment_public_id):
    data = request.json or {}
    file_extension = (data.get(REQUEST_KEY_FILE_EXTENSION, "jpg") or "jpg").lower().strip(".")
    sha256_hash = (data.get(REQUEST_KEY_SHA256) or "").strip().lower()
    mime_type = (data.get(REQUEST_KEY_MIME_TYPE) or "").strip()[:120]
    file_size = data.get(REQUEST_KEY_FILE_SIZE)

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
                    details={"max_mb": int(PAYMENT_MAX_IMAGE_MB), "reason": DETAIL_REASONS["PAYMENT_IMAGE_TOO_LARGE"]},
                    custom_message=ERROR_MESSAGE_TEMPLATES["PAYMENT_IMAGE_TOO_LARGE"].format(max_mb=int(PAYMENT_MAX_IMAGE_MB)),
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
        logger.error(LOG_PAYMENT_UPLOAD_URL_FAILED, getattr(g, "request_id", None), payment_public_id, exc)
        return create_error_response("SYS_INTERNAL_ERROR", custom_message=ERROR_MESSAGE_TEMPLATES["PAYMENT_UPLOAD_URL_FAILED"])

    return success_response({
        "upload_url": presigned_url,
        "upload_object_key": object_key,
        "upload_content_type": mime_type or content_type,
        "expires_in_seconds": max(60, int(PAYMENT_UPLOAD_URL_EXPIRY_SECONDS)),
    })


@payment_bp.route(PAYMENT_VERIFY_UPLOAD_ROUTE, methods=[HTTP_METHOD_POST])
@require_valid_payment_session(require_write_token=True)
@limiter.limit(PAYMENT_VERIFY_UPLOAD_RATE_LIMIT)
@track_performance
@require_idempotency_key
def verify_and_upload_payment(payment_public_id):
    data = request.json or {}
    turnstile_token = (data.get(REQUEST_KEY_TURNSTILE_TOKEN) or "").strip()
    try:
        db = get_db()
    except Exception as e:
        logger.error(LOG_PAYMENT_VERIFY_DB_FAILED, getattr(g, "request_id", None), e)
        return create_error_response("INTERNAL_ERROR", custom_message=ERROR_MESSAGE_TEMPLATES["PAYMENT_VERIFY_FAILED"])

    ok, _ts_data = verify_turnstile_token(turnstile_token, request.remote_addr, request.host)
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
        payment_audit_logger=lambda db_handle, event_type, **kwargs: log_payment_audit(
            db_handle,
            request=request,
            device_fingerprint=getattr(g, "device_fingerprint", None),
            event_type=event_type,
            **kwargs,
        ),
    )


@payment_bp.route(PAYMENT_STATUS_ROUTE, methods=[HTTP_METHOD_GET])
@require_valid_payment_session(
    require_write_token=True,
    allowed_states=PAYMENT_STATUS_READ_ALLOWED,
    skip_expiry_check=True,
)
@limiter.limit(PAYMENT_STATUS_RATE_LIMIT)
@limiter.limit(PAYMENT_STATUS_RATE_LIMIT_PER_PAYMENT, key_func=_payment_rate_key)
@track_performance
def get_payment_status(payment_public_id):
    """Get current payment status including expiry check."""
    try:
        db = get_db()
        row = fetch_payment_status_row(db, payment_public_id)

        if not row:
            return create_error_response("PAYMENT_NOT_FOUND")

        payment_id, participant_id, status, expires_at, amount, verified_at, verification_details, detected_app, auto_rejected, verification_attempts, signature, participant_session_id = row

        actual_amount = round(float(amount), 2) if amount is not None else None
        if actual_amount is None or not is_expected_payment_amount(actual_amount):
            if status in PAYMENT_ACTIVE_STATUSES:
                db.execute(text("""
                    UPDATE payments
                    SET status = :failed_status, updated_at = CURRENT_TIMESTAMP
                    WHERE id = :pid
                """), {"pid": payment_id, "failed_status": PAYMENT_STATUS_FAILED})
                db.commit()
            return create_error_response("INVALID_AMOUNT")

        status, now = expire_payment_if_needed(
            db,
            payment_id=int(payment_id),
            status=status,
            expires_at=expires_at,
        )
        return success_response(build_payment_status_response(
            payment_public_id=payment_public_id,
            status=status,
            amount=amount,
            expires_at=expires_at,
            now=now,
            verified_at=verified_at,
            verification_details=verification_details,
            detected_app=detected_app,
            auto_rejected=auto_rejected,
            verification_attempts=verification_attempts,
        ))
    except Exception as e:
        logger.error(LOG_PAYMENT_STATUS_FAILED, getattr(g, "request_id", None), payment_public_id, e)
        return create_error_response("DATABASE_ERROR")


@payment_bp.route(PAYMENT_TOKEN_ROUTE, methods=[HTTP_METHOD_POST])
@limiter.limit(PAYMENT_TOKEN_RATE_LIMIT)
@limiter.limit(PAYMENT_TOKEN_RATE_LIMIT_PER_PAYMENT, key_func=_payment_rate_key)
@track_performance
def mint_payment_token(payment_public_id):
    """Mint a new payment write token for an active session."""
    logger.info("payment_token_request request_id=%s method=%s payment_id=%s", getattr(g, "request_id", None), request.method, payment_public_id)
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
        row = fetch_token_mint_row(
            db,
            payment_public_id=payment_public_id,
            public_id=public_id,
            session_id=session_id,
        )
        if not row:
            return create_error_response("AUTH_ACCESS_DENIED")

        payment_id, participant_id, status, expires_at, signature, participant_session_id = row
        now = datetime.now(timezone.utc)
        if expires_at and now > expires_at:
            return create_error_response("PAYMENT_EXPIRED")
        if status not in PAYMENT_ACTIVE_STATUSES:
            return create_error_response("PAYMENT_INVALID_STATE")

        token = issue_payment_write_token(
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
            RESPONSE_KEY_PAYMENT_ID: payment_public_id,
            RESPONSE_KEY_PAYMENT_TOKEN: token,
            RESPONSE_KEY_EXPIRES_AT: expires_at.isoformat() if expires_at else None,
        })
    except Exception as e:
        logger.error(LOG_PAYMENT_TOKEN_FAILED, getattr(g, "request_id", None), payment_public_id, e)
        return create_error_response("DATABASE_ERROR")


@payment_bp.route(INTERNAL_PAYMENT_VERIFY_ROUTE, methods=[HTTP_METHOD_POST])
@limiter.limit(INTERNAL_VERIFY_RATE_LIMIT)
def verify_payment(payment_public_id):
    """Internal endpoint for payment verification (auth + rate limited)."""
    internal_token = (request.headers.get("X-Internal-Token") or "").strip()
    if not INTERNAL_VERIFY_TOKEN or internal_token != INTERNAL_VERIFY_TOKEN:
        return create_error_response("AUTH_ACCESS_DENIED")
    try:
        db = get_db()
    except Exception as e:
        logger.error(LOG_INTERNAL_VERIFY_DB_FAILED, getattr(g, "request_id", None), payment_public_id, e)
        return create_error_response("DATABASE_ERROR")

    return process_internal_verify(
        db=db,
        payment_public_id=payment_public_id,
    )
