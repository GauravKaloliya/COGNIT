"""
Decorators module for C.O.G.N.I.T. backend.
Provides error logging and performance tracking decorators.
"""

import functools
import hashlib
import logging
import random
import time
from concurrent.futures import ThreadPoolExecutor

from flask import request
from sqlalchemy import text

from app.config import (
    API_LATENCY_SLO_MS,
    PERFORMANCE_LOG_SAMPLE_RATE,
    ENABLE_PERFORMANCE_METRICS,
    ASYNC_EXECUTOR_WORKERS_METRICS,
    METRICS_INSERT_STATEMENT_TIMEOUT_MS,
    METRICS_ASYNC_MAX_ATTEMPTS,
    METRICS_ASYNC_BASE_BACKOFF_MS,
)
from app.constants.observability_constants import OBS_EVENT_METRICS_EMIT_FAILED, OBS_EVENT_METRICS_ENQUEUE_FAILED
from app.database import engine
from app.utils.helpers import create_error_response
from app.utils.observability import log_event

_METRICS_EXECUTOR = ThreadPoolExecutor(
    max_workers=ASYNC_EXECUTOR_WORKERS_METRICS,
    thread_name_prefix="perf-metrics",
)
logger = logging.getLogger(__name__)


def _persist_performance_metric(
    endpoint: str,
    response_time_ms: int,
    status_code: int,
    request_size_bytes: int,
    response_size_bytes: int,
    slo_target_ms: int,
    slo_breached: bool,
) -> None:
    """Write performance metric in its own transaction."""
    with engine.begin() as conn:
        # Non-critical write: enforce a tight statement timeout so metrics never
        # become a latency amplifier under DB pressure.
        conn.execute(text("SET LOCAL statement_timeout = :timeout_ms"), {"timeout_ms": int(METRICS_INSERT_STATEMENT_TIMEOUT_MS)})
        conn.execute(text("""
            INSERT INTO performance_metrics (
                endpoint, response_time_ms, status_code,
                request_size_bytes, response_size_bytes,
                slo_target_ms, slo_breached
            ) VALUES (:ep, :ms, :st, :req, :resp, :slo_target, :slo_breached)
        """), {
            "ep": endpoint,
            "ms": response_time_ms,
            "st": status_code,
            "req": request_size_bytes,
            "resp": max(0, int(response_size_bytes or 0)),
            "slo_target": max(1, int(slo_target_ms)),
            "slo_breached": bool(slo_breached),
        })


def _enqueue_performance_metric(**kwargs) -> None:
    idempotency_key = hashlib.sha256(
        f"{kwargs.get('endpoint')}|{kwargs.get('response_time_ms')}|{kwargs.get('status_code')}|{kwargs.get('request_size_bytes')}|{kwargs.get('response_size_bytes')}".encode(
            "utf-8"
        )
    ).hexdigest()[:32]

    def _run_with_retry():
        attempts = max(1, int(METRICS_ASYNC_MAX_ATTEMPTS))
        for attempt in range(1, attempts + 1):
            try:
                _persist_performance_metric(**kwargs)
                return
            except Exception as exc:
                if attempt >= attempts:
                    log_event(
                        logger,
                        OBS_EVENT_METRICS_ENQUEUE_FAILED,
                        level=logging.WARNING,
                        error=str(exc),
                        idempotency_key=idempotency_key,
                        attempt=attempt,
                    )
                    return
                delay_ms = int(METRICS_ASYNC_BASE_BACKOFF_MS) * (2 ** max(0, attempt - 1))
                time.sleep(max(0.05, min(60000, delay_ms) / 1000.0))

    try:
        _METRICS_EXECUTOR.submit(_run_with_retry)
    except Exception as exc:
        log_event(
            logger,
            OBS_EVENT_METRICS_ENQUEUE_FAILED,
            level=logging.WARNING,
            error=str(exc),
            idempotency_key=idempotency_key,
        )


# ────────────────────────────────────────────────
# Performance Tracking Decorator
# ────────────────────────────────────────────────

def track_performance(f):
    """Decorator to track endpoint performance and log to database."""
    @functools.wraps(f)
    def wrapper(*args, **kwargs):
        start = time.perf_counter()
        try:
            resp = f(*args, **kwargs)
            duration_ms = int((time.perf_counter() - start) * 1000)
            slo_breached = duration_ms > API_LATENCY_SLO_MS
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

            if random.random() < PERFORMANCE_LOG_SAMPLE_RATE:
                try:
                    if not ENABLE_PERFORMANCE_METRICS:
                        return resp
                    if request.path == "/health":
                        return resp
                    _enqueue_performance_metric(
                        endpoint=request.path,
                        response_time_ms=duration_ms,
                        status_code=status,
                        request_size_bytes=request.content_length or 0,
                        response_size_bytes=response_size,
                        slo_target_ms=API_LATENCY_SLO_MS,
                        slo_breached=slo_breached,
                    )
                except Exception:
                    # Metrics must never break request handling.
                    log_event(logger, OBS_EVENT_METRICS_EMIT_FAILED, level=logging.WARNING)
            if slo_breached:
                log_event(
                    logger,
                    "api_slo_breach",
                    level=logging.WARNING,
                    endpoint=request.path,
                    status_code=status,
                    duration_ms=duration_ms,
                    target_ms=API_LATENCY_SLO_MS,
                )
                if hasattr(response_obj, "headers"):
                    response_obj.headers.setdefault("X-Api-Slo-Target-Ms", str(API_LATENCY_SLO_MS))
                    response_obj.headers.setdefault("X-Api-Slo-Breached", "1")
            return resp
        except Exception as exc:
            duration_ms = int((time.perf_counter() - start) * 1000)
            slo_breached = duration_ms > API_LATENCY_SLO_MS
            if (
                ENABLE_PERFORMANCE_METRICS
                and request.path != "/health"
                and random.random() < PERFORMANCE_LOG_SAMPLE_RATE
            ):
                try:
                    _enqueue_performance_metric(
                        endpoint=request.path,
                        response_time_ms=duration_ms,
                        status_code=500,
                        request_size_bytes=request.content_length or 0,
                        response_size_bytes=0,
                        slo_target_ms=API_LATENCY_SLO_MS,
                        slo_breached=slo_breached,
                    )
                except Exception:
                    log_event(logger, OBS_EVENT_METRICS_EMIT_FAILED, level=logging.WARNING)
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
