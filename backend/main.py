"""
C.O.G.N.I.T. Backend - Main Application Entry Point
Flask application factory and route registration.
"""

import random
from datetime import datetime, timezone

from flask import jsonify, render_template, request
from sqlalchemy import text

from app.extensions import app, limiter
from app.database import engine
from app.utils.helpers import error_response
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
                "path": "/health",
                "method": "GET",
                "description": "Server and database health check",
                "auth": "None",
                "rate_limit": "exempt"
            },
            {
                "path": "/participants",
                "method": "POST",
                "description": "Register new participant",
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
                "path": "/participants/{public_id}/payment-status",
                "method": "GET",
                "description": "Get participant's payment verification status",
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
                "description": "Record participant consent",
                "body_example": {"public_id": "550e8400-e29b-41d4-a716-446655440000"},
                "rate_limit": "20/min"
            },
            {
                "path": "/images/random",
                "method": "GET",
                "description": "Get random image for survey",
                "query_params": {"exclude": "comma-separated image IDs to exclude (optional)"},
                "rate_limit": "default"
            },
            {
                "path": "/submit",
                "method": "POST",
                "description": "Submit image description / survey response",
                "body_example": {
                    "public_id": "550e8400-...",
                    "image_id": "image-unique-string-123",
                    "description": "Detailed description here (min 60 words)...",
                    "rating": 7,
                    "feedback": "My comments here...",
                    "time_spent_seconds": 45.2,
                    "is_survey": False,
                    "survey_index": None
                },
                "rate_limit": "60/min"
            },
            {
                "path": "/engagement/track",
                "method": "POST",
                "description": "Track engagement events (tab switches, page close attempts, network disconnects)",
                "body_example": {
                    "public_id": "550e8400-...",
                    "event_type": "tab_switch"
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
                "description": "Verify payment screenshot via OCR and upload to S3 if verified",
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