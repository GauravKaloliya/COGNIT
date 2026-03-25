"""
C.O.G.N.I.T. Backend - Main Application Entry Point
Flask application factory and route registration.
"""

import logging
import atexit

from flask import request, g

from app.extensions import app, limiter
from app.constants.event_constants import (
    HTTP_METHOD_GET,
    HTTP_METHOD_POST,
    HTTP_REASON_METHOD_NOT_ALLOWED,
    HTTP_REASON_ROUTE_NOT_FOUND,
)
from app.constants.log_messages import LOG_UNHANDLED_EXCEPTION
from app.constants.route_constants import (
    API_DOCS_ENDPOINTS_ROUTE,
    API_DOCS_ERRORS_ROUTE,
    API_DOCS_EXAMPLES_ROUTE,
    API_DOCS_ROUTE,
    CLIENT_ERROR_ROUTE,
    HEALTH_ROUTE,
    ROOT_ROUTE,
)
from app.constants.request_keys import (
    REQUEST_KEY_ERROR_CONTEXT,
    REQUEST_KEY_ERROR_MESSAGE,
    REQUEST_KEY_ERROR_META,
    REQUEST_KEY_ERROR_ROUTE,
    REQUEST_KEY_ERROR_STACK,
    REQUEST_KEY_ERROR_TAG,
)
from app.constants.observability_constants import OBS_EVENT_CLIENT_ERROR
from app.utils.decorators import track_performance
from app.utils.helpers import create_error_response, success_response
from app.utils.app_runtime import (
    finalize_response,
    get_health_response,
    initialize_request_context,
    redirect_to_api_docs_endpoints,
    render_api_docs_page,
)
from app.routes import participant_bp, image_bp, submission_bp
from app.utils.observability import log_event_async
from app.utils.durable_event_queue import enqueue_durable_event, start_durable_event_worker, stop_durable_event_worker
from app.config import (
    ROOT_RATE_LIMIT,
    DOCS_RATE_LIMIT,
    HEALTH_RATE_LIMIT,
    FLASK_DEBUG,
    PORT,
)
from app.logging_config import configure_logging

# Initialize logging after imports are available.
configure_logging()

# Get logger for this module
logger = logging.getLogger(__name__)
start_durable_event_worker()
atexit.register(stop_durable_event_worker)
# ────────────────────────────────────────────────
# Register Blueprints
# ────────────────────────────────────────────────

app.register_blueprint(participant_bp)
app.register_blueprint(image_bp)
app.register_blueprint(submission_bp)


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


@app.errorhandler(404)
def handle_not_found(_error):
    return create_error_response("NF_ROUTE_NOT_FOUND", details={"path": request.path, "reason": HTTP_REASON_ROUTE_NOT_FOUND})


@app.errorhandler(405)
def handle_method_not_allowed(_error):
    return create_error_response(
        "VAL_METHOD_NOT_ALLOWED",
        details={"path": request.path, "method": request.method, "reason": HTTP_REASON_METHOD_NOT_ALLOWED}
    )


@app.errorhandler(429)
def handle_rate_limit(_error):
    return create_error_response("RATE_LIMIT_EXCEEDED")


@app.errorhandler(Exception)
def handle_unexpected_error(_error):
    logger.exception(LOG_UNHANDLED_EXCEPTION, getattr(g, "request_id", None), request.path)
    return create_error_response("SYS_INTERNAL_ERROR")


@app.after_request
def add_rate_limit_headers(response):
    try:
        limit = getattr(g, "view_rate_limit", None)
        if limit is not None:
            response.headers.setdefault("X-RateLimit-Limit", str(limit.limit))
            response.headers.setdefault("X-RateLimit-Remaining", str(limit.remaining))
            response.headers.setdefault("X-RateLimit-Reset", str(limit.reset_at))
    except Exception:
        pass
    return response


# ────────────────────────────────────────────────
# Health Check Route
# ────────────────────────────────────────────────

@app.route(HEALTH_ROUTE, methods=[HTTP_METHOD_GET])
@limiter.limit(HEALTH_RATE_LIMIT)
@track_performance
def health():
    """Server and database health check endpoint."""
    return get_health_response(logger)


# ────────────────────────────────────────────────
# API Documentation Routes
# ────────────────────────────────────────────────

@app.route(ROOT_ROUTE, methods=[HTTP_METHOD_GET])
@limiter.limit(ROOT_RATE_LIMIT)
@track_performance
def root():
    """Root endpoint redirects to API docs."""
    return redirect_to_api_docs_endpoints()


@app.route(API_DOCS_ROUTE, methods=[HTTP_METHOD_GET])
@limiter.limit(DOCS_RATE_LIMIT)
@track_performance
def api_docs_ui():
    return redirect_to_api_docs_endpoints()


@app.route(API_DOCS_ENDPOINTS_ROUTE, methods=[HTTP_METHOD_GET])
@limiter.limit(DOCS_RATE_LIMIT)
@track_performance
def api_docs_endpoints():
    return render_api_docs_page("api_docs/endpoints.html", "endpoints")


@app.route(API_DOCS_ERRORS_ROUTE, methods=[HTTP_METHOD_GET])
@limiter.limit(DOCS_RATE_LIMIT)
@track_performance
def api_docs_errors():
    return render_api_docs_page("api_docs/errors.html", "errors")


@app.route(API_DOCS_EXAMPLES_ROUTE, methods=[HTTP_METHOD_GET])
@limiter.limit(DOCS_RATE_LIMIT)
@track_performance
def api_docs_examples():
    return render_api_docs_page("api_docs/examples.html", "examples")


@app.route(CLIENT_ERROR_ROUTE, methods=[HTTP_METHOD_POST])
@limiter.limit(ROOT_RATE_LIMIT)
def client_error():
    payload = request.json or {}
    enqueue_durable_event(OBS_EVENT_CLIENT_ERROR, {
        "message": payload.get(REQUEST_KEY_ERROR_MESSAGE),
        "stack": payload.get(REQUEST_KEY_ERROR_STACK),
        "context": payload.get(REQUEST_KEY_ERROR_CONTEXT),
        "route": payload.get(REQUEST_KEY_ERROR_ROUTE),
        "tag": payload.get(REQUEST_KEY_ERROR_TAG),
        "meta": payload.get(REQUEST_KEY_ERROR_META),
        "request_id": getattr(g, "request_id", None),
        "level": "error",
    }, idempotency_key=f"client-error:{getattr(g, 'request_id', '')}:{payload.get(REQUEST_KEY_ERROR_TAG) or ''}")
    log_event_async(logger, "client_error_queued", level=logging.INFO, request_id=getattr(g, "request_id", None))
    return success_response({"received": True})


# ────────────────────────────────────────────────
# Development Server Entry Point
# ────────────────────────────────────────────────

if __name__ == "__main__":
    app.run(debug=FLASK_DEBUG, port=PORT)
