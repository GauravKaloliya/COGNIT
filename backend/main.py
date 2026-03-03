"""
C.O.G.N.I.T. Backend - Main Application Entry Point
Flask application factory and route registration.
"""

# Initialize logging first, before any other imports
from app.logging_config import configure_logging
configure_logging()

import json
import logging
import random
from datetime import datetime, timezone

from flask import jsonify, render_template, request, g
from sqlalchemy import text

from app.extensions import app, limiter
from app.database import engine, get_db
from app.utils.helpers import get_ip_hash, error_response, success_response, create_error_response
from app.utils.decorators import track_performance
from app.routes import participant_bp, image_bp, submission_bp, payment_bp

# Get logger for this module
logger = logging.getLogger(__name__)


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
    """Log incoming requests for debugging."""
    g.request_start_time = datetime.now(timezone.utc)
    logger.info(f"REQUEST {request.method} {request.path}")

@app.after_request
def log_response(response):
    """Log outgoing responses for debugging."""
    if hasattr(g, 'request_start_time'):
        duration_ms = int((datetime.now(timezone.utc) - g.request_start_time).total_seconds() * 1000)
        logger.info(f"RESPONSE {request.method} {request.path} - {response.status_code} - {duration_ms}ms")
    return response


# ────────────────────────────────────────────────
# Health Check Route
# ────────────────────────────────────────────────

@app.route("/health")
@limiter.exempt
@track_performance
def health():
    """Server and database health check endpoint."""
    logger.info("Health check initiated")
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        logger.info("Health check passed")
        return jsonify({"status": "healthy", "database": "connected"})
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return jsonify({"status": "degraded", "error": str(e)}), 503


# ────────────────────────────────────────────────
# Client Error Logging
# ────────────────────────────────────────────────

@app.route("/client-errors", methods=["POST"])
@limiter.limit("60 per minute")
def log_client_error():
    """Receive and log client-side errors."""
    data = request.json or {}

    logger.warning(f"CLIENT_ERROR {data.get('error_code', 'UNKNOWN')} - {data.get('error_message', '')[:100]}")

    db = get_db()
    try:
        db.execute(text("""
            INSERT INTO error_log (
                error_code, error_message, error_type,
                endpoint, http_method, ip_hash,
                user_agent, request_data
            ) VALUES (
                :code, :message, 'client_error',
                :page, 'CLIENT', :ip,
                :ua, :data
            )
        """), {
            "code": data.get("error_code", "CLIENT_UNKNOWN"),
            "message": data.get("error_message", "")[:500],
            "page": data.get("page_url", "")[:255],
            "ip": get_ip_hash(),
            "ua": request.headers.get("User-Agent", "")[:512],
            "data": json.dumps(data.get("extra_data", {}))
        })
        db.commit()
        return success_response(message="Error logged")
    except Exception as e:
        logger.error(f"Failed to log client error: {e}")
        return success_response(message="Error logging failed silently")


# ────────────────────────────────────────────────
# API Documentation Routes
# ────────────────────────────────────────────────

@app.route("/")
@limiter.limit("30 per minute")
@track_performance
def root():
    """Root endpoint with API documentation page."""
    base_url = "https://api.cognit.online"
    return render_template("api_docs.html", base_url=base_url)


@app.route("/docs")
@limiter.limit("30 per minute")
@track_performance
def api_docs():
    """JSON API documentation endpoint."""
    base_url = "https://api.cognit.online"

    docs = {
        "title": "C.O.G.N.I.T. API",
        "description": "Cognitive Image & Text Research Platform backend API. Collects high-quality image descriptions with attention checks and anti-abuse measures.",
        "version": "1.0.0",
        "base_url": base_url,
        "authentication": "None (public_id based participant identification)",
        "endpoints": [
            {
                "path": "/participants",
                "method": "POST",
                "description": "Register new participant (public_id must be UUID)",
                "body_example": {
                    "public_id": "550e8400-e29b-41d4-a716-446655440000",
                    "session_id": "sess_abc123xyz",
                    "username": "user123",
                    "email": "user@gmail.com",
                    "phone": "9876543210",
                    "gender_code": "male",
                    "age": 25,
                    "location": "ahmedabad",
                    "language_code": "en",
                    "prior_experience": "some experience"
                },
                "rate_limit": "30/min"
            },
            {
                "path": "/check-username",
                "method": "GET",
                "description": "Check if username is available for registration",
                "query_params": {"username": "string (required)"},
                "rate_limit": "30/min"
            },
            {
                "path": "/check-email",
                "method": "GET",
                "description": "Check if email is already registered",
                "query_params": {"email": "string (required)"},
                "rate_limit": "30/min"
            },
            {
                "path": "/check-phone",
                "method": "GET",
                "description": "Check if phone number is already registered",
                "query_params": {"phone": "string (required)"},
                "rate_limit": "30/min"
            },
            {
                "path": "/consent",
                "method": "POST",
                "description": "Record consent (required before submissions)",
                "body_example": {"public_id": "550e8400-e29b-41d4-a716-446655440000"},
                "rate_limit": "20/min"
            },
            {
                "path": "/participants/{public_id}/payment-status",
                "method": "GET",
                "description": "Get participant's payment verification status",
                "response": {
                    "payment_status": "paid|pending",
                    "is_verified": True,
                    "current_stage": "survey",
                    "payment_id": "uuid",
                    "verified_at": "2024-01-01T12:15:00+00:00",
                    "detected_app": "gpay|phonepe|paytm|other"
                },
                "rate_limit": "30/min"
            },
            {
                "path": "/images/random",
                "method": "GET",
                "description": "Get random image (exclude=comma,separated,image_ids)",
                "query_params": {"exclude": "img1,img2 (optional)"},
                "rate_limit": "default"
            },
            {
                "path": "/submit",
                "method": "POST",
                "description": "Submit image description / survey response",
                "body_example": {
                    "public_id": "550e8400-...",
                    "image_id": "image-unique-string-123",
                    "description": "Detailed description here at least 60 words...",
                    "rating": 7,
                    "feedback": "My comments here...",
                    "time_spent_seconds": 45.2,
                    "is_survey": False,
                    "survey_index": None,
                    "tab_switch_count": 0,
                    "page_close_attempts": 0,
                    "network_disconnects": 0
                },
                "rate_limit": "60/min"
            },
            {
                "path": "/engagement/track",
                "method": "POST",
                "description": "Track engagement events (tab switches, page close attempts, network disconnects)",
                "body_example": {
                    "public_id": "550e8400-...",
                    "event_type": "tab_switch|page_close_attempt|network_disconnect"
                },
                "rate_limit": "60/min"
            },
            {
                "path": "/payments/create",
                "method": "POST",
                "description": "Create a new payment session with expiry timer",
                "body_example": {
                    "public_id": "550e8400-...",
                    "amount": 1.00
                },
                "response": {
                    "payment_id": "uuid",
                    "amount": 1.00,
                    "expires_at": "2024-01-01T12:15:00+00:00",
                    "upi_link": "upi://pay?...",
                    "qr_base64": "base64encoded..."
                },
                "rate_limit": "20/min"
            },
            {
                "path": "/payments/{payment_id}/status",
                "method": "GET",
                "description": "Get payment status and time remaining",
                "response": {
                    "payment_id": "uuid",
                    "status": "pending|processing|expired|success|failed",
                    "is_expired": False,
                    "time_remaining_seconds": 600,
                    "expires_at": "2024-01-01T12:15:00+00:00"
                },
                "rate_limit": "30/min"
            },
            {
                "path": "/payments/{payment_id}/verify-upload",
                "method": "POST",
                "description": "Verify payment screenshot and upload to S3 only if verified. Image is processed directly (not from S3).",
                "body_example": {
                    "image_base64": "base64-encoded-image-data",
                    "file_extension": "jpg",
                    "sha256": "sha256hash-of-original-file"
                },
                "response": {
                    "status": "processed",
                    "verification": {
                        "status": "success|rejected_fraud",
                        "verified": True,
                        "failure_reasons": []
                    }
                },
                "rate_limit": "20/min"
            }
        ],
    }
    return jsonify(docs)


# ────────────────────────────────────────────────
# Development Server Entry Point
# ────────────────────────────────────────────────

if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)