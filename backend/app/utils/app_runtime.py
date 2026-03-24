"""App-level request/response/runtime helpers for main.py."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from flask import Response, g, jsonify, redirect, render_template, request, url_for
from sqlalchemy import text

from app.config import (
    API_LATENCY_SLO_MS,
    DOCS_BASE_URL,
    ENABLE_DEVICE_FINGERPRINTING,
    SECURITY_CONTENT_TYPE_OPTIONS,
    SECURITY_FRAME_OPTIONS,
    SECURITY_HSTS_ENABLED,
    SECURITY_HSTS_INCLUDE_SUBDOMAINS,
    SECURITY_HSTS_MAX_AGE,
    SECURITY_HSTS_PRELOAD,
    SECURITY_PERMISSIONS_POLICY,
    SECURITY_REFERRER_POLICY,
    SECURITY_XSS_PROTECTION,
)
from app.constants.log_messages import LOG_HEALTH_CHECK_FAILED
from app.database import engine, get_db
from app.extensions import app
from app.utils.helpers import create_error_response, success_response
from app.utils.api_docs import build_endpoint_docs, build_error_docs, build_example_docs
from app.utils.observability import log_event
from app.constants.observability_constants import (
    OBS_EVENT_DB_SESSION_INIT_FAILED,
    OBS_EVENT_DEVICE_FINGERPRINT_INIT_FAILED,
    OBS_EVENT_DEVICE_FINGERPRINT_COMMIT_FAILED,
    OBS_EVENT_DEVICE_FINGERPRINT_ROLLBACK_FAILED,
    OBS_EVENT_SECURITY_HEADERS_APPLY_FAILED,
    OBS_EVENT_REQUEST_COMPLETED,
    OBS_EVENT_LATENCY_SLO_BREACH,
)
from middleware.device_fingerprint import device_fingerprint_middleware


def initialize_request_context(logger: logging.Logger):
    """Initialize request-scoped observability and middleware context."""
    g.request_start_time = datetime.now(timezone.utc)
    g.device_fingerprint_written = False
    g.request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())

    try:
        get_db()
    except Exception as exc:
        log_event(logger, OBS_EVENT_DB_SESSION_INIT_FAILED, level=logging.WARNING, error=str(exc))

    try:
        if ENABLE_DEVICE_FINGERPRINTING:
            device_fingerprint_middleware()
    except Exception as exc:
        log_event(logger, OBS_EVENT_DEVICE_FINGERPRINT_INIT_FAILED, level=logging.WARNING, error=str(exc))

def _normalize_success_envelope(response):
    try:
        if response.is_json and 200 <= int(response.status_code) < 400:
            payload = response.get_json(silent=True)
            if isinstance(payload, dict) and "success" not in payload:
                wrapped = jsonify({"success": True, "data": payload})
                wrapped.status_code = response.status_code
                return wrapped
    except Exception:
        return response
    return response


def _commit_device_fingerprint_if_needed(response, logger: logging.Logger):
    if not ENABLE_DEVICE_FINGERPRINTING:
        return
    if getattr(g, "device_fingerprint_written", False) and request.method in {"GET", "HEAD"}:
        db = getattr(g, "db", None)
        try:
            if db is not None and response.status_code < 400:
                db.commit()
        except Exception as exc:
            log_event(logger, OBS_EVENT_DEVICE_FINGERPRINT_COMMIT_FAILED, level=logging.WARNING, error=str(exc))
            try:
                if db is not None:
                    db.rollback()
            except Exception:
                log_event(logger, OBS_EVENT_DEVICE_FINGERPRINT_ROLLBACK_FAILED, level=logging.WARNING)


def _apply_security_headers(response, logger: logging.Logger):
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
        log_event(logger, OBS_EVENT_SECURITY_HEADERS_APPLY_FAILED, level=logging.WARNING)
    return response


def finalize_response(response, logger: logging.Logger):
    """Apply response normalization, logging, and security headers."""
    request_id = getattr(g, "request_id", None)
    if request_id:
        response.headers["X-Request-ID"] = request_id

    _commit_device_fingerprint_if_needed(response, logger)
    response = _normalize_success_envelope(response)

    app_error_code = response.headers.get("X-COGNIT-Error-Code")
    app_error_status = response.headers.get("X-COGNIT-Error-Status")
    app_error_category = response.headers.get("X-COGNIT-Error-Category")

    if hasattr(g, "request_start_time"):
        duration_ms = int((datetime.now(timezone.utc) - g.request_start_time).total_seconds() * 1000)
        log_event(
            logger,
            OBS_EVENT_REQUEST_COMPLETED,
            method=request.method,
            path=request.path,
            route=(request.url_rule.rule if request.url_rule is not None else request.path),
            request_id=request_id,
            status_code=int(response.status_code),
            transport_status=int(response.status_code),
            app_error_code=app_error_code,
            app_error_status=int(app_error_status) if app_error_status and str(app_error_status).isdigit() else None,
            app_error_category=app_error_category,
            latency_ms=duration_ms,
            vercel_id=request.headers.get("x-vercel-id"),
        )
        if duration_ms > API_LATENCY_SLO_MS:
            log_event(
                logger,
                OBS_EVENT_LATENCY_SLO_BREACH,
                level=logging.WARNING,
                method=request.method,
                path=request.path,
                request_id=request_id,
                latency_ms=duration_ms,
                slo_ms=API_LATENCY_SLO_MS,
            )

    return _apply_security_headers(response, logger)


def handle_payload_too_large(app):
    max_bytes = int(app.config.get("MAX_CONTENT_LENGTH", 5 * 1024 * 1024))
    max_mb = max(1, round(max_bytes / (1024 * 1024)))
    return create_error_response(
        "VAL_FILE_TOO_LARGE",
        details={"max_mb": max_mb, "reason": "payload_too_large"},
        max_mb=max_mb,
    )


def get_health_response(logger: logging.Logger):
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return success_response({"status": "healthy", "database": "connected"})
    except Exception as exc:
        logger.error(LOG_HEALTH_CHECK_FAILED, exc)
        return create_error_response(
            "SYS_SERVICE_DEGRADED",
            details={"status": "degraded"},
        )


def render_api_docs_page(template_name: str, active_page: str) -> Response:
    rendered = render_template(
        template_name,
        base_url=DOCS_BASE_URL,
        active_page=active_page,
        endpoint_docs=build_endpoint_docs(),
        error_groups=build_error_docs(),
        example_docs=build_example_docs(),
    )
    return app.make_response(rendered)


def redirect_to_api_docs_endpoints():
    return redirect(url_for("api_docs_endpoints"))
