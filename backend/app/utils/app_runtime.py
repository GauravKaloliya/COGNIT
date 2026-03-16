"""App-level request/response/runtime helpers for main.py."""

from __future__ import annotations

import logging
import time
import uuid
from datetime import datetime, timezone

from flask import g, jsonify, redirect, render_template, request, url_for
from sqlalchemy import text

from app.config import (
    API_LATENCY_SLO_MS,
    HEALTH_CACHE_TTL_SECONDS,
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
from app.database import engine, get_db
from app.utils.helpers import create_error_response, success_response
from app.utils.observability import log_event
from middleware.device_fingerprint import device_fingerprint_middleware

DOCS_BASE_URL = "https://api.cognit.online"


def initialize_request_context(logger: logging.Logger):
    """Initialize request-scoped observability and middleware context."""
    g.request_start_time = datetime.now(timezone.utc)
    g.device_fingerprint_written = False
    g.request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())

    try:
        get_db()
    except Exception as exc:
        logger.warning("DB session init failed in before_request: %s", exc)

    try:
        device_fingerprint_middleware()
    except Exception as exc:
        logger.warning("Device fingerprint middleware failed: %s", exc)

    logger.info("REQUEST %s %s request_id=%s", request.method, request.path, g.request_id)
    log_event(
        logger,
        "request_received",
        method=request.method,
        path=request.path,
        request_id=g.request_id,
        participant_id=getattr(g, "participant_id", None),
    )


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
    if getattr(g, "device_fingerprint_written", False) and request.method in {"GET", "HEAD"}:
        db = getattr(g, "db", None)
        try:
            if db is not None and response.status_code < 400:
                db.commit()
        except Exception as exc:
            logger.warning("Device fingerprint commit failed: %s", exc)
            try:
                if db is not None:
                    db.rollback()
            except Exception:
                pass


def _apply_security_headers(response):
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


def finalize_response(response, logger: logging.Logger):
    """Apply response normalization, logging, and security headers."""
    request_id = getattr(g, "request_id", None)
    if request_id:
        response.headers["X-Request-ID"] = request_id

    _commit_device_fingerprint_if_needed(response, logger)
    response = _normalize_success_envelope(response)

    if hasattr(g, "request_start_time"):
        duration_ms = int((datetime.now(timezone.utc) - g.request_start_time).total_seconds() * 1000)
        logger.info(
            "RESPONSE %s %s - %s - %sms request_id=%s",
            request.method,
            request.path,
            response.status_code,
            duration_ms,
            request_id,
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

    return _apply_security_headers(response)


def handle_payload_too_large(app):
    max_bytes = int(app.config.get("MAX_CONTENT_LENGTH", 5 * 1024 * 1024))
    max_mb = max(1, round(max_bytes / (1024 * 1024)))
    return create_error_response(
        "VAL_FILE_TOO_LARGE",
        details={"max_mb": max_mb, "reason": "payload_too_large"},
        custom_message=f"The file is too large. Please upload an image smaller than {max_mb}MB.",
    )


def get_cached_health_response(app, logger: logging.Logger):
    now_ts = time.time()
    cache = getattr(app, "_health_cache", None)
    if cache and (now_ts - cache.get("checked_at", 0.0)) <= max(0.5, HEALTH_CACHE_TTL_SECONDS):
        cached_ok = bool(cache.get("ok"))
        if cached_ok:
            return success_response(cache.get("data", {"status": "healthy", "database": "connected"}))
        return create_error_response(
            "SYS_INTERNAL_ERROR",
            details=cache.get("details", {}),
            custom_message=cache.get("message", "Service degraded"),
        )

    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        logger.info("Health check passed")
        data = {"status": "healthy", "database": "connected"}
        app._health_cache = {"checked_at": now_ts, "ok": True, "data": data}
        return success_response(data)
    except Exception as exc:
        logger.error("Health check failed: %s", exc)
        app._health_cache = {
            "checked_at": now_ts,
            "ok": False,
            "message": "Service degraded",
            "details": {"status": "degraded"},
        }
        return create_error_response(
            "SYS_INTERNAL_ERROR",
            details={"status": "degraded"},
            custom_message="Service degraded",
        )


def render_api_docs_page(template_name: str, active_page: str):
    return render_template(
        template_name,
        base_url=DOCS_BASE_URL,
        active_page=active_page,
    )


def redirect_to_api_docs_endpoints():
    return redirect(url_for("api_docs_endpoints"))
