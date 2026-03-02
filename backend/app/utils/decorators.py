"""
Decorators module for C.O.G.N.I.T. backend.
Provides error logging and performance tracking decorators.
"""

import functools
import random
import time
import traceback

from flask import current_app, g, request
from sqlalchemy import text

from app.config import PERFORMANCE_LOG_SAMPLE_RATE, ERROR_CODES
from app.database import get_db


# ────────────────────────────────────────────────
# Error Logging Decorator
# ────────────────────────────────────────────────

def log_errors(f):
    """Decorator to automatically log errors to database."""
    @functools.wraps(f)
    def wrapper(*args, **kwargs):
        try:
            return f(*args, **kwargs)
        except Exception as e:
            print(f"[ERROR] Unhandled exception in {request.path}: {e}", flush=True)
            try:
                db = get_db()
                db.execute(text("""
                    INSERT INTO error_log (
                        error_code, error_message, error_type,
                        endpoint, http_method, ip_hash, 
                        stack_trace, participant_id
                    ) VALUES (
                        :code, :message, :type,
                        :endpoint, :method, :ip,
                        :stack, :pid
                    )
                """), {
                    "code": getattr(e, 'error_code', 'SYS_001_0001'),
                    "message": str(e)[:500],
                    "type": type(e).__name__,
                    "endpoint": request.path,
                    "method": request.method,
                    "ip": _get_ip_hash_internal(),
                    "stack": traceback.format_exc()[:2000] if current_app.debug else None,
                    "pid": getattr(g, 'participant_id', None)
                })
                db.commit()
            except Exception as log_error:
                print(f"[ERROR] Failed to log error to database: {log_error}", flush=True)
            raise
    return wrapper


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


# ────────────────────────────────────────────────
# Database Error Handler
# ────────────────────────────────────────────────

def handle_db_error(exc):
    """Map database exceptions to standardized error codes."""
    from app.utils.helpers import error_response
    
    exc_str = str(exc).lower()
    if "unique" in exc_str:
        if "username" in exc_str:
            return error_response("DUP_USERNAME")
        elif "email" in exc_str:
            return error_response("DUP_EMAIL")
        elif "phone" in exc_str:
            return error_response("DUP_PHONE")
        elif "public_id" in exc_str:
            return error_response("DUP_PUBLIC_ID")
        elif "survey_index" in exc_str:
            return error_response("DUP_SURVEY_ROUND")
        elif "sha256" in exc_str or "idx_payment_files_sha256" in exc_str:
            return error_response("FRAUD_DUPLICATE_IMAGE")
    elif "check constraint" in exc_str:
        if "age" in exc_str:
            return error_response("VAL_AGE_INVALID")
        elif "email" in exc_str:
            return error_response("VAL_EMAIL_INVALID")
        elif "phone" in exc_str:
            return error_response("VAL_PHONE_INVALID")
        elif "chk_valid_email" in exc_str:
            return error_response("VAL_EMAIL_INVALID")
    elif "foreign key" in exc_str:
        return error_response("NF_PARTICIPANT")
    return error_response("SYS_DATABASE_ERROR")


# ────────────────────────────────────────────────
# Internal Helper
# ────────────────────────────────────────────────

def _get_ip_hash_internal():
    """Internal helper for IP hashing within decorators (avoids circular import)."""
    import hashlib
    from app.config import IP_HASH_SALT
    
    ip = (request.headers.get("X-Forwarded-For", request.remote_addr or "unknown")
          .split(",")[0].strip())
    if ip in ("", "unknown"):
        return "0" * 64
    try:
        import ipaddress
        return hashlib.sha256(f"{ipaddress.ip_address(ip)}{IP_HASH_SALT}".encode()).hexdigest()
    except:
        return "0" * 64