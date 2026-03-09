"""
Decorators module for C.O.G.N.I.T. backend.
Provides error logging and performance tracking decorators.
"""

import functools
import random
import time
from concurrent.futures import ThreadPoolExecutor

from flask import request
from sqlalchemy import text

from app.config import PERFORMANCE_LOG_SAMPLE_RATE, ENABLE_PERFORMANCE_METRICS
from app.database import engine
from app.utils.helpers import create_error_response

_METRICS_EXECUTOR = ThreadPoolExecutor(max_workers=2, thread_name_prefix="perf-metrics")


def _persist_performance_metric(
    endpoint: str,
    response_time_ms: int,
    status_code: int,
    request_size_bytes: int,
    response_size_bytes: int,
) -> None:
    """Write performance metric in its own transaction."""
    with engine.begin() as conn:
        # Non-critical write: enforce a tight statement timeout so metrics never
        # become a latency amplifier under DB pressure.
        conn.execute(text("SET LOCAL statement_timeout = 200"))
        conn.execute(text("""
            INSERT INTO performance_metrics (
                endpoint, response_time_ms, status_code,
                request_size_bytes, response_size_bytes
            ) VALUES (:ep, :ms, :st, :req, :resp)
        """), {
            "ep": endpoint,
            "ms": response_time_ms,
            "st": status_code,
            "req": request_size_bytes,
            "resp": max(0, int(response_size_bytes or 0)),
        })


def _enqueue_performance_metric(**kwargs) -> None:
    try:
        _METRICS_EXECUTOR.submit(_persist_performance_metric, **kwargs)
    except Exception:
        pass


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
                    )
                except Exception:
                    # Metrics must never break request handling.
                    pass
            return resp
        except Exception as exc:
            duration_ms = int((time.perf_counter() - start) * 1000)
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
                    )
                except Exception:
                    pass
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
                "VAL_MISSING_FIELDS",
                details={"fields": ["X-Idempotency-Key"]},
                custom_message="Missing required X-Idempotency-Key header.",
            )
        if len(key) > 128:
            return create_error_response(
                "VAL_INVALID_FORMAT",
                details={"field": "X-Idempotency-Key"},
                custom_message="X-Idempotency-Key must be <= 128 characters.",
            )
        return f(*args, **kwargs)
    return wrapper
