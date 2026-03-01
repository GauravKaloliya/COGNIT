"""
Helper utilities module for C.O.G.N.I.T. backend.
Provides common helper functions for validation, responses, and audit logging.
"""

import hashlib
import json
import logging
import re
from typing import Any, Dict, Optional, Tuple

from flask import current_app, jsonify, request
from sqlalchemy import text

from app.config import (
    ERROR_CODES,
    MIN_WORD_COUNT,
    MIN_DESCRIPTION_LENGTH,
    MAX_DESCRIPTION_LENGTH,
    MIN_FEEDBACK_LENGTH,
    MAX_FEEDBACK_LENGTH,
    MIN_RATING,
    MAX_RATING,
    TOO_FAST_SECONDS,
    ALLOWED_IMAGE_EXTENSIONS,
    CONTENT_TYPE_MAP,
    IP_HASH_SALT,
)

logger = logging.getLogger(__name__)


# ────────────────────────────────────────────────
# IP Hash Utility
# ────────────────────────────────────────────────

def get_ip_hash() -> str:
    """Generate SHA256 hash of client IP address for privacy-preserving logging."""
    ip = (request.headers.get("X-Forwarded-For", request.remote_addr or "unknown")
          .split(",")[0].strip())
    if ip in ("", "unknown"):
        return "0" * 64
    try:
        import ipaddress
        return hashlib.sha256(f"{ipaddress.ip_address(ip)}{IP_HASH_SALT}".encode()).hexdigest()
    except:
        return "0" * 64


# ────────────────────────────────────────────────
# Text Processing Utilities
# ────────────────────────────────────────────────

def count_words(text: str) -> int:
    """Count words in text, excluding pure numbers."""
    if not text.strip():
        return 0
    words = re.findall(r"\b\w+\b", text.strip(), re.UNICODE)
    return len([w for w in words if re.search(r"[^\W\d_]", w, re.UNICODE)])


def detect_bot_like_content(text: str, wc: int) -> Tuple[bool, str]:
    """Detect bot-like content - currently disabled, returns False always."""
    return False, ""


# ────────────────────────────────────────────────
# Quality Scoring
# ────────────────────────────────────────────────

def calculate_quality_score(
    wc: int, 
    att: Optional[bool], 
    ts: Optional[float], 
    fb_len: int, 
    bot: bool
) -> float:
    """
    Calculate submission quality score based on multiple factors.
    
    Weights:
    - Word count: 40%
    - Attention check: 30%
    - Time spent: 20%
    - Feedback length: 10%
    """
    s_word = min(wc / 150.0, 1.0)
    s_att = 1.0 if att is None else (1.0 if att else 0.0)
    s_time = 0.5 if ts is not None and ts < TOO_FAST_SECONDS else 1.0
    s_fb = min(fb_len / 50.0, 1.0)
    score = 0.4 * s_word + 0.3 * s_att + 0.2 * s_time + 0.1 * s_fb
    if bot:
        score *= 0.3
    return round(score, 4)


# ────────────────────────────────────────────────
# Audit Logging
# ────────────────────────────────────────────────

def log_audit(db, event_type: str, participant_id: Optional[int] = None, details: str = ""):
    """Log an audit event to the database."""
    try:
        with db.begin_nested():
            db.execute(text("""
                INSERT INTO audit_log (
                    event_type, participant_id, endpoint, http_method,
                    ip_hash, user_agent, details
                ) VALUES (:ev, :pid, :ep, :meth, :iph, :ua, :det)
            """), {
                "ev": event_type,
                "pid": participant_id,
                "ep": request.path,
                "meth": request.method,
                "iph": get_ip_hash(),
                "ua": request.headers.get("User-Agent", "")[:512],
                "det": details[:8000]
            })
    except Exception as exc:
        logger.warning(f"audit log insert failed: {exc}")


# ────────────────────────────────────────────────
# Response Helpers
# ────────────────────────────────────────────────

def error_response(error_key: str, **kwargs) -> Tuple[Any, int]:
    """Generate standardized error response with support for message formatting."""
    error_def = ERROR_CODES.get(error_key, ERROR_CODES["SYS_INTERNAL_ERROR"])
    response = {
        "success": False,
        "error": {
            "code": error_def["code"],
            "message": error_def["message"].format(**kwargs) if kwargs else error_def["message"],
            "category": error_key.split("_")[0] if "_" in error_key else "UNKNOWN",
        }
    }
    if "field" in error_def:
        response["error"]["field"] = error_def["field"]
    if "fields" in error_def:
        response["error"]["fields"] = kwargs.get("fields", [])
    if kwargs.get("details"):
        response["error"]["details"] = kwargs["details"]
    return jsonify(response), error_def["status"]


def success_response(data: Optional[Dict] = None, message: Optional[str] = None):
    """Generate standardized success response."""
    response = {"success": True}
    if message:
        response["message"] = message
    if data:
        response["data"] = data
    return jsonify(response)


def create_error_response(
    error_key: str, 
    details: Optional[dict] = None, 
    custom_message: Optional[str] = None
) -> Tuple[Any, int]:
    """Legacy wrapper for backward compatibility."""
    return error_response(error_key, details=details, custom_message=custom_message)


# ────────────────────────────────────────────────
# File Validation Utilities
# ────────────────────────────────────────────────

def get_file_extension(filename: str) -> str:
    """Extract file extension from filename."""
    if not filename:
        return ""
    return filename.split('.')[-1].lower() if '.' in filename else ""


def validate_image_extension(filename: str) -> Tuple[bool, str, str]:
    """
    Validate image file extension.
    
    Returns:
        Tuple of (is_valid, extension, content_type)
    """
    ext = get_file_extension(filename)
    if ext not in ALLOWED_IMAGE_EXTENSIONS:
        return False, ext, ""
    return True, ext, CONTENT_TYPE_MAP.get(ext, "image/jpeg")