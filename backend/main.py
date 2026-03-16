"""
C.O.G.N.I.T. Backend - Main Application Entry Point
Flask application factory and route registration.
"""

# Initialize logging first, before any other imports
from app.logging_config import configure_logging
configure_logging()

import logging

from flask import request

from app.extensions import app, limiter
from app.utils.decorators import track_performance
from app.utils.helpers import create_error_response
from app.utils.app_runtime import (
    finalize_response,
    get_cached_health_response,
    handle_payload_too_large,
    initialize_request_context,
    redirect_to_api_docs_endpoints,
    render_api_docs_page,
)
from app.routes import participant_bp, image_bp, submission_bp, payment_bp
from app.config import (
    ROOT_RATE_LIMIT,
    DOCS_RATE_LIMIT,
    HEALTH_RATE_LIMIT,
    FLASK_DEBUG,
    FLASK_HOST,
    FLASK_PORT,
)

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
    """Log incoming requests and attach security context."""
    initialize_request_context(logger)

@app.after_request
def log_response(response):
    """Log outgoing responses for debugging."""
    return finalize_response(response, logger)


@app.errorhandler(413)
def handle_request_too_large(_error):
    """Return JSON response for oversized uploads."""
    return handle_payload_too_large(app)


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
@limiter.limit(HEALTH_RATE_LIMIT)
@track_performance
def health():
    """Server and database health check endpoint."""
    logger.info("Health check initiated")
    return get_cached_health_response(app, logger)


# ────────────────────────────────────────────────
# API Documentation Routes
# ────────────────────────────────────────────────

@app.route("/")
@limiter.limit(ROOT_RATE_LIMIT)
@track_performance
def root():
    """Root endpoint redirects to API docs."""
    return redirect_to_api_docs_endpoints()


@app.route("/api-docs")
@limiter.limit(DOCS_RATE_LIMIT)
@track_performance
def api_docs_ui():
    return redirect_to_api_docs_endpoints()


@app.route("/api-docs/endpoints")
@limiter.limit(DOCS_RATE_LIMIT)
@track_performance
def api_docs_endpoints():
    return render_api_docs_page("api_docs/endpoints.html", "endpoints")


@app.route("/api-docs/errors")
@limiter.limit(DOCS_RATE_LIMIT)
@track_performance
def api_docs_errors():
    return render_api_docs_page("api_docs/errors.html", "errors")


@app.route("/api-docs/examples")
@limiter.limit(DOCS_RATE_LIMIT)
@track_performance
def api_docs_examples():
    return render_api_docs_page("api_docs/examples.html", "examples")


# ────────────────────────────────────────────────
# Development Server Entry Point
# ────────────────────────────────────────────────

if __name__ == "__main__":
    app.run(debug=FLASK_DEBUG, host=FLASK_HOST, port=FLASK_PORT)
