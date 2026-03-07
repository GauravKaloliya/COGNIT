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
from pathlib import Path

from flask import jsonify, render_template, request, g, send_from_directory
from sqlalchemy import text

from app.extensions import app, limiter
from app.database import engine, get_db
from app.utils.decorators import track_performance
from app.utils.helpers import create_error_response, success_response
from app.utils.observability import log_event
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
    API_LATENCY_SLO_MS,
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
    log_event(
        logger,
        "request_received",
        method=request.method,
        path=request.path,
        request_id=g.request_id,
        participant_id=getattr(g, "participant_id", None),
    )

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
        log_event(
            logger,
            "request_completed",
            method=request.method,
            path=request.path,
            request_id=request_id,
            status_code=int(response.status_code),
            latency_ms=duration_ms,
        )
        if duration_ms > API_LATENCY_SLO_MS:
            log_event(
                logger,
                "latency_slo_breach",
                level=logging.WARNING,
                method=request.method,
                path=request.path,
                request_id=request_id,
                latency_ms=duration_ms,
                slo_ms=API_LATENCY_SLO_MS,
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
    """Build public API docs for external client integrators."""
    return {
        "title": "C.O.G.N.I.T. Public API",
        "description": (
            "Protocol-first API for participant onboarding, payment verification, "
            "survey image delivery, and submissions."
        ),
        "version": "1.0.0",
        "base_url": base_url,
        "spec": {
            "openapi": "/shared/contracts/openapi.v1.json",
            "postman_collection": "/shared/contracts/postman_collection.v1.json",
            "error_contract": "/shared/contracts/error_contract.json",
        },
        "mobile_compatibility": {
            "supported_clients": ["Mobile web", "Android WebView", "iOS Safari/WebView", "Desktop browsers"],
            "protocol_model": "Stateless JSON over HTTPS with idempotency and retry-safe writes.",
            "recommendations": [
                "Use upload-url flow for images on mobile networks.",
                "Retry only retryable errors and preserve idempotency keys.",
                "Refresh payment status after app resume/background wake.",
            ],
        },
        "request_conventions": {
            "content_type": "application/json",
            "optional_headers": {
                "X-Request-ID": "Client request correlation ID (server generates one if omitted).",
            },
            "required_headers": {
                "X-Idempotency-Key": [
                    "POST /participants",
                    "POST /payments/create",
                    "POST /payments/{payment_public_id}/verify-upload",
                    "POST /submit",
                ],
            },
            "response_envelope": {
                "success": {"success": True, "data": {"...": "..."}, "message": "optional"},
                "error": {
                    "success": False,
                    "error": {
                        "code": "PAY_001_0004",
                        "message": "Human-readable message",
                        "category": "PAY",
                        "http_status": 400,
                        "retryable": True,
                        "request_id": "uuid",
                    },
                },
            },
            "timestamp_format": "ISO-8601 UTC",
        },
        "security_model": {
            "server_truth_only": [
                "payment expiry",
                "workflow transitions",
                "payload/schema validation",
                "idempotency consistency",
                "payment-token integrity",
                "nonce/session/fingerprint binding",
            ],
            "turnstile": {
                "required_when_enabled": [
                    "POST /participants",
                    "POST /payments/create",
                    "POST /payments/{payment_public_id}/verify-upload",
                    "POST /submit",
                ],
                "request_field": "turnstile_token",
                "note": "If TURNSTILE_ENABLED=false, token validation is skipped server-side.",
            },
            "payment_write_token": {
                "issued_by": [
                    "POST /payments/create",
                    "GET /payments/{payment_public_id}/status (pending/processing only)",
                ],
                "required_on": [
                    "POST /payments/{payment_public_id}/upload-url",
                    "POST /payments/{payment_public_id}/verify-upload",
                ],
                "transport": "Authorization: Bearer <payment_token> (or X-Payment-Token)",
                "claims_bound_to": [
                    "payment_public_id",
                    "participant_id",
                    "signature",
                    "session_id",
                    "device_fingerprint",
                    "nonce",
                    "expiry",
                ],
            },
            "replay_protection": {
                "idempotency_scope": "endpoint + idempotency key + participant + request hash",
                "nonce_model": "one-time payment write nonce rotated on status/token refresh",
            },
        },
        "flow": [
            "POST /participants",
            "GET /check-username | /check-email | /check-phone (optional UX checks)",
            "POST /consent",
            "POST /payments/create",
            "GET /payments/{payment_public_id}/status",
            "POST /payments/{payment_public_id}/upload-url (optional S3 flow)",
            "POST /payments/{payment_public_id}/verify-upload",
            "GET /participants/{public_id}/payment-status",
            "GET /images/random",
            "POST /submit",
        ],
        "rate_limits": {
            "GET /health": "exempt",
            "GET /": ROOT_RATE_LIMIT,
            "GET /docs": DOCS_RATE_LIMIT,
            "POST /participants": PARTICIPANT_CREATE_RATE_LIMIT,
            "GET /check-username": PARTICIPANT_CHECK_RATE_LIMIT,
            "GET /check-email": PARTICIPANT_CHECK_RATE_LIMIT,
            "GET /check-phone": PARTICIPANT_CHECK_RATE_LIMIT,
            "POST /consent": CONSENT_RATE_LIMIT,
            "GET /participants/{public_id}/payment-status": PARTICIPANT_PAYMENT_STATUS_RATE_LIMIT,
            "POST /payments/create": PAYMENT_CREATE_RATE_LIMIT,
            "POST /payments/{payment_public_id}/upload-url": PAYMENT_VERIFY_UPLOAD_RATE_LIMIT,
            "POST /payments/{payment_public_id}/verify-upload": PAYMENT_VERIFY_UPLOAD_RATE_LIMIT,
            "GET /payments/{payment_public_id}/status": PAYMENT_STATUS_RATE_LIMIT,
            "POST /submit": SUBMIT_RATE_LIMIT,
        },
        "endpoints": [
            {
                "method": "GET",
                "path": "/health",
                "summary": "Health check",
                "response_200": {"success": True, "data": {"status": "healthy", "database": "connected"}},
            },
            {
                "method": "POST",
                "path": "/participants",
                "summary": "Create participant",
                "required_headers": ["Content-Type: application/json", "X-Idempotency-Key"],
                "required_body": [
                    "username",
                    "email",
                    "phone",
                    "gender_code",
                    "age",
                    "location",
                    "language_code",
                    "prior_experience",
                ],
                "optional_body": ["public_id", "session_id", "turnstile_token"],
                "response_201": {
                    "success": True,
                    "data": {"status": "created", "public_id": "uuid", "session_id": "sess_xxx"},
                },
            },
            {
                "method": "GET",
                "path": "/check-username",
                "summary": "Check username availability",
                "query": {"username": "string, required"},
            },
            {
                "method": "GET",
                "path": "/check-email",
                "summary": "Check email availability",
                "query": {"email": "string, required"},
            },
            {
                "method": "GET",
                "path": "/check-phone",
                "summary": "Check phone availability",
                "query": {"phone": "string, required"},
            },
            {
                "method": "POST",
                "path": "/consent",
                "summary": "Record participant consent",
                "required_headers": ["Content-Type: application/json"],
                "optional_headers": ["X-Idempotency-Key"],
                "required_body": ["public_id"],
                "response_200": {"success": True, "data": {"status": "consent recorded"}},
            },
            {
                "method": "GET",
                "path": "/participants/{public_id}/payment-status",
                "summary": "Get participant-level payment state",
                "response_200": {
                    "success": True,
                    "data": {
                        "payment_status": "paid",
                        "is_verified": True,
                        "current_stage": "survey",
                        "payment_id": "payment-public-uuid",
                    },
                },
            },
            {
                "method": "POST",
                "path": "/payments/create",
                "summary": "Create payment session",
                "required_headers": ["Content-Type: application/json", "X-Idempotency-Key"],
                "required_body": ["public_id", "amount"],
                "optional_body": ["turnstile_token"],
                "response_200": {
                    "success": True,
                    "data": {
                        "payment_id": "payment-public-uuid",
                        "amount": 1,
                        "expires_at": "2026-03-06T12:00:00+00:00",
                        "payment_token": "jwt-or-hmac-token",
                        "upi_link": "upi://pay?...",
                        "qr_base64": "...",
                        "time_remaining_seconds": 300,
                    },
                },
            },
            {
                "method": "GET",
                "path": "/payments/{payment_public_id}/status",
                "summary": "Get payment status and token refresh",
                "response_200": {
                    "success": True,
                    "data": {
                        "payment_id": "payment-public-uuid",
                        "status": "pending|processing|success|failed|rejected_fraud|expired|refunded",
                        "time_remaining_seconds": 211,
                        "payment_token": "returned while state is pending/processing",
                    },
                },
            },
            {
                "method": "POST",
                "path": "/payments/{payment_public_id}/upload-url",
                "summary": "Issue presigned S3 upload URL (optional flow)",
                "required_headers": ["Authorization: Bearer <payment_token>"],
                "required_body": ["sha256", "file_extension"],
                "optional_body": ["mime_type", "file_size"],
                "response_200": {
                    "success": True,
                    "data": {
                        "upload_url": "https://...",
                        "upload_object_key": "payments/staging/<payment_public_id>/<uuid>.jpg",
                        "upload_content_type": "image/jpeg",
                        "expires_in_seconds": 300,
                    },
                },
            },
            {
                "method": "POST",
                "path": "/payments/{payment_public_id}/verify-upload",
                "summary": "Verify uploaded screenshot and finalize payment",
                "required_headers": [
                    "Content-Type: application/json",
                    "X-Idempotency-Key",
                    "Authorization: Bearer <payment_token>",
                ],
                "required_body": ["sha256", "file_extension"],
                "conditional_body": [
                    "upload_object_key (recommended)",
                    "image_base64 (legacy fallback path)",
                ],
                "optional_body": ["mime_type", "original_filename", "file_size", "turnstile_token"],
                "response_200": {
                    "success": True,
                    "data": {
                        "status": "verified",
                        "payment_id": "payment-public-uuid",
                        "payment_status": "success",
                        "fraud_score": 0,
                        "detected_app": "gpay",
                    },
                },
            },
            {
                "method": "GET",
                "path": "/images/random",
                "summary": "Get one random image",
                "query": {
                    "exclude": "comma-separated image IDs, optional",
                    "public_id": "participant UUID, optional but recommended",
                },
                "response_200": {
                    "success": True,
                    "data": {
                        "image_id": "21.svg",
                        "url": "https://...",
                        "is_survey": True,
                        "is_attention_check": False,
                    },
                },
            },
            {
                "method": "POST",
                "path": "/submit",
                "summary": "Submit survey response",
                "required_headers": ["Content-Type: application/json", "X-Idempotency-Key"],
                "required_body": [
                    "public_id",
                    "image_id",
                    "description",
                    "feedback",
                    "rating",
                ],
                "optional_body": [
                    "time_spent_seconds",
                    "tab_switch_count",
                    "page_close_attempts",
                    "network_disconnects",
                    "survey_time_spent_ms",
                    "survey_page_views",
                    "survey_tab_switches",
                    "survey_page_close_attempts",
                    "survey_network_disconnects",
                    "survey_max_scroll_depth_pct",
                    "survey_clicks",
                    "survey_keypresses",
                    "turnstile_token",
                ],
                "response_200": {
                    "success": True,
                    "data": {
                        "status": "submitted",
                        "word_count": 134,
                    "quality_score": 0.92,
                    "flagged_too_fast": False,
                    },
                },
                "mobile_note": "Survey-specific telemetry is persisted in submissions.survey_* columns.",
            },
        ],
        "tracking_model": {
            "survey_tracking": "Survey-page telemetry is captured per submission in submissions.survey_* columns.",
        },
        "error_handling": {
            "contract": "error.code is stable for programmatic handling",
            "discover_all_codes": "/shared/contracts/error_contract.json",
            "common_codes": [
                "VAL_MISSING_FIELDS",
                "PAR_001_0001",
                "PAY_001_0001",
                "PAY_001_0002",
                "PAY_001_0003",
                "PAY_001_0004",
                "RATE_001_0001",
                "BOT_001_0001",
            ],
        },
    }


@app.route("/docs")
@limiter.limit(DOCS_RATE_LIMIT)
@track_performance
def api_docs():
    """JSON API documentation endpoint."""
    base_url = DOCS_BASE_URL
    return success_response(_build_public_docs(base_url))


@app.route("/shared/contracts/<path:filename>")
@limiter.limit(DOCS_RATE_LIMIT)
@track_performance
def shared_contracts(filename):
    """Serve API contract files used by docs and clients."""
    allowed = {"openapi.v1.json", "postman_collection.v1.json", "error_contract.json"}
    if filename not in allowed:
        return create_error_response("NF_ROUTE_NOT_FOUND", details={"path": request.path, "reason": "contract_not_found"})

    contracts_dir = Path(__file__).resolve().parent.parent / "shared" / "contracts"
    return send_from_directory(contracts_dir, filename)


# ────────────────────────────────────────────────
# Development Server Entry Point
# ────────────────────────────────────────────────

if __name__ == "__main__":
    app.run(debug=FLASK_DEBUG, host=FLASK_HOST, port=FLASK_PORT)
