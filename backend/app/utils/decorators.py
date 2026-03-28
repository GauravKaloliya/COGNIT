"""
Decorators module for C.O.G.N.I.T. backend.
Provides error logging, performance tracking, and request audit logging.
"""

import functools
import hashlib
import logging
import time
from concurrent.futures import ThreadPoolExecutor

from flask import g, request
from sqlalchemy import text

from app.config import (
    API_LATENCY_SLO_MS,
    ENABLE_AUDIT_LOGGING,
    ENABLE_REQUEST_DB_OBSERVABILITY,
    ASYNC_EXECUTOR_WORKERS_OBSERVABILITY,
    OBS_ASYNC_BASE_BACKOFF_MS,
    OBS_ASYNC_MAX_ATTEMPTS,
    PARTICIPANT_PUBLIC_COOKIE_NAME,
)
from app.constants.observability_constants import (
    OBS_EVENT_REQUEST_OBSERVABILITY_EMIT_FAILED,
    OBS_EVENT_REQUEST_OBSERVABILITY_ENQUEUE_FAILED,
)
from app.database import engine
from app.utils.helpers import create_error_response, get_ip_hash
from app.utils.observability import log_event

_METRICS_EXECUTOR = ThreadPoolExecutor(
    max_workers=ASYNC_EXECUTOR_WORKERS_OBSERVABILITY,
    thread_name_prefix="request-observability",
)
logger = logging.getLogger(__name__)


def _persist_request_observability(
    event_type: str,
    endpoint: str,
    http_method: str,
    status_code: int,
    request_id: str | None,
    participant_public_id: str | None,
    user_agent: str,
    ip_hash: str,
    response_time_seconds: float,
    request_size_bytes: int,
    response_size_bytes: int,
    slo_target_seconds: float,
    slo_breached: bool,
    details: str = "",
) -> None:
    """Write request observability rows in one transaction."""
    with engine.begin() as conn:
        params = {
            "ep": str(endpoint or "")[:120],
            "secs": max(0.0, float(response_time_seconds or 0)),
            "st": int(status_code or 200),
            "req": max(0, int(request_size_bytes or 0)),
            "resp": max(0, int(response_size_bytes or 0)),
            "slo_target": max(0.001, float(slo_target_seconds or 0)),
            "slo_breached": bool(slo_breached),
            "ev": str(event_type or "request_complete")[:60],
            "participant_public_id": str(participant_public_id or "").strip() or None,
            "meth": str(http_method or "")[:10],
            "iph": str(ip_hash or ("0" * 64))[:64],
            "ua": str(user_agent or "")[:512],
            "det": str(details or "")[:8000],
            "rid": request_id,
        }
        if ENABLE_AUDIT_LOGGING:
            conn.execute(
                text(
                    """
                    INSERT INTO audit_log (
                        event_type, participant_id, endpoint, http_method, status_code,
                        ip_hash, user_agent, details, request_id
                    ) VALUES (
                        :ev,
                        (
                            SELECT id
                            FROM participants
                            WHERE public_id::text = :participant_public_id
                              AND is_deleted = false
                            LIMIT 1
                        ),
                        :ep, :meth, :st, :iph, :ua, :det, :rid
                    )
                    """
                ),
                params,
            )


def _enqueue_request_observability(
    *,
    endpoint: str,
    http_method: str,
    status_code: int,
    request_id: str | None,
    participant_public_id: str | None,
    request_size_bytes: int,
    response_size_bytes: int,
    response_time_seconds: float,
    slo_breached: bool,
    user_agent: str,
    ip_hash: str,
    audit_event_type: str,
    audit_details: str,
) -> None:
    if not ENABLE_REQUEST_DB_OBSERVABILITY:
        return
    if not ENABLE_AUDIT_LOGGING:
        return

    payload = {
        "event_type": audit_event_type,
        "endpoint": endpoint,
        "http_method": http_method,
        "status_code": status_code,
        "request_id": request_id,
        "participant_public_id": participant_public_id,
        "user_agent": user_agent,
        "ip_hash": ip_hash,
        "response_time_seconds": response_time_seconds,
        "request_size_bytes": request_size_bytes,
        "response_size_bytes": response_size_bytes,
        "slo_target_seconds": API_LATENCY_SLO_MS / 1000.0,
        "slo_breached": slo_breached,
        "details": audit_details,
    }
    idempotency_key = hashlib.sha256(
        f"{endpoint}|{audit_event_type}|{status_code}|{request_id}|{response_time_seconds}|{request_size_bytes}|{response_size_bytes}".encode(
            "utf-8"
        )
    ).hexdigest()[:32]

    def _run_with_retry():
        attempts = max(1, int(OBS_ASYNC_MAX_ATTEMPTS))
        for attempt in range(1, attempts + 1):
            try:
                _persist_request_observability(**payload)
                return
            except Exception as exc:
                if attempt >= attempts:
                    log_event(
                        logger,
                        OBS_EVENT_REQUEST_OBSERVABILITY_ENQUEUE_FAILED,
                        level=logging.WARNING,
                        error=str(exc),
                        endpoint=endpoint,
                        event_type=audit_event_type,
                        idempotency_key=idempotency_key,
                        attempt=attempt,
                    )
                    return
                delay_ms = int(OBS_ASYNC_BASE_BACKOFF_MS) * (2 ** max(0, attempt - 1))
                time.sleep(max(0.05, min(60000, delay_ms) / 1000.0))

    try:
        _METRICS_EXECUTOR.submit(_run_with_retry)
    except Exception as exc:
        log_event(
            logger,
            OBS_EVENT_REQUEST_OBSERVABILITY_ENQUEUE_FAILED,
            level=logging.WARNING,
            error=str(exc),
            endpoint=endpoint,
            event_type=audit_event_type,
            idempotency_key=idempotency_key,
        )


def _extract_participant_public_id() -> str | None:
    candidate = (request.args.get("public_id") or "").strip()
    if candidate:
        return candidate
    payload = request.get_json(silent=True)
    if isinstance(payload, dict):
        candidate = str(payload.get("public_id") or "").strip()
        if candidate:
            return candidate
    cookie_value = str(request.cookies.get(PARTICIPANT_PUBLIC_COOKIE_NAME) or "").strip()
    return cookie_value or None


# ────────────────────────────────────────────────
# Performance Tracking Decorator
# ────────────────────────────────────────────────

def track_performance(f):
    """Decorator to track endpoint performance and log to database."""

    @functools.wraps(f)
    def wrapper(*args, **kwargs):
        start = time.perf_counter()
        request_path = request.path
        request_method = request.method
        request_id = getattr(g, "request_id", None) or request.headers.get("X-Request-ID")
        participant_public_id = _extract_participant_public_id()
        request_size = request.content_length or 0
        user_agent = (request.headers.get("User-Agent") or "unknown")[:512]
        ip_hash = get_ip_hash()

        try:
            resp = f(*args, **kwargs)
            elapsed_seconds = max(0.0, time.perf_counter() - start)
            response_time_seconds = round(elapsed_seconds, 6)
            duration_ms = elapsed_seconds * 1000.0
            slo_breached = duration_ms > float(API_LATENCY_SLO_MS)
            status = 200
            if isinstance(resp, tuple) and len(resp) > 1 and isinstance(resp[1], int):
                status = resp[1]
            elif hasattr(resp, "status_code"):
                status = int(resp.status_code)

            response_size = 0
            response_obj = resp[0] if isinstance(resp, tuple) and resp else resp
            if hasattr(response_obj, "calculate_content_length"):
                content_length = response_obj.calculate_content_length()
                if content_length is not None:
                    response_size = int(content_length)
            elif isinstance(response_obj, (bytes, bytearray)):
                response_size = len(response_obj)
            elif isinstance(response_obj, str):
                response_size = len(response_obj.encode("utf-8"))

            try:
                if request_path != "/health":
                    _enqueue_request_observability(
                        endpoint=request_path,
                        http_method=request_method,
                        status_code=status,
                        request_id=request_id,
                        participant_public_id=participant_public_id,
                        request_size_bytes=request_size,
                        response_size_bytes=response_size,
                        response_time_seconds=response_time_seconds,
                        slo_breached=slo_breached,
                        user_agent=user_agent,
                        ip_hash=ip_hash,
                        audit_event_type="request_complete",
                        audit_details=f"duration_seconds={response_time_seconds:.6f}",
                    )
            except Exception:
                log_event(logger, OBS_EVENT_REQUEST_OBSERVABILITY_EMIT_FAILED, level=logging.WARNING)

            if slo_breached:
                log_event(
                    logger,
                    "api_slo_breach",
                    level=logging.WARNING,
                    endpoint=request_path,
                    status_code=status,
                    duration_ms=round(duration_ms, 3),
                    target_ms=API_LATENCY_SLO_MS,
                )
                if hasattr(response_obj, "headers"):
                    response_obj.headers.setdefault("X-Api-Slo-Target-Ms", str(API_LATENCY_SLO_MS))
                    response_obj.headers.setdefault("X-Api-Slo-Breached", "1")
            return resp
        except Exception as exc:
            elapsed_seconds = max(0.0, time.perf_counter() - start)
            response_time_seconds = round(elapsed_seconds, 6)
            duration_ms = elapsed_seconds * 1000.0
            slo_breached = duration_ms > float(API_LATENCY_SLO_MS)
            if request_path != "/health":
                try:
                    _enqueue_request_observability(
                        endpoint=request_path,
                        http_method=request_method,
                        status_code=500,
                        request_id=request_id,
                        participant_public_id=participant_public_id,
                        request_size_bytes=request_size,
                        response_size_bytes=0,
                        response_time_seconds=response_time_seconds,
                        slo_breached=slo_breached,
                        user_agent=user_agent,
                        ip_hash=ip_hash,
                        audit_event_type="request_failed",
                        audit_details=f"duration_seconds={response_time_seconds:.6f}; error={type(exc).__name__}",
                    )
                except Exception:
                    log_event(logger, OBS_EVENT_REQUEST_OBSERVABILITY_EMIT_FAILED, level=logging.WARNING)
            raise exc

    return wrapper


def require_idempotency_key(f):
    """
    Require X-Idempotency-Key for mutating API routes to prevent replay/duplicate writes.
    """

    @functools.wraps(f)
    def wrapper(*args, **kwargs):
        key = (request.headers.get("X-Idempotency-Key") or "").strip()
        if not key:
            return create_error_response(
                "VAL_IDEMPOTENCY_KEY_REQUIRED",
                details={"fields": ["X-Idempotency-Key"]},
            )
        if len(key) > 128:
            return create_error_response(
                "VAL_IDEMPOTENCY_KEY_TOO_LONG",
                details={"field": "X-Idempotency-Key"},
            )
        return f(*args, **kwargs)

    return wrapper
