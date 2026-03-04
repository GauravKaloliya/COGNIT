"""
C.O.G.N.I.T. Backend - Main Application Entry Point
Flask application factory and route registration.
"""

# Initialize logging first, before any other imports
from app.logging_config import configure_logging
configure_logging()

import logging
import uuid
from datetime import datetime, timezone
import time

from flask import jsonify, render_template, request, g
from sqlalchemy import text

from app.extensions import app, limiter
from app.database import engine, get_db
from app.utils.decorators import track_performance
from app.utils.helpers import create_error_response, success_response
from app.routes import participant_bp, image_bp, submission_bp, payment_bp
from app.config import (
    DOCS_BASE_URL,
    ROOT_RATE_LIMIT,
    DOCS_RATE_LIMIT,
    PARTICIPANT_CREATE_RATE_LIMIT,
    PARTICIPANT_CHECK_RATE_LIMIT,
    CONSENT_RATE_LIMIT,
    PARTICIPANT_PAYMENT_STATUS_RATE_LIMIT,
    SUBMIT_RATE_LIMIT,
    ENGAGEMENT_TRACK_RATE_LIMIT,
    ENGAGEMENT_BULK_RATE_LIMIT,
    PAYMENT_CREATE_RATE_LIMIT,
    PAYMENT_STATUS_RATE_LIMIT,
    PAYMENT_VERIFY_UPLOAD_RATE_LIMIT,
    FLASK_DEBUG,
    FLASK_HOST,
    FLASK_PORT,
    SECURITY_HSTS_ENABLED,
    SECURITY_HSTS_MAX_AGE,
    SECURITY_HSTS_INCLUDE_SUBDOMAINS,
    SECURITY_HSTS_PRELOAD,
    SECURITY_FRAME_OPTIONS,
    SECURITY_REFERRER_POLICY,
    SECURITY_PERMISSIONS_POLICY,
    SECURITY_CONTENT_TYPE_OPTIONS,
    SECURITY_XSS_PROTECTION,
    HEALTH_CACHE_TTL_SECONDS,
)

# Get logger for this module
logger = logging.getLogger(__name__)

from middleware.device_fingerprint import device_fingerprint_middleware


# ────────────────────────────────────────────────
# Register Blueprints
# ────────────────────────────────────────────────

app.register_blueprint(participant_bp)
app.register_blueprint(image_bp)
app.register_blueprint(submission_bp)
app.register_blueprint(payment_bp)


# ────────────────────────────────────────────────
# Request/Response Logging
# ────────────────────────────────────────────────

@app.before_request
def log_request():
    """Log incoming requests and attach security context."""
    g.request_start_time = datetime.now(timezone.utc)
    g.device_fingerprint_written = False
    g.request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())

    # Ensure DB session exists for middleware utilities that rely on g.db.
    try:
        get_db()
    except Exception as e:
        logger.warning(f"DB session init failed in before_request: {e}")

    # Attach fingerprint/risk context globally (best effort, non-blocking).
    try:
        device_fingerprint_middleware()
    except Exception as e:
        logger.warning(f"Device fingerprint middleware failed: {e}")

    logger.info(f"REQUEST {request.method} {request.path} request_id={g.request_id}")

@app.after_request
def log_response(response):
    """Log outgoing responses for debugging."""
    request_id = getattr(g, "request_id", None)
    if request_id:
        response.headers["X-Request-ID"] = request_id

    if getattr(g, "device_fingerprint_written", False) and request.method in {"GET", "HEAD"}:
        try:
            db = getattr(g, "db", None)
            if db is not None and response.status_code < 400:
                db.commit()
        except Exception as e:
            logger.warning(f"Device fingerprint commit failed: {e}")
            try:
                if db is not None:
                    db.rollback()
            except Exception:
                pass

    # Normalize successful JSON responses to strict envelope:
    # { "success": true, "data": ... }
    try:
        if response.is_json and 200 <= int(response.status_code) < 400:
            payload = response.get_json(silent=True)
            if isinstance(payload, dict) and "success" not in payload:
                wrapped = jsonify({"success": True, "data": payload})
                wrapped.status_code = response.status_code
                response = wrapped
    except Exception:
        # Never block response on envelope normalization failure.
        pass

    if hasattr(g, 'request_start_time'):
        duration_ms = int((datetime.now(timezone.utc) - g.request_start_time).total_seconds() * 1000)
        logger.info(
            f"RESPONSE {request.method} {request.path} - {response.status_code} - {duration_ms}ms request_id={request_id}"
        )

    # Security headers (production-safe defaults; env overridable).
    try:
        if SECURITY_CONTENT_TYPE_OPTIONS:
            response.headers.setdefault("X-Content-Type-Options", SECURITY_CONTENT_TYPE_OPTIONS)
        if SECURITY_FRAME_OPTIONS:
            response.headers.setdefault("X-Frame-Options", SECURITY_FRAME_OPTIONS)
        if SECURITY_REFERRER_POLICY:
            response.headers.setdefault("Referrer-Policy", SECURITY_REFERRER_POLICY)
        if SECURITY_PERMISSIONS_POLICY:
            response.headers.setdefault("Permissions-Policy", SECURITY_PERMISSIONS_POLICY)
        if SECURITY_XSS_PROTECTION:
            response.headers.setdefault("X-XSS-Protection", SECURITY_XSS_PROTECTION)
        if SECURITY_HSTS_ENABLED and request.is_secure:
            hsts_value = f"max-age={SECURITY_HSTS_MAX_AGE}"
            if SECURITY_HSTS_INCLUDE_SUBDOMAINS:
                hsts_value += "; includeSubDomains"
            if SECURITY_HSTS_PRELOAD:
                hsts_value += "; preload"
            response.headers.setdefault("Strict-Transport-Security", hsts_value)
    except Exception:
        pass
    return response


@app.errorhandler(413)
def handle_request_too_large(_error):
    """Return JSON response for oversized uploads."""
    max_bytes = int(app.config.get("MAX_CONTENT_LENGTH", 5 * 1024 * 1024))
    max_mb = max(1, round(max_bytes / (1024 * 1024)))
    return create_error_response(
        "VAL_FILE_TOO_LARGE",
        details={"max_mb": max_mb, "reason": "payload_too_large"},
        custom_message=f"The file is too large. Please upload an image smaller than {max_mb}MB."
    )


@app.errorhandler(404)
def handle_not_found(_error):
    return create_error_response("NF_ROUTE_NOT_FOUND", details={"path": request.path, "reason": "route_not_found"})


@app.errorhandler(405)
def handle_method_not_allowed(_error):
    return create_error_response(
        "VAL_METHOD_NOT_ALLOWED",
        details={"path": request.path, "method": request.method, "reason": "method_not_allowed"}
    )


@app.errorhandler(429)
def handle_rate_limit(_error):
    return create_error_response("RATE_LIMIT_EXCEEDED")


@app.errorhandler(Exception)
def handle_unexpected_error(error):
    logger.exception("Unhandled exception request_id=%s path=%s", getattr(g, "request_id", None), request.path)
    return create_error_response("SYS_INTERNAL_ERROR")


# ────────────────────────────────────────────────
# Health Check Route
# ────────────────────────────────────────────────

@app.route("/health")
@limiter.exempt
@track_performance
def health():
    """Server and database health check endpoint."""
    logger.info("Health check initiated")
    now_ts = time.time()
    cache = getattr(app, "_health_cache", None)
    if cache and (now_ts - cache.get("checked_at", 0.0)) <= max(0.5, HEALTH_CACHE_TTL_SECONDS):
        cached_ok = bool(cache.get("ok"))
        if cached_ok:
            return success_response(cache.get("data", {"status": "healthy", "database": "connected"}))
        return create_error_response(
            "SYS_INTERNAL_ERROR",
            details=cache.get("details", {}),
            custom_message=cache.get("message", "Service degraded")
        )

    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        logger.info("Health check passed")
        data = {"status": "healthy", "database": "connected"}
        app._health_cache = {
            "checked_at": now_ts,
            "ok": True,
            "data": data,
        }
        return success_response(data)
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        app._health_cache = {
            "checked_at": now_ts,
            "ok": False,
            "message": "Service degraded",
            "details": {"status": "degraded", "error": str(e)},
        }
        return create_error_response(
            "SYS_INTERNAL_ERROR",
            details={"status": "degraded", "error": str(e)},
            custom_message="Service degraded"
        )


# ────────────────────────────────────────────────
# API Documentation Routes
# ────────────────────────────────────────────────

@app.route("/")
@limiter.limit(ROOT_RATE_LIMIT)
@track_performance
def root():
    """Root endpoint with API documentation page."""
    base_url = DOCS_BASE_URL
    return render_template("api_docs.html", base_url=base_url)


def _build_public_docs(base_url: str) -> dict:
    """Build API docs for public, end-user-facing routes only."""
    return {
        "title": "C.O.G.N.I.T. API",
        "description": "Public API for participant registration, payment verification, image fetch, and submissions.",
        "version": "1.0.0",
        "base_url": base_url,
        "authentication": "None (public_id based participant identification)",
        "endpoints": [
            {
                "path": "/health",
                "method": "GET",
                "description": "Service and database health status.",
                "rate_limit": "exempt"
            },
            {
                "path": "/participants",
                "method": "POST",
                "description": "Register a participant. `public_id` and `session_id` are auto-generated if omitted.",
                "body_example": {
                    "username": "user123",
                    "email": "user@gmail.com",
                    "phone": "9876543210",
                    "gender_code": "male",
                    "age": 25,
                    "location": "ahmedabad",
                    "language_code": "en",
                    "prior_experience": "some experience"
                },                
                "rate_limit": PARTICIPANT_CREATE_RATE_LIMIT
            },
            {
                "path": "/check-username",
                "method": "GET",
                "description": "Check username availability.",
                "query_params": {"username": "string (required)"},
                "rate_limit": PARTICIPANT_CHECK_RATE_LIMIT
            },
            {
                "path": "/check-email",
                "method": "GET",
                "description": "Check email availability.",
                "query_params": {"email": "string (required)"},
                "rate_limit": PARTICIPANT_CHECK_RATE_LIMIT
            },
            {
                "path": "/check-phone",
                "method": "GET",
                "description": "Check phone availability.",
                "query_params": {"phone": "string (required)"},
                "rate_limit": PARTICIPANT_CHECK_RATE_LIMIT
            },
            {
                "path": "/consent",
                "method": "POST",
                "description": "Record participant consent.",
                "body_example": {"public_id": "550e8400-e29b-41d4-a716-446655440000"},
                "headers": {"X-Idempotency-Key": "uuid (recommended)"},
                "rate_limit": CONSENT_RATE_LIMIT
            },
            {
                "path": "/participants/{public_id}/payment-status",
                "method": "GET",
                "description": "Get participant payment verification status.",
                "rate_limit": PARTICIPANT_PAYMENT_STATUS_RATE_LIMIT
            },
            {
                "path": "/images/random",
                "method": "GET",
                "description": "Get a random image. Supports deterministic attention-check placement using participant public_id.",
                "query_params": {
                    "exclude": "comma-separated image_ids (optional)",
                    "public_id": "participant public UUID (optional, recommended for scheduled attention checks)"
                },
                "rate_limit": "default"
            },
            {
                "path": "/submit",
                "method": "POST",
                "description": "Submit image description or survey response.",
                "headers": {"X-Idempotency-Key": "uuid (recommended)"},
                "rate_limit": SUBMIT_RATE_LIMIT
            },
            {
                "path": "/engagement/track",
                "method": "POST",
                "description": "Track participant engagement events.",
                "rate_limit": ENGAGEMENT_TRACK_RATE_LIMIT
            },
            {
                "path": "/engagement/track/bulk",
                "method": "POST",
                "description": "Track participant engagement events in a bulk request.",
                "rate_limit": ENGAGEMENT_BULK_RATE_LIMIT
            },
            {
                "path": "/payments/create",
                "method": "POST",
                "description": "Create payment session and return UPI details + QR.",
                "headers": {"X-Idempotency-Key": "uuid (recommended)"},
                "rate_limit": PAYMENT_CREATE_RATE_LIMIT
            },
            {
                "path": "/payments/{payment_id}/status",
                "method": "GET",
                "description": "Get payment status and remaining time.",
                "rate_limit": PAYMENT_STATUS_RATE_LIMIT
            },
            {
                "path": "/payments/{payment_id}/verify-upload",
                "method": "POST",
                "description": "Verify uploaded payment screenshot.",
                "headers": {"X-Idempotency-Key": "uuid (recommended)"},
                "rate_limit": PAYMENT_VERIFY_UPLOAD_RATE_LIMIT
            }
        ],
    }


@app.route("/docs")
@limiter.limit(DOCS_RATE_LIMIT)
@track_performance
def api_docs():
    """JSON API documentation endpoint."""
    base_url = DOCS_BASE_URL
    return success_response(_build_public_docs(base_url))


# ────────────────────────────────────────────────
# Development Server Entry Point
# ────────────────────────────────────────────────

if __name__ == "__main__":
    app.run(debug=FLASK_DEBUG, host=FLASK_HOST, port=FLASK_PORT)
