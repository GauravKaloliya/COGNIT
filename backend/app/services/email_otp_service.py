"""Service helpers for email OTP verification flow."""

from __future__ import annotations

import hashlib
import hmac
import secrets
import base64
from concurrent.futures import ThreadPoolExecutor
import json
import time
import re
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

import requests
from requests import exceptions as requests_exceptions

from app.config import (
    EMAIL_OTP_EXPIRY_SECONDS,
    EMAIL_OTP_LENGTH,
    EMAIL_OTP_MAX_ATTEMPTS,
    EMAIL_OTP_SENDER,
    EMAIL_OTP_SUBJECT,
    EMAIL_OTP_WEBHOOK_TIMEOUT_SECONDS,
    EMAIL_OTP_WEBHOOK_URL,
    EMAIL_OTP_JWT_SECRET,
    EMAIL_OTP_JWT_TTL_SECONDS,
    EMAIL_OTP_HTML_TEMPLATE,
    SECRET_KEY,
)
from app.services.email_otp_query_service import (
    QUERY_FETCH_LATEST_EMAIL_OTP,
    QUERY_INCREMENT_OTP_ATTEMPTS,
    QUERY_INSERT_EMAIL_OTP,
    QUERY_SELECT_PARTICIPANT_BY_PUBLIC_ID,
    QUERY_EMAIL_IN_USE_BY_OTHER,
    QUERY_MARK_EXISTING_EMAIL_OTPS_USED,
    QUERY_MARK_OTP_USED,
    QUERY_MARK_PARTICIPANT_EMAIL_VERIFIED,
    QUERY_UPDATE_PARTICIPANT_EMAIL,
    QUERY_SELECT_PARTICIPANT_BY_PUBLIC_EMAIL,
)
from app.database import engine


OTP_DIGITS = "0123456789"
logger = logging.getLogger(__name__)
EMAIL_OTP_EXECUTOR = ThreadPoolExecutor(max_workers=2, thread_name_prefix="email-otp")


class EmailOtpSendError(RuntimeError):
    def __init__(self, *, kind: str, status_code: int | None = None, detail: str | None = None):
        self.kind = kind
        self.status_code = status_code
        self.detail = detail
        message = detail or f"email otp send failed: {kind}"
        super().__init__(message)


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("utf-8").rstrip("=")


def _build_jwt() -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    now = int(time.time())
    payload = {"iat": now, "exp": now + int(EMAIL_OTP_JWT_TTL_SECONDS)}
    header_b64 = _b64url_encode(json.dumps(header, separators=(",", ":")).encode("utf-8"))
    payload_b64 = _b64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signing_input = f"{header_b64}.{payload_b64}".encode("utf-8")
    signature = hmac.new(EMAIL_OTP_JWT_SECRET.encode("utf-8"), signing_input, hashlib.sha256).digest()
    signature_b64 = _b64url_encode(signature)
    return f"{header_b64}.{payload_b64}.{signature_b64}"


def generate_email_otp() -> str:
    return "".join(secrets.choice(OTP_DIGITS) for _ in range(max(1, int(EMAIL_OTP_LENGTH))))


def hash_email_otp(*, public_id: str, email: str, otp: str) -> str:
    payload = f"{public_id}:{email}:{otp}".encode("utf-8")
    return hmac.new(SECRET_KEY.encode("utf-8"), payload, hashlib.sha256).hexdigest()


def fetch_participant_by_public_email(db, *, public_id: str, email: str):
    return db.execute(QUERY_SELECT_PARTICIPANT_BY_PUBLIC_EMAIL, {"pub": public_id, "em": email}).fetchone()


def fetch_participant_by_public_id(db, *, public_id: str):
    return db.execute(QUERY_SELECT_PARTICIPANT_BY_PUBLIC_ID, {"pub": public_id}).fetchone()


def email_in_use_by_other(db, *, public_id: str, email: str) -> bool:
    return bool(db.execute(QUERY_EMAIL_IN_USE_BY_OTHER, {"pub": public_id, "em": email}).scalar())


def mark_existing_otps_used(db, *, public_id: str, email: str) -> None:
    db.execute(QUERY_MARK_EXISTING_EMAIL_OTPS_USED, {"pub": public_id, "em": email})


def insert_email_otp(db, *, public_id: str, email: str, otp_hash: str, expires_at: datetime) -> int:
    row = db.execute(QUERY_INSERT_EMAIL_OTP, {
        "pub": public_id,
        "em": email,
        "hash": otp_hash,
        "exp": expires_at,
    }).fetchone()
    if not row:
        raise RuntimeError("email otp insert failed")
    return int(row[0])


def fetch_latest_email_otp(db, *, public_id: str, email: str):
    return db.execute(QUERY_FETCH_LATEST_EMAIL_OTP, {"pub": public_id, "em": email}).fetchone()


def increment_email_otp_attempts(db, *, otp_id: int) -> None:
    db.execute(QUERY_INCREMENT_OTP_ATTEMPTS, {"id": otp_id})


def mark_email_otp_used(db, *, otp_id: int) -> None:
    db.execute(QUERY_MARK_OTP_USED, {"id": otp_id})


def mark_participant_email_verified(db, *, participant_id: int) -> None:
    db.execute(QUERY_MARK_PARTICIPANT_EMAIL_VERIFIED, {"pid": participant_id})


def update_participant_email(db, *, participant_id: int, email: str) -> None:
    db.execute(QUERY_UPDATE_PARTICIPANT_EMAIL, {"pid": participant_id, "em": email})


_HTML_TAG_RE = re.compile(r"<[^>]+>")


def _html_to_text(html: str) -> str:
    # Minimal, dependency-free HTML -> text fallback for email clients that don't render HTML.
    text = html.replace("<br>", "\n").replace("<br/>", "\n").replace("<br />", "\n")
    text = _HTML_TAG_RE.sub("", text)
    return " ".join(text.split()).strip()


def build_email_otp_payload(*, email: str, otp: str, public_id: str) -> dict:
    html = EMAIL_OTP_HTML_TEMPLATE.replace("{otp}", otp)
    text = _html_to_text(html)
    return {
        "to": email,
        "otp": otp,
        "from": EMAIL_OTP_SENDER,
        "subject": EMAIL_OTP_SUBJECT,
        # Keep both fields for compatibility with existing n8n mappings; both are derived from the HTML template.
        "body": text,
        "text": text,
        "html": html,
        "public_id": public_id,
    }


def send_email_otp(payload: dict, *, request_id: str | None = None) -> None:
    token = _build_jwt()
    headers = {"Authorization": f"Bearer {token}"}
    try:
        response = requests.post(
            EMAIL_OTP_WEBHOOK_URL,
            json=payload,
            headers=headers,
            timeout=EMAIL_OTP_WEBHOOK_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        return
    except requests_exceptions.Timeout as exc:
        raise EmailOtpSendError(kind="timeout", detail=str(exc)) from exc
    except requests_exceptions.HTTPError as exc:
        status_code = exc.response.status_code if exc.response is not None else None
        raise EmailOtpSendError(kind="http_error", status_code=status_code, detail=str(exc)) from exc
    except requests_exceptions.ConnectionError as exc:
        raise EmailOtpSendError(kind="connection_error", detail=str(exc)) from exc
    except requests_exceptions.RequestException as exc:
        raise EmailOtpSendError(kind="request_error", detail=str(exc)) from exc


def enqueue_email_otp(payload: dict, *, otp_id: int, request_id: str | None = None) -> None:
    def _send() -> None:
        try:
            send_email_otp(payload, request_id=request_id)
        except Exception:
            try:
                with engine.begin() as conn:
                    conn.execute(QUERY_MARK_OTP_USED, {"id": int(otp_id)})
            except Exception:
                pass

    EMAIL_OTP_EXECUTOR.submit(_send)


def otp_is_expired(expires_at: datetime) -> bool:
    if not expires_at:
        return True
    now = datetime.now(timezone.utc)
    expires_at_utc = expires_at
    if expires_at_utc.tzinfo is None:
        expires_at_utc = expires_at_utc.replace(tzinfo=timezone.utc)
    return now >= expires_at_utc


def otp_is_over_attempts(attempts: Optional[int]) -> bool:
    return int(attempts or 0) >= int(EMAIL_OTP_MAX_ATTEMPTS)


def otp_expiry_timestamp() -> datetime:
    return datetime.now(timezone.utc) + timedelta(seconds=int(EMAIL_OTP_EXPIRY_SECONDS))
