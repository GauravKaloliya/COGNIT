"""
C.O.G.N.I.T. Backend - Main Application Entry Point
Flask application factory and route registration.
"""

import json
import random
from datetime import datetime, timezone

from flask import jsonify, render_template, request
from sqlalchemy import text

from app.extensions import app, limiter
from app.database import engine, get_db
from app.utils.helpers import get_ip_hash, error_response, success_response, create_error_response
from app.utils.decorators import track_performance
from app.routes import participant_bp, image_bp, submission_bp, payment_bp


# ────────────────────────────────────────────────
# Register Blueprints
# ────────────────────────────────────────────────

app.register_blueprint(participant_bp)
app.register_blueprint(image_bp)
app.register_blueprint(submission_bp)
app.register_blueprint(payment_bp)


# ────────────────────────────────────────────────
# Health Check Route
# ────────────────────────────────────────────────

@app.route("/health")
@limiter.exempt
@track_performance
def health():
    """Server and database health check endpoint."""
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return jsonify({"status": "healthy", "database": "connected"})
    except Exception as e:
        from flask import current_app
        current_app.logger.error(f"Health check failed: {e}")
        return jsonify({"status": "degraded", "error": str(e)}), 503


# ────────────────────────────────────────────────
# Client Error Logging
# ────────────────────────────────────────────────

@app.route("/client-errors", methods=["POST"])
@limiter.limit("60 per minute")
def log_client_error():
    """Receive and log client-side errors."""
    data = request.json or {}
    
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
    except:
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
    from app.config import MIN_DESCRIPTION_LENGTH, MAX_DESCRIPTION_LENGTH, MIN_FEEDBACK_LENGTH, MAX_FEEDBACK_LENGTH, MIN_RATING, MAX_RATING, MIN_WORD_COUNT
    
    base_url = "https://api.cognit.online"

    docs = {
        "title": "C.O.G.N.I.T. API",
        "description": "Cognitive Image & Text Research Platform backend API. Collects high-quality image descriptions with attention checks and anti-abuse measures.",
        "version": "1.0.0",
        "base_url": base_url,
        "authentication": "None (public_id based participant identification)",
        "endpoints": [
            {
                "path": "/health",
                "method": "GET",
                "description": "Server and database health check",
                "auth": "None",
                "rate_limit": "exempt"
            },
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
                "path": "/participants/{public_id}",
                "method": "GET",
                "description": "Get participant profile (public fields only)",
                "rate_limit": "10/min"
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
                    "survey_index": None
                },
                "rate_limit": "60/min"
            },
            {
                "path": "/docs",
                "method": "GET",
                "description": "This documentation",
                "rate_limit": "30/min"
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
                "path": "/payments/{payment_id}/upload-url",
                "method": "POST",
                "description": "Get S3 presigned URL for payment screenshot upload",
                "rate_limit": "20/min"
            },
            {
                "path": "/payments/{payment_id}/finalize",
                "method": "POST",
                "description": "Finalize payment after screenshot upload",
                "body_example": {
                    "object_key": "payments/uuid.jpg",
                    "sha256": "sha256hash"
                },
                "rate_limit": "20/min"
            }
        ],
    }
    return jsonify(docs)


# ────────────────────────────────────────────────
# Create App Factory Function
# ────────────────────────────────────────────────

def create_app():
    """
    Application factory for Vercel serverless and testing.

    Returns:
        Flask application instance
    """
    return app


# ────────────────────────────────────────────────
# Vercel Serverless Export
# ────────────────────────────────────────────────

app = create_app()


# ────────────────────────────────────────────────
# Development Server Entry Point
# ────────────────────────────────────────────────

if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)