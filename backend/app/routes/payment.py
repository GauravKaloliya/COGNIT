"""
Payment routes module for C.O.G.N.I.T. backend.
Handles payment creation, screenshot upload, verification, and status.
"""

import logging
from datetime import datetime, timezone

from flask import Blueprint, g, request
from flask_limiter.util import get_remote_address

from app.config import (
    PAYMENT_EXPIRY_SECONDS,
    S3_BUCKET_NAME,
    PAYMENT_CREATE_RATE_LIMIT,
    PAYMENT_VERIFY_UPLOAD_RATE_LIMIT,
    PAYMENT_STATUS_RATE_LIMIT,
    PAYMENT_STATUS_RATE_LIMIT_PER_PAYMENT,
    PAYMENT_TOKEN_RATE_LIMIT,
    PAYMENT_TOKEN_RATE_LIMIT_PER_PAYMENT,
    INTERNAL_VERIFY_TOKEN,
    INTERNAL_VERIFY_RATE_LIMIT,
)
from app.constants.event_constants import (
    AUDIT_EVENT_PAYMENT_CREATE_FAILED,
    AUDIT_EVENT_PAYMENT_CREATE_REUSED_ACTIVE,
    AUDIT_EVENT_PAYMENT_CREATE_SUCCESS,
    HTTP_METHOD_GET,
    HTTP_METHOD_POST,
)
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
    REQUEST_KEY_IDEMPOTENCY_KEY,
    REQUEST_KEY_PUBLIC_ID,
    REQUEST_KEY_TURNSTILE_TOKEN,
)
from app.constants.payment_constants import (
    PAYMENT_STATUS_READ_ALLOWED,
)
from app.constants.route_constants import (
    INTERNAL_PAYMENT_VERIFY_ROUTE,
    PAYMENTS_CREATE_ROUTE,
    PAYMENT_QR_ROUTE,
    PAYMENT_STATUS_ROUTE,
    PAYMENT_TOKEN_ROUTE,
    PAYMENT_UPLOAD_URL_ROUTE,
    PAYMENT_VERIFY_UPLOAD_ROUTE,
)
from app.database import get_db
from app.extensions import limiter, s3
from app.utils.helpers import (
    create_error_response,
    get_ip_hash,
    success_response,
)
from app.utils.runtime_cache import (
    get_cached_payment_status,
    resolve_participant_id,
)
from app.utils.decorators import track_performance, require_idempotency_key
from app.utils.turnstile import verify_turnstile_token
from app.utils.observability import log_event
from app.constants.observability_constants import OBS_EVENT_PAYMENT_REUSE_PROBE_FAILED
from app.services.payment_verify_service import process_internal_verify, process_verify_upload
from app.services.payment_route_service import (
    build_payment_qr_response,
    build_payment_status_payload,
    build_payment_token_response,
    load_payment_create_replay,
    payment_selection_error_response,
    save_payment_create_replay,
)
from app.services.payment_upload_service import build_payment_upload_url_response
from app.services import (
    build_payment_response_payload,
    build_reused_payment_response_payload,
    build_request_hash,
    create_payment_record,
    fetch_used_upis_for_participant,
    enqueue_payment_audit,
    fetch_active_payment_for_reuse,
    get_participant_session_id,
    is_duplicate_active_payment_error,
    is_expected_payment_amount,
    log_payment_audit,
    mark_existing_active_payments_failed,
    normalize_payment_amount,
    select_upi_for_payment,
)
from middleware.payment_flow import require_valid_payment_session


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

    logger.info(
        "payment_create_request request_id=%s public_id=%s idempotency=%s",
        getattr(g, "request_id", None),
        str(public_id)[:12] if public_id else None,
        bool(idempotency_key),
    )
    if not public_id:
        return create_error_response("VAL_PAYMENT_CREATE_PUBLIC_ID_REQUIRED")

    amount = normalize_payment_amount(amount)
    if not is_expected_payment_amount(amount):
        return create_error_response("PAY_PAYMENT_CREATE_INVALID_AMOUNT")

    ok, _ts_data = verify_turnstile_token(turnstile_token, request.remote_addr, request.host, endpoint=request.path)
    if not ok:
        return create_error_response("BOT_PAYMENT_CREATE_FAILED")

    try:
        db = get_db()
    except Exception as e:
        logger.error(LOG_PAYMENT_CREATE_DB_FAILED, getattr(g, "request_id", None), e)
        return create_error_response("SYS_PAYMENT_CREATE_FAILED")

    participant_id = resolve_participant_id(db, str(public_id).strip())
    if not participant_id:
        return create_error_response("NF_PAYMENT_CREATE_PARTICIPANT")

    participant_session_id = get_participant_session_id(db, participant_id)
    request_hash, replay = load_payment_create_replay(
        db,
        public_id=str(public_id).strip(),
        amount=amount,
        endpoint=PAYMENTS_CREATE_ROUTE,
        idempotency_key=idempotency_key,
        build_request_hash=build_request_hash,
    )
    if replay:
        payload, status_code = replay
        return success_response(payload), status_code

    user_key = get_ip_hash()
    used_upis = fetch_used_upis_for_participant(db, participant_id=participant_id, now_utc=datetime.now(timezone.utc))
    selection = select_upi_for_payment(
        db,
        user_key=user_key,
        session_id=participant_session_id or "",
        used_upis=used_upis,
    )
    selection_error = payment_selection_error_response(selection)
    if selection_error is not None:
        try:
            db.rollback()
        except Exception:
            pass
        return selection_error

    mark_existing_active_payments_failed(db, participant_id)

    try:
        payment_row, signature, expires_at, expires_str = create_payment_record(
            db,
            participant_id=participant_id,
            public_id=public_id,
            amount=amount,
            upi_account_id=selection.get("upi_account_id"),
            upi_vpa=selection.get("upi_vpa"),
            upi_name=selection.get("upi_name"),
        )
        logger.info(
            "payment_create_success request_id=%s public_id=%s payment_id=%s expires_at=%s",
            getattr(g, "request_id", None),
            str(public_id)[:12],
            str(payment_row[1]),
            expires_str,
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
            upi_vpa=selection.get("upi_vpa"),
            upi_name=selection.get("upi_name"),
            device_fingerprint=getattr(g, "device_fingerprint", None) or "",
            session_id=participant_session_id or "",
            time_remaining_seconds=PAYMENT_EXPIRY_SECONDS,
        )
        save_payment_create_replay(
            db,
            public_id=str(public_id).strip(),
            endpoint=PAYMENTS_CREATE_ROUTE,
            idempotency_key=idempotency_key,
            request_hash=request_hash,
            response_payload=response_payload,
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
        except Exception:
            pass
        # Handle concurrent duplicate create calls (e.g., frontend double-invoke)
        # by returning the existing active payment instead of failing with 500.
        if is_duplicate_active_payment_error(e):
            try:
                existing = fetch_active_payment_for_reuse(db, participant_id)
                if existing:
                    logger.info(
                        "payment_create_reuse request_id=%s public_id=%s payment_id=%s",
                        getattr(g, "request_id", None),
                        str(public_id)[:12],
                        str(existing[1]),
                    )
                    response_payload = build_reused_payment_response_payload(
                        db,
                        existing_payment_row=existing,
                        participant_id=int(participant_id),
                        participant_session_id=participant_session_id or "",
                        device_fingerprint=getattr(g, "device_fingerprint", None) or "",
                    )
                    save_payment_create_replay(
                        db,
                        public_id=str(public_id).strip(),
                        endpoint=PAYMENTS_CREATE_ROUTE,
                        idempotency_key=idempotency_key,
                        request_hash=request_hash,
                        response_payload=response_payload,
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
        return create_error_response("SYS_PAYMENT_CREATE_FAILED")

@payment_bp.route(PAYMENT_QR_ROUTE, methods=[HTTP_METHOD_GET])
@limiter.limit(PAYMENT_STATUS_RATE_LIMIT)
@track_performance
def get_payment_qr(payment_public_id):
    """Return payment QR code lazily to keep /payments/create lightweight."""
    try:
        db = get_db()
        payload, error_response = build_payment_qr_response(db, payment_public_id=payment_public_id)
        if error_response is not None:
            return error_response
        return success_response(payload)
    except Exception as exc:
        logger.error(LOG_PAYMENT_QR_FAILED, getattr(g, "request_id", None), payment_public_id, exc)
        return create_error_response("SYS_PAYMENT_QR_FAILED")


@payment_bp.route(PAYMENT_UPLOAD_URL_ROUTE, methods=[HTTP_METHOD_POST])
@require_valid_payment_session(require_write_token=True)
@limiter.limit(PAYMENT_VERIFY_UPLOAD_RATE_LIMIT)
@track_performance
def get_payment_upload_url(payment_public_id):
    data = request.json or {}
    try:
        payload, error_response = build_payment_upload_url_response(
            payment_public_id=payment_public_id,
            data=data,
            s3_client=s3,
            bucket_name=S3_BUCKET_NAME,
        )
        if error_response is not None:
            return error_response
    except Exception as exc:
        logger.error(LOG_PAYMENT_UPLOAD_URL_FAILED, getattr(g, "request_id", None), payment_public_id, exc)
        return create_error_response("SYS_PAYMENT_UPLOAD_URL_FAILED")
    return success_response(payload)


@payment_bp.route(PAYMENT_VERIFY_UPLOAD_ROUTE, methods=[HTTP_METHOD_POST])
@require_valid_payment_session(require_write_token=True)
@limiter.limit(PAYMENT_VERIFY_UPLOAD_RATE_LIMIT)
@track_performance
@require_idempotency_key
def verify_and_upload_payment(payment_public_id):
    data = request.json or {}
    turnstile_token = (data.get(REQUEST_KEY_TURNSTILE_TOKEN) or "").strip()
    ok, _ts_data = verify_turnstile_token(turnstile_token, request.remote_addr, request.host, endpoint=request.path)
    if not ok:
        return create_error_response("BOT_PAYMENT_VERIFY_FAILED")

    try:
        db = get_db()
    except Exception as e:
        logger.error(LOG_PAYMENT_VERIFY_DB_FAILED, getattr(g, "request_id", None), e)
        return create_error_response("SYS_PAYMENT_VERIFY_FAILED")

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
    logger.info(
        "payment_status_request request_id=%s payment_id=%s",
        getattr(g, "request_id", None),
        payment_public_id,
    )
    try:
        cached_payload = get_cached_payment_status(payment_public_id)
        if cached_payload:
            return success_response(cached_payload)

        db = get_db()
        payload, error_response = build_payment_status_payload(
            db,
            payment_public_id=payment_public_id,
        )
        if error_response is not None:
            return error_response
        return success_response(payload)
    except Exception as e:
        logger.error(LOG_PAYMENT_STATUS_FAILED, getattr(g, "request_id", None), payment_public_id, e)
        return create_error_response("SYS_PAYMENT_STATUS_FAILED")


@payment_bp.route(PAYMENT_TOKEN_ROUTE, methods=[HTTP_METHOD_POST])
@limiter.limit(PAYMENT_TOKEN_RATE_LIMIT)
@limiter.limit(PAYMENT_TOKEN_RATE_LIMIT_PER_PAYMENT, key_func=_payment_rate_key)
@track_performance
def mint_payment_token(payment_public_id):
    """Mint a new payment write token for an active session."""
    logger.info("payment_token_request request_id=%s method=%s payment_id=%s", getattr(g, "request_id", None), request.method, payment_public_id)
    try:
        db = get_db()
        payload, error_response = build_payment_token_response(
            db,
            payment_public_id=payment_public_id,
            request_json=request.json or {},
            cookies=request.cookies,
            device_fingerprint=getattr(g, "device_fingerprint", None) or "",
        )
        if error_response is not None:
            return error_response
        db.commit()
        return success_response(payload)
    except Exception as e:
        logger.error(LOG_PAYMENT_TOKEN_FAILED, getattr(g, "request_id", None), payment_public_id, e)
        return create_error_response("SYS_PAYMENT_TOKEN_FAILED")


@payment_bp.route(INTERNAL_PAYMENT_VERIFY_ROUTE, methods=[HTTP_METHOD_POST])
@limiter.limit(INTERNAL_VERIFY_RATE_LIMIT)
def verify_payment(payment_public_id):
    """Internal endpoint for payment verification (auth + rate limited)."""
    internal_token = (request.headers.get("X-Internal-Token") or "").strip()
    if not INTERNAL_VERIFY_TOKEN or internal_token != INTERNAL_VERIFY_TOKEN:
        return create_error_response("AUTH_INTERNAL_PAYMENT_VERIFY_ACCESS_DENIED")
    try:
        db = get_db()
    except Exception as e:
        logger.error(LOG_INTERNAL_VERIFY_DB_FAILED, getattr(g, "request_id", None), payment_public_id, e)
        return create_error_response("SYS_INTERNAL_PAYMENT_VERIFY_DB_FAILED")

    return process_internal_verify(
        db=db,
        payment_public_id=payment_public_id,
    )
