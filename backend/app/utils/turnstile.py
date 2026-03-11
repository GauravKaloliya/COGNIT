"""
Cloudflare Turnstile verification utilities.
"""

from typing import Optional, Tuple
import ipaddress
import requests

from app.config import (
    TURNSTILE_ENABLED,
    TURNSTILE_SECRET_KEY,
    TURNSTILE_VERIFY_URL,
    TURNSTILE_TIMEOUT_SECONDS,
    TURNSTILE_BYPASS_LOCAL,
)


def _is_loopback_ip(value: Optional[str]) -> bool:
    if not value:
        return False
    ip_raw = str(value).strip()
    if not ip_raw:
        return False
    # Handle proxy lists: "client, proxy1, proxy2"
    ip_raw = ip_raw.split(",")[0].strip()
    # Handle IPv4-mapped IPv6 format.
    if ip_raw.lower().startswith("::ffff:"):
        ip_raw = ip_raw[7:]
    try:
        return ipaddress.ip_address(ip_raw).is_loopback
    except ValueError:
        return False


def _is_local_host(host: Optional[str]) -> bool:
    if not host:
        return False
    raw = str(host).strip().lower()
    if not raw:
        return False
    # Strip port if present.
    if ":" in raw:
        raw = raw.split(":", 1)[0]
    return raw in {"localhost", "127.0.0.1", "::1"}


def verify_turnstile_token(
    token: str,
    remote_ip: Optional[str] = None,
    host: Optional[str] = None,
) -> Tuple[bool, dict]:
    """
    Verify a Turnstile token against Cloudflare siteverify API.
    Returns (is_valid, response_json).
    """
    if not TURNSTILE_ENABLED:
        return True, {"success": True, "skipped": True}
    # Bypass only when explicitly allowed for local development.
    if TURNSTILE_BYPASS_LOCAL and (_is_loopback_ip(remote_ip) or _is_local_host(host)):
        return True, {"success": True, "skipped": True, "reason": "localhost"}
    if not TURNSTILE_SECRET_KEY:
        return False, {"success": False, "error-codes": ["missing-secret"]}
    if not token:
        return False, {"success": False, "error-codes": ["missing-input-response"]}

    payload = {
        "secret": TURNSTILE_SECRET_KEY,
        "response": token,
    }
    if remote_ip:
        payload["remoteip"] = remote_ip

    try:
        resp = requests.post(
            TURNSTILE_VERIFY_URL,
            data=payload,
            timeout=max(1.0, float(TURNSTILE_TIMEOUT_SECONDS)),
        )
        data = resp.json() if resp.content else {}
        return bool(data.get("success")), data
    except Exception:
        return False, {"success": False, "error-codes": ["verification-request-failed"]}
