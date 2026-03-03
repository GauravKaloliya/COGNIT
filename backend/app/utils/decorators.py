"""
Decorators module for C.O.G.N.I.T. backend.
Provides error logging and performance tracking decorators.
"""

import functools
import random
import time

from flask import request
from sqlalchemy import text

from app.config import PERFORMANCE_LOG_SAMPLE_RATE
from app.database import get_db


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

            if random.random() < PERFORMANCE_LOG_SAMPLE_RATE:
                db = get_db()
                db.execute(text("""
                    INSERT INTO performance_metrics (
                        endpoint, response_time_ms, status_code,
                        request_size_bytes, response_size_bytes
                    ) VALUES (:ep, :ms, :st, :req, 0)
                """), {
                    "ep": request.path, "ms": duration_ms, "st": status,
                    "req": request.content_length or 0
                })
            return resp
        except Exception as exc:
            duration_ms = int((time.perf_counter() - start) * 1000)
            if random.random() < PERFORMANCE_LOG_SAMPLE_RATE:
                db = get_db()
                db.execute(text("""
                    INSERT INTO performance_metrics (
                        endpoint, response_time_ms, status_code,
                        request_size_bytes, response_size_bytes
                    ) VALUES (:ep, :ms, 500, :req, 0)
                """), {"ep": request.path, "ms": duration_ms, "req": request.content_length or 0})
            raise exc
    return wrapper

