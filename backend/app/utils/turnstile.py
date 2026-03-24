"""
Cloudflare Turnstile verification utilities.
"""

import logging
import time
from typing import Optional, Tuple
import ipaddress
import requests
from flask import g

from app.config import (
    TURNSTILE_ENABLED,
    TURNSTILE_SECRET_KEY,
    TURNSTILE_VERIFY_URL,
    TURNSTILE_TIMEOUT_SECONDS,
    TURNSTILE_BYPASS_LOCAL,
)
from app.constants.observability_constants import (
    OBS_EVENT_TURNSTILE_VERIFY_FAILED,
    OBS_EVENT_TURNSTILE_VERIFY_SLOW,
    OBS_EVENT_TURNSTILE_VERIFY_TIMEOUT,
)
from app.utils.observability import log_event

logger = logging.getLogger(__name__)
_TURNSTILE_SLOW_THRESHOLD_MS = 750


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
    endpoint: Optional[str] = None,
    idempotency_key: Optional[str] = None,
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
    if idempotency_key:
        payload["idempotency_key"] = str(idempotency_key).strip()[:128]

    try:
        started_at = time.monotonic()
        resp = requests.post(
            TURNSTILE_VERIFY_URL,
            data=payload,
            timeout=max(1.0, float(TURNSTILE_TIMEOUT_SECONDS)),
        )
        data = resp.json() if resp.content else {}
        elapsed_ms = int((time.monotonic() - started_at) * 1000)
        if elapsed_ms >= _TURNSTILE_SLOW_THRESHOLD_MS:
            log_event(
                logger,
                OBS_EVENT_TURNSTILE_VERIFY_SLOW,
                level=logging.WARNING,
                latency_ms=elapsed_ms,
                success=bool(data.get("success")),
                endpoint=endpoint,
            )
        if not bool(data.get("success")):
            log_event(
                logger,
                OBS_EVENT_TURNSTILE_VERIFY_FAILED,
                level=logging.WARNING,
                endpoint=endpoint,
                host=host,
                request_id=getattr(g, "request_id", None),
                token_present=bool(str(token or "").strip()),
                error_codes=data.get("error-codes") or [],
                action=data.get("action"),
                cdata=data.get("cdata"),
                challenge_ts=data.get("challenge_ts"),
                hostname=data.get("hostname"),
            )
        return bool(data.get("success")), data
    except requests.exceptions.Timeout:
        log_event(
            logger,
            OBS_EVENT_TURNSTILE_VERIFY_TIMEOUT,
            level=logging.WARNING,
            endpoint=endpoint,
            host=host,
            request_id=getattr(g, "request_id", None),
        )
        return False, {"success": False, "error-codes": ["verification-request-timeout"]}
    except Exception as exc:
        log_event(
            logger,
            OBS_EVENT_TURNSTILE_VERIFY_FAILED,
            level=logging.WARNING,
            endpoint=endpoint,
            host=host,
            request_id=getattr(g, "request_id", None),
            token_present=bool(str(token or "").strip()),
            error_codes=["verification-request-failed"],
            error=str(exc),
        )
        return False, {"success": False, "error-codes": ["verification-request-failed"]}
