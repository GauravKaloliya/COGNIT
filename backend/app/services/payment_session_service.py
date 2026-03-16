"""Service helpers for payment session lifecycle."""

from __future__ import annotations

import base64
import json
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from io import BytesIO

import qrcode
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.config import PAYMENT_AMOUNT, PAYMENT_EXPIRY_SECONDS
from app.database import engine
from app.utils.helpers import get_ip_hash
from app.utils.security import (
    generate_payment_signature,
    generate_payment_write_token,
    generate_upi_link,
)

QR_BASE64_CACHE = {}
PAYMENT_AUDIT_EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="payment-audit")


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
            "device_fingerprint": device_fingerprint,
            "request_data": json.dumps(request_data or {}),
            "response_data": json.dumps(response_data or {}),
            "fraud_signals": json.dumps(fraud_signals or {}),
            "details": (details or "")[:8000],
        })
    except Exception:
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
        PAYMENT_AUDIT_EXECUTOR.submit(_write)
    except Exception:
        pass


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
    return db.execute(text("""
        SELECT session_id FROM participants WHERE id = :pid
    """), {"pid": participant_id}).scalar()


def mark_existing_active_payments_failed(db, participant_id: int):
    db.execute(text("""
        UPDATE payments
        SET status = 'failed',
            updated_at = CURRENT_TIMESTAMP
        WHERE participant_id = :pid
          AND status IN ('pending', 'processing')
    """), {"pid": participant_id})


def create_payment_record(
    db,
    *,
    participant_id: int,
    public_id: str,
    amount: float,
):
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=PAYMENT_EXPIRY_SECONDS)
    expires_str = expires_at.isoformat()
    payment_public_id = str(uuid.uuid4())
    signature = generate_payment_signature(public_id, str(amount), expires_str)
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
    device_fingerprint: str = "",
    session_id: str = "",
    time_remaining_seconds: int = PAYMENT_EXPIRY_SECONDS,
):
    upi_link = generate_upi_link(amount)
    return {
        "payment_id": str(payment_public_id),
        "amount": amount,
        "expires_at": expires_str,
        "signature": signature,
        "payment_token": issue_payment_write_token(
            db,
            payment_id=int(payment_row_id),
            payment_public_id=str(payment_public_id),
            participant_id=int(participant_id),
            expires_at=expires_at,
            payment_signature=signature,
            device_fingerprint=device_fingerprint or "",
            session_id=session_id or "",
        ),
        "upi_link": upi_link,
        "qr_ready": True,
        "timer_activated": True,
        "time_remaining_seconds": time_remaining_seconds,
    }


def fetch_active_payment_for_reuse(db, participant_id: int):
    return db.execute(text("""
        SELECT id, public_id, amount, expires_at, signature
        FROM payments
        WHERE participant_id = :pid
          AND status IN ('pending', 'processing')
        ORDER BY created_at DESC
        LIMIT 1
    """), {"pid": participant_id}).fetchone()


def build_reused_payment_response_payload(
    db,
    *,
    existing_payment_row,
    participant_id: int,
    participant_session_id: str,
    device_fingerprint: str,
):
    existing_payment_row_id, existing_payment_id, existing_amount, existing_expires_at, existing_signature = existing_payment_row
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
        device_fingerprint=device_fingerprint,
        session_id=participant_session_id or "",
        time_remaining_seconds=remaining_seconds,
    )


def is_duplicate_active_payment_error(error: Exception) -> bool:
    return isinstance(error, IntegrityError) or "idx_payments_one_active_per_participant" in str(error)


def fetch_payment_status_row(db, payment_public_id: str):
    return db.execute(text("""
        SELECT p.id, p.participant_id, p.status, p.expires_at, p.amount, p.verified_at, p.verification_details, p.detected_app, p.auto_rejected, p.verification_attempts, p.signature, pr.session_id
        FROM payments p
        JOIN participants pr ON pr.id = p.participant_id
        WHERE p.public_id = :pid
    """), {"pid": payment_public_id}).fetchone()


def expire_payment_if_needed(db, *, payment_id: int, status: str, expires_at):
    now = datetime.now(timezone.utc)
    is_expired = expires_at and now > expires_at
    updated_status = status
    if is_expired and status in ("pending", "processing"):
        db.execute(text("""
            UPDATE payments
            SET status = 'expired', updated_at = CURRENT_TIMESTAMP
            WHERE id = :pid
        """), {"pid": payment_id})
        db.commit()
        updated_status = "expired"
    return updated_status, now


def build_payment_status_response(*, payment_public_id: str, status: str, amount, expires_at, now, verified_at, verification_details, detected_app, auto_rejected, verification_attempts):
    return {
        "payment_id": payment_public_id,
        "status": status,
        "amount": float(amount) if amount else None,
        "expires_at": expires_at.isoformat() if expires_at else None,
        "is_expired": status == "expired",
        "time_remaining_seconds": max(0, int((expires_at - now).total_seconds())) if expires_at and status in ("pending", "processing") else 0,
        "verified_at": verified_at.isoformat() if verified_at else None,
        "verification_attempts": int(verification_attempts or 0),
        **({"verification_details": verification_details} if verification_details else {}),
        **({"detected_app": detected_app} if detected_app else {}),
        **({"auto_rejected": True} if auto_rejected else {}),
    }


def fetch_token_mint_row(db, *, payment_public_id: str, public_id: str, session_id: str):
    return db.execute(text("""
        SELECT p.id, p.participant_id, p.status, p.expires_at, p.signature, pr.session_id
        FROM payments p
        JOIN participants pr ON pr.id = p.participant_id
        WHERE p.public_id = :pid
          AND pr.public_id = :pub
          AND pr.session_id = :sid
        LIMIT 1
    """), {"pid": payment_public_id, "pub": public_id, "sid": session_id}).fetchone()
