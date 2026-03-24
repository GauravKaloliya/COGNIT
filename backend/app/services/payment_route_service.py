import logging
from datetime import datetime, timezone

from sqlalchemy import text

from app.config import (
    PARTICIPANT_PUBLIC_COOKIE_NAME,
    PARTICIPANT_SESSION_COOKIE_NAME,
)
from app.constants.payment_constants import PAYMENT_ACTIVE_STATUSES, PAYMENT_QR_BLOCKED_STATUSES, PAYMENT_STATUS_FAILED
from app.constants.request_keys import REQUEST_KEY_AMOUNT, REQUEST_KEY_PUBLIC_ID
from app.constants.response_keys import (
    RESPONSE_KEY_EXPIRES_AT,
    RESPONSE_KEY_PAYMENT_ID,
    RESPONSE_KEY_PAYMENT_TOKEN,
    RESPONSE_KEY_QR_BASE64,
)
from app.services.idempotency_service import load_idempotent_response, save_idempotent_response
from app.services.payment_session_service import (
    build_payment_status_response,
    build_qr_base64,
    expire_payment_if_needed,
    fetch_payment_status_row,
    fetch_token_mint_row,
    is_expected_payment_amount,
    issue_payment_write_token,
)
from app.services.payment_query_service import sync_participant_from_payment_status
from app.utils.helpers import create_error_response
from app.utils.runtime_cache import invalidate_payment_status_cache, set_cached_payment_status
from app.utils.security import generate_upi_link

logger = logging.getLogger(__name__)


def load_payment_create_replay(db, *, public_id: str, amount: float, endpoint: str, idempotency_key: str, build_request_hash):
    if not idempotency_key:
        return "", None
    request_hash = build_request_hash({
        REQUEST_KEY_PUBLIC_ID: public_id,
        REQUEST_KEY_AMOUNT: amount,
    })
    _idem, replay = load_idempotent_response(
        db,
        endpoint=endpoint,
        idempotency_key=idempotency_key,
        participant_public_id=public_id,
        request_hash=request_hash,
    )
    return request_hash, replay


def save_payment_create_replay(
    db,
    *,
    public_id: str,
    endpoint: str,
    idempotency_key: str,
    request_hash: str,
    response_payload: dict,
) -> None:
    if not idempotency_key:
        return
    save_idempotent_response(
        db,
        endpoint=endpoint,
        idempotency_key=idempotency_key,
        participant_public_id=public_id,
        request_hash=request_hash,
        response_body=response_payload,
        status_code=200,
    )


def payment_selection_error_response(selection: dict):
    status = str(selection.get("status") or "").upper()
    error_map = {
        "MAINTENANCE": "PAY_UPI_MAINTENANCE",
        "NO_ALTERNATE_UPI": "PAY_UPI_ALTERNATE_UNAVAILABLE",
        "USER_LIMIT_EXCEEDED": "PAY_UPI_USER_LIMIT",
        "SESSION_LIMIT_EXCEEDED": "PAY_UPI_SESSION_LIMIT",
    }
    error_key = error_map.get(status)
    return create_error_response(error_key) if error_key else None


def build_payment_status_payload(db, *, payment_public_id: str):
    row = fetch_payment_status_row(db, payment_public_id)
    if not row:
        return None, create_error_response("NF_PAYMENT_STATUS_NOT_FOUND")

    payment_id, participant_id, status, expires_at, amount, verified_at, verification_details, detected_app, auto_rejected, verification_attempts, _signature, _participant_session_id = row
    actual_amount = round(float(amount), 2) if amount is not None else None
    if actual_amount is None or not is_expected_payment_amount(actual_amount):
        if status in PAYMENT_ACTIVE_STATUSES:
            db.execute(text("""
                UPDATE payments
                SET status = :failed_status, updated_at = CURRENT_TIMESTAMP
                WHERE id = :pid
            """), {"pid": payment_id, "failed_status": PAYMENT_STATUS_FAILED})
            sync_participant_from_payment_status(
                db,
                participant_id=int(participant_id),
                status=PAYMENT_STATUS_FAILED,
            )
            db.commit()
        invalidate_payment_status_cache(payment_public_id)
        return None, create_error_response("PAY_INVALID_AMOUNT")

    status, now = expire_payment_if_needed(
        db,
        payment_id=int(payment_id),
        status=status,
        expires_at=expires_at,
    )
    payload = build_payment_status_response(
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
    )
    set_cached_payment_status(
        payment_public_id,
        payload,
        is_terminal=status not in PAYMENT_ACTIVE_STATUSES,
        payment_id=payment_id,
    )
    return payload, None


def build_payment_qr_response(db, *, payment_public_id: str):
    row = db.execute(text("""
        SELECT amount, status, upi_vpa, upi_name
        FROM payments
        WHERE public_id = :pid
        LIMIT 1
    """), {"pid": payment_public_id}).fetchone()
    if not row:
        return None, create_error_response("NF_PAYMENT_QR_NOT_FOUND")

    amount, status, upi_vpa, upi_name = row
    actual_amount = round(float(amount), 2) if amount is not None else None
    if actual_amount is None or not is_expected_payment_amount(actual_amount):
        return None, create_error_response("PAY_INVALID_AMOUNT")
    if status in PAYMENT_QR_BLOCKED_STATUSES:
        return None, create_error_response("PAY_PAYMENT_QR_INVALID_STATE")

    upi_link = generate_upi_link(
        float(amount),
        payment_ref=str(payment_public_id),
        upi_vpa=upi_vpa,
        upi_name=upi_name,
    )
    return {
        RESPONSE_KEY_PAYMENT_ID: payment_public_id,
        RESPONSE_KEY_QR_BASE64: build_qr_base64(upi_link),
    }, None


def build_payment_token_response(db, *, payment_public_id: str, request_json: dict, cookies: dict, device_fingerprint: str):
    public_id = (request_json.get("public_id") or "").strip() or (cookies.get(PARTICIPANT_PUBLIC_COOKIE_NAME) or "").strip()
    session_id = (request_json.get("session_id") or "").strip() or (cookies.get(PARTICIPANT_SESSION_COOKIE_NAME) or "").strip()
    missing = []
    if not public_id:
        missing.append("public_id")
    if not session_id:
        missing.append("session_id")
    if missing:
        return None, create_error_response("VAL_PAYMENT_TOKEN_FIELDS_REQUIRED", fields=missing)

    row = fetch_token_mint_row(
        db,
        payment_public_id=payment_public_id,
        public_id=public_id,
        session_id=session_id,
    )
    if not row:
        return None, create_error_response("AUTH_PAYMENT_TOKEN_ACCESS_DENIED")

    payment_id, participant_id, status, expires_at, signature, participant_session_id = row
    now = datetime.now(timezone.utc)
    if expires_at and now > expires_at:
        return None, create_error_response("PAY_EXPIRED")
    if status not in PAYMENT_ACTIVE_STATUSES:
        return None, create_error_response("PAY_PAYMENT_TOKEN_INVALID_STATE")

    token = issue_payment_write_token(
        db,
        payment_id=int(payment_id),
        payment_public_id=str(payment_public_id),
        participant_id=int(participant_id),
        expires_at=expires_at,
        payment_signature=signature,
        device_fingerprint=device_fingerprint or "",
        session_id=participant_session_id or "",
    )
    return {
        RESPONSE_KEY_PAYMENT_ID: payment_public_id,
        RESPONSE_KEY_PAYMENT_TOKEN: token,
        RESPONSE_KEY_EXPIRES_AT: expires_at.isoformat() if expires_at else None,
    }, None
