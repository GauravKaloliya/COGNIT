"""
Helper utilities module for C.O.G.N.I.T. backend.
Provides common helper functions for validation, responses, and audit logging.
"""

import hashlib
import re
from typing import Any, Dict, Optional, Tuple

from flask import jsonify, request, g
from sqlalchemy import text

from app.config import (
    ERROR_CODES,
    TOO_FAST_SECONDS,
    ALLOWED_IMAGE_EXTENSIONS,
    CONTENT_TYPE_MAP,
    IP_HASH_SALT,
)


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
                    ip_hash, user_agent, details, request_id
                ) VALUES (:ev, :pid, :ep, :meth, :iph, :ua, :det, :rid)
            """), {
                "ev": event_type,
                "pid": participant_id,
                "ep": request.path,
                "meth": request.method,
                "iph": get_ip_hash(),
                "ua": request.headers.get("User-Agent", "")[:512],
                "det": details[:8000],
                "rid": getattr(g, "request_id", None),
            })
    except Exception as exc:
        print(f"[WARN] audit log insert failed: {exc}", flush=True)


# ────────────────────────────────────────────────
# Response Helpers
# ────────────────────────────────────────────────

def error_response(error_key: str, **kwargs) -> Tuple[Any, int]:
    """Generate strict standardized error response."""
    error_def = ERROR_CODES.get(error_key, ERROR_CODES["SYS_INTERNAL_ERROR"])
    custom_message = kwargs.get("custom_message")
    status = int(error_def.get("status", 500))
    category = error_def.get("category", "SYS")
    retryable = kwargs.get("retryable")
    if retryable is None:
        retryable = status >= 500 or category in {"RATE", "PAY"}

    base_message = error_def["message"].format(**kwargs) if kwargs else error_def["message"]
    request_id = getattr(g, "request_id", None)
    response = {
        "success": False,
        "error": {
            "code": error_def["code"],
            "message": custom_message or base_message,
            "category": category,
            "http_status": status,
            "retryable": bool(retryable),
            "request_id": request_id,
        }
    }
    if "field" in error_def:
        response["error"]["field"] = error_def["field"]
    if "fields" in kwargs and kwargs.get("fields") is not None:
        response["error"]["fields"] = kwargs["fields"]
    if kwargs.get("details"):
        response["error"]["details"] = kwargs["details"]
    return jsonify(response), status


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
    """Project-wide error response helper."""
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
