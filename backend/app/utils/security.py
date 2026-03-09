"""
Security utilities module for C.O.G.N.I.T. backend.
Provides payment signature generation, UPI link generation, and security helpers.
"""

import base64
import hashlib
import hmac
import json
import time
import urllib.parse
import re
from datetime import datetime, timezone
from typing import Optional

from app.config import PAYMENT_SECRET, UPI_VPA, UPI_NAME


# ────────────────────────────────────────────────
# Payment Signature Generation
# ────────────────────────────────────────────────

def generate_payment_signature(public_id: str, amount: str, expires_at: str) -> str:
    """
    Generate HMAC-SHA256 signature for payment validation.
    
    Args:
        public_id: Payment public identifier (UUID)
        amount: Payment amount as string
        expires_at: ISO format expiration timestamp
        
    Returns:
        Hexadecimal signature string
    """
    payload = f"{public_id}:{amount}:{expires_at}"
    return hmac.new(
        PAYMENT_SECRET.encode(),
        payload.encode(),
        hashlib.sha256
    ).hexdigest()


# ────────────────────────────────────────────────
# UPI Link Generation
# ────────────────────────────────────────────────

def generate_upi_link(amount: float) -> str:
    """
    Generate UPI payment link for mobile apps.
    
    Args:
        amount: Payment amount in INR
    Returns:
        UPI payment URI string
    """
    upi_vpa = str(UPI_VPA or "").strip()
    upi_name = str(UPI_NAME or "").strip()

    if not upi_vpa:
        raise ValueError("UPI_VPA is missing")
    if not re.match(r"^[A-Za-z0-9.\-_]{2,256}@[A-Za-z0-9.\-_]{2,256}$", upi_vpa):
        raise ValueError("UPI_VPA format is invalid")
    if not upi_name:
        raise ValueError("UPI_NAME is missing")

    try:
        amount_num = float(amount)
    except (TypeError, ValueError):
        raise ValueError("Amount is invalid") from None
    if amount_num <= 0:
        raise ValueError("Amount must be positive")

    params = {
        "pa": upi_vpa,
        "pn": upi_name,
        "am": f"{amount_num:.2f}",
        "cu": "INR",
        # Keep a stable note so payment intent is explicit for user and audit.
        "tn": "COGNIT",
    }
    return "upi://pay?" + urllib.parse.urlencode(params, quote_via=urllib.parse.quote)


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64url_decode(value: str) -> bytes:
    pad = "=" * ((4 - len(value) % 4) % 4)
    return base64.urlsafe_b64decode((value + pad).encode("ascii"))


def generate_payment_write_token(
    payment_public_id: str,
    participant_id: int,
    expires_at,
    payment_signature: str,
    *,
    device_fingerprint: Optional[str] = None,
    session_id: Optional[str] = None,
    nonce: Optional[str] = None,
) -> str:
    """
    Generate signed token authorizing writes for a specific payment session.
    """
    if isinstance(expires_at, datetime):
        exp_ts = int(expires_at.astimezone(timezone.utc).timestamp())
    else:
        exp_ts = int(datetime.fromisoformat(str(expires_at)).astimezone(timezone.utc).timestamp())

    header = {"alg": "HS256", "typ": "JWT", "kid": "pay-write-v1"}
    payload = {
        "sub": str(payment_public_id),
        "pid": int(participant_id),
        "exp": int(exp_ts),
        "iat": int(time.time()),
        "sig": str(payment_signature or ""),
        "dfp": str(device_fingerprint or ""),
        "sid": str(session_id or ""),
        "nonce": str(nonce or ""),
    }
    header_b64 = _b64url_encode(json.dumps(header, separators=(",", ":"), sort_keys=True).encode("utf-8"))
    payload_b64 = _b64url_encode(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8"))
    signing_input = f"{header_b64}.{payload_b64}"
    signature = hmac.new(PAYMENT_SECRET.encode(), signing_input.encode("utf-8"), hashlib.sha256).digest()
    return f"{signing_input}.{_b64url_encode(signature)}"


def verify_payment_write_token(token: str):
    """
    Verify signed payment write token and return payload if valid.
    """
    if not token or token.count(".") != 2:
        return None
    try:
        header_b64, payload_b64, sig_b64 = token.split(".")
        signing_input = f"{header_b64}.{payload_b64}"
        expected_sig = hmac.new(PAYMENT_SECRET.encode(), signing_input.encode("utf-8"), hashlib.sha256).digest()
        provided_sig = _b64url_decode(sig_b64)
        if not hmac.compare_digest(expected_sig, provided_sig):
            return None
        payload_raw = _b64url_decode(payload_b64)
        payload = json.loads(payload_raw.decode("utf-8"))
        exp_ts = int(payload.get("exp", 0))
        if exp_ts <= int(time.time()):
            return None
        return payload
    except Exception:
        return None
