"""Service helpers for payment session lifecycle."""

from __future__ import annotations

import base64
import logging
import json
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from io import BytesIO

import qrcode
from sqlalchemy.exc import IntegrityError

from app.config import PAYMENT_AMOUNT, PAYMENT_EXPIRY_SECONDS
from app.constants.payment_constants import (
    PAYMENT_ACTIVE_STATUSES,
    PAYMENT_DETECTED_APP_UNKNOWN,
    PAYMENT_STATUS_EXPIRED,
    PAYMENT_STATUS_PENDING,
    PAYMENT_STATUS_PROCESSING,
    PAYMENT_STATUS_FAILED,
)
from app.constants.response_keys import (
    RESPONSE_KEY_AMOUNT,
    RESPONSE_KEY_AUTO_REJECTED,
    RESPONSE_KEY_DETECTED_APP,
    RESPONSE_KEY_EXPIRES_AT,
    RESPONSE_KEY_IS_EXPIRED,
    RESPONSE_KEY_PAYMENT_ID,
    RESPONSE_KEY_PAYMENT_TOKEN,
    RESPONSE_KEY_QR_READY,
    RESPONSE_KEY_SIGNATURE,
    RESPONSE_KEY_STATUS,
    RESPONSE_KEY_TIME_REMAINING_SECONDS,
    RESPONSE_KEY_TIMER_ACTIVATED,
    RESPONSE_KEY_UPI_LINK,
    RESPONSE_KEY_VERIFICATION_ATTEMPTS,
    RESPONSE_KEY_VERIFICATION_DETAILS,
    RESPONSE_KEY_VERIFIED_AT,
)
from app.constants.observability_constants import (
    OBS_EVENT_PAYMENT_AUDIT_ENQUEUE_FAILED,
    OBS_EVENT_PAYMENT_AUDIT_INSERT_FAILED,
    OBS_EVENT_PAYMENT_AUDIT_WRITE_FAILED,
)
from app.utils.observability import log_event
from app.database import engine
from app.services.payment_session_query_service import (
    QUERY_EXPIRE_PAYMENT_IF_NEEDED,
    QUERY_FETCH_ACTIVE_PAYMENT_FOR_REUSE,
    QUERY_FETCH_PAYMENT_STATUS_ROW,
    QUERY_FETCH_TOKEN_MINT_ROW,
    QUERY_GET_PARTICIPANT_SESSION_ID,
    QUERY_INSERT_PAYMENT_AUDIT_LOG,
    QUERY_INSERT_PAYMENT_RECORD,
    QUERY_MARK_EXISTING_ACTIVE_PAYMENTS_FAILED,
    QUERY_UPDATE_PAYMENT_WRITE_TOKEN_METADATA,
)
from app.utils.helpers import get_ip_hash
from app.utils.security import (
    generate_payment_signature,
    generate_payment_write_token,
    generate_upi_link,
)

QR_BASE64_CACHE = {}
PAYMENT_AUDIT_EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="payment-audit")
logger = logging.getLogger(__name__)


def issue_payment_write_token(
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
    db.execute(QUERY_UPDATE_PAYMENT_WRITE_TOKEN_METADATA, {
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


def log_payment_audit(
    db,
    *,
    request,
    device_fingerprint: str | None,
    event_type: str,
    payment_id=None,
    participant_id=None,
    details: str = "",
    request_data=None,
    response_data=None,
    fraud_signals=None,
):
    """Best-effort payment audit log writer; never breaks request flow."""
    try:
        db.execute(QUERY_INSERT_PAYMENT_AUDIT_LOG, {
            "event_type": event_type,
            "payment_id": payment_id,
            "participant_id": participant_id,
            "ip_hash": get_ip_hash(),
            "user_agent": request.headers.get("User-Agent", "")[:512],
            "device_fingerprint": device_fingerprint,
            "request_data": json.dumps(request_data or {}),
            "response_data": json.dumps(response_data or {}),
            "fraud_signals": json.dumps(fraud_signals or {}),
            "details": (details or "")[:8000],
        })
    except Exception as exc:
        log_event(logger, OBS_EVENT_PAYMENT_AUDIT_INSERT_FAILED, level=logging.WARNING, error=str(exc))
        return


def enqueue_payment_audit(
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
                conn.execute(QUERY_INSERT_PAYMENT_AUDIT_LOG, {
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
        except Exception as exc:
            log_event(logger, OBS_EVENT_PAYMENT_AUDIT_WRITE_FAILED, level=logging.WARNING, error=str(exc))

    try:
        PAYMENT_AUDIT_EXECUTOR.submit(_write)
    except Exception as exc:
        log_event(logger, OBS_EVENT_PAYMENT_AUDIT_ENQUEUE_FAILED, level=logging.WARNING, error=str(exc))


def build_qr_base64(upi_link: str) -> str:
    cached = QR_BASE64_CACHE.get(upi_link)
    if cached:
        return cached
    qr = qrcode.make(upi_link)
    buffer = BytesIO()
    qr.save(buffer, format="PNG")
    encoded = base64.b64encode(buffer.getvalue()).decode()
    QR_BASE64_CACHE[upi_link] = encoded
    return encoded


def normalize_payment_amount(raw_amount):
    try:
        return round(float(raw_amount if raw_amount is not None else PAYMENT_AMOUNT), 2)
    except Exception:
        return PAYMENT_AMOUNT


def is_expected_payment_amount(amount) -> bool:
    return round(float(PAYMENT_AMOUNT), 2) == round(float(amount), 2)


def get_participant_session_id(db, participant_id: int):
    return db.execute(QUERY_GET_PARTICIPANT_SESSION_ID, {"pid": participant_id}).scalar()


def mark_existing_active_payments_failed(db, participant_id: int):
    db.execute(QUERY_MARK_EXISTING_ACTIVE_PAYMENTS_FAILED, {
        "pid": participant_id,
        "failed_status": PAYMENT_STATUS_FAILED,
        "pending_status": PAYMENT_STATUS_PENDING,
        "processing_status": PAYMENT_STATUS_PROCESSING,
    })


def create_payment_record(
    db,
    *,
    participant_id: int,
    public_id: str,
    amount: float,
    upi_account_id: int | None = None,
    upi_vpa: str | None = None,
    upi_name: str | None = None,
):
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=PAYMENT_EXPIRY_SECONDS)
    expires_str = expires_at.isoformat()
    payment_public_id = str(uuid.uuid4())
    signature = generate_payment_signature(public_id, str(amount), expires_str)
    payment_row = db.execute(QUERY_INSERT_PAYMENT_RECORD, {
        "pid": participant_id,
        "pub_id": payment_public_id,
        "upi_account_id": upi_account_id,
        "upi_vpa": upi_vpa,
        "upi_name": upi_name,
        "amt": amount,
        "sig": signature,
        "exp": expires_at,
        "timer_time": datetime.now(timezone.utc),
        "detected_app": PAYMENT_DETECTED_APP_UNKNOWN,
    }).fetchone()
    return payment_row, signature, expires_at, expires_str


def build_payment_response_payload(
    db,
    *,
    payment_row_id: int,
    payment_public_id: str,
    participant_id: int,
    public_id: str,
    amount: float,
    expires_at,
    expires_str: str,
    signature: str,
    upi_vpa: str | None = None,
    upi_name: str | None = None,
    device_fingerprint: str = "",
    session_id: str = "",
    time_remaining_seconds: int = PAYMENT_EXPIRY_SECONDS,
):
    upi_link = generate_upi_link(
        amount,
        payment_ref=str(payment_public_id),
        upi_vpa=upi_vpa,
        upi_name=upi_name,
    )
    return {
        RESPONSE_KEY_PAYMENT_ID: str(payment_public_id),
        RESPONSE_KEY_AMOUNT: amount,
        RESPONSE_KEY_EXPIRES_AT: expires_str,
        RESPONSE_KEY_SIGNATURE: signature,
        RESPONSE_KEY_PAYMENT_TOKEN: issue_payment_write_token(
            db,
            payment_id=int(payment_row_id),
            payment_public_id=str(payment_public_id),
            participant_id=int(participant_id),
            expires_at=expires_at,
            payment_signature=signature,
            device_fingerprint=device_fingerprint or "",
            session_id=session_id or "",
        ),
        RESPONSE_KEY_UPI_LINK: upi_link,
        RESPONSE_KEY_QR_READY: True,
        RESPONSE_KEY_TIMER_ACTIVATED: True,
        RESPONSE_KEY_TIME_REMAINING_SECONDS: time_remaining_seconds,
    }


def fetch_active_payment_for_reuse(db, participant_id: int):
    return db.execute(QUERY_FETCH_ACTIVE_PAYMENT_FOR_REUSE, {
        "pid": participant_id,
        "pending_status": PAYMENT_STATUS_PENDING,
        "processing_status": PAYMENT_STATUS_PROCESSING,
    }).fetchone()


def build_reused_payment_response_payload(
    db,
    *,
    existing_payment_row,
    participant_id: int,
    participant_session_id: str,
    device_fingerprint: str,
):
    (
        existing_payment_row_id,
        existing_payment_id,
        existing_amount,
        existing_expires_at,
        existing_signature,
        existing_upi_account_id,
        existing_upi_vpa,
        existing_upi_name,
    ) = existing_payment_row
    remaining_seconds = max(
        0,
        int((existing_expires_at - datetime.now(timezone.utc)).total_seconds())
    ) if existing_expires_at else PAYMENT_EXPIRY_SECONDS
    return build_payment_response_payload(
        db,
        payment_row_id=int(existing_payment_row_id),
        payment_public_id=str(existing_payment_id),
        participant_id=int(participant_id),
        public_id="",
        amount=float(existing_amount),
        expires_at=existing_expires_at or (datetime.now(timezone.utc) + timedelta(seconds=PAYMENT_EXPIRY_SECONDS)),
        expires_str=existing_expires_at.isoformat() if existing_expires_at else None,
        signature=existing_signature,
        upi_vpa=existing_upi_vpa,
        upi_name=existing_upi_name,
        device_fingerprint=device_fingerprint,
        session_id=participant_session_id or "",
        time_remaining_seconds=remaining_seconds,
    )


def is_duplicate_active_payment_error(error: Exception) -> bool:
    return isinstance(error, IntegrityError) or "idx_payments_one_active_per_participant" in str(error)


def fetch_payment_status_row(db, payment_public_id: str):
    return db.execute(QUERY_FETCH_PAYMENT_STATUS_ROW, {"pid": payment_public_id}).fetchone()


def expire_payment_if_needed(db, *, payment_id: int, status: str, expires_at):
    now = datetime.now(timezone.utc)
    is_expired = expires_at and now > expires_at
    updated_status = status
    if is_expired and status in PAYMENT_ACTIVE_STATUSES:
        db.execute(QUERY_EXPIRE_PAYMENT_IF_NEEDED, {"pid": payment_id, "expired_status": PAYMENT_STATUS_EXPIRED})
        db.commit()
        updated_status = PAYMENT_STATUS_EXPIRED
    return updated_status, now


def build_payment_status_response(*, payment_public_id: str, status: str, amount, expires_at, now, verified_at, verification_details, detected_app, auto_rejected, verification_attempts):
    return {
        RESPONSE_KEY_PAYMENT_ID: payment_public_id,
        RESPONSE_KEY_STATUS: status,
        RESPONSE_KEY_AMOUNT: float(amount) if amount else None,
        RESPONSE_KEY_EXPIRES_AT: expires_at.isoformat() if expires_at else None,
        RESPONSE_KEY_IS_EXPIRED: status == PAYMENT_STATUS_EXPIRED,
        RESPONSE_KEY_TIME_REMAINING_SECONDS: max(0, int((expires_at - now).total_seconds())) if expires_at and status in PAYMENT_ACTIVE_STATUSES else 0,
        RESPONSE_KEY_VERIFIED_AT: verified_at.isoformat() if verified_at else None,
        RESPONSE_KEY_VERIFICATION_ATTEMPTS: int(verification_attempts or 0),
        **({RESPONSE_KEY_VERIFICATION_DETAILS: verification_details} if verification_details else {}),
        **({RESPONSE_KEY_DETECTED_APP: detected_app} if detected_app else {}),
        **({RESPONSE_KEY_AUTO_REJECTED: True} if auto_rejected else {}),
    }


def fetch_token_mint_row(db, *, payment_public_id: str, public_id: str, session_id: str):
    return db.execute(QUERY_FETCH_TOKEN_MINT_ROW, {"pid": payment_public_id, "pub": public_id, "sid": session_id}).fetchone()
