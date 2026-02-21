import hashlib
import json
import os
import re
import time
import functools
import random
import urllib.parse
import hmac
import traceback
from io import BytesIO
import base64
from datetime import datetime, timedelta, timezone
from flask import Flask, jsonify, request, g, current_app, render_template
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, scoped_session
from sqlalchemy.pool import NullPool
import qrcode
import pytesseract
from PIL import Image
import boto3

# ────────────────────────────────────────────────
# Constants & Environment
# ────────────────────────────────────────────────

MIN_WORD_COUNT = int(os.getenv("MIN_WORD_COUNT", "60"))
MIN_DESCRIPTION_LENGTH = int(os.getenv("MIN_DESCRIPTION_LENGTH", "60"))
MAX_DESCRIPTION_LENGTH = int(os.getenv("MAX_DESCRIPTION_LENGTH", "10000"))
MIN_FEEDBACK_LENGTH = int(os.getenv("MIN_FEEDBACK_LENGTH", "5"))
MAX_FEEDBACK_LENGTH = int(os.getenv("MAX_FEEDBACK_LENGTH", "2000"))
MIN_RATING = int(os.getenv("MIN_RATING", "1"))
MAX_RATING = int(os.getenv("MAX_RATING", "10"))
TOO_FAST_SECONDS = float(os.getenv("TOO_FAST_SECONDS", "5.0"))

ATTENTION_FLAG_THRESHOLD = float(os.getenv("ATTENTION_FLAG_THRESHOLD", "0.60"))
ATTENTION_FLAG_MIN_CHECKS = int(os.getenv("ATTENTION_FLAG_MIN_CHECKS", "3"))
PRIORITY_WORD_THRESHOLD = int(os.getenv("PRIORITY_WORD_THRESHOLD", "500"))
PRIORITY_ROUNDS_THRESHOLD = int(os.getenv("PRIORITY_ROUNDS_THRESHOLD", "3"))
PRIORITY_ATTENTION_THRESHOLD = float(os.getenv("PRIORITY_ATTENTION_THRESHOLD", "0.75"))
PRIORITY_MIN_SUBMISSIONS = int(os.getenv("PRIORITY_MIN_SUBMISSIONS", "3"))
SURVEY_ROUNDS = int(os.getenv("SURVEY_ROUNDS", "1"))

PERFORMANCE_LOG_SAMPLE_RATE = float(os.getenv("PERFORMANCE_LOG_SAMPLE_RATE", "0.10"))

# Payment & UPI Configuration
UPI_VPA = os.getenv("UPI_VPA")
if not UPI_VPA:
    raise ValueError("UPI_VPA is required")
UPI_NAME = os.getenv("UPI_NAME")
if not UPI_NAME:
    raise ValueError("UPI_NAME is required")
PAYMENT_SECRET = os.getenv("PAYMENT_SECRET")
if not PAYMENT_SECRET:
    raise ValueError("PAYMENT_SECRET is required")
PAYMENT_EXPIRY_SECONDS = int(os.getenv("PAYMENT_EXPIRY_SECONDS", "300"))

# UPI Screenshot Validation Configuration
ALLOWED_APPS = {
    "gpay": ["gpay", "google pay", "tez"],
    "phonepe": ["phonepe"],
    "paytm": ["paytm"],
    "bhim": ["bhim"],
    "amazonpay": ["amazon pay", "amazonpay"],
    "bharatpe": ["bharatpe"]
}

SUCCESS_KEYWORDS = ["success", "successful", "completed", "paid", "payment successful", "transaction successful"]
FAILURE_KEYWORDS = ["failed", "pending", "declined", "cancelled"]
MIN_OCR_CONFIDENCE = 55
MIN_IMAGE_WIDTH = 600

# Image Upload Configuration
ALLOWED_IMAGE_EXTENSIONS = {'jpg', 'jpeg', 'png', 'webp'}
CONTENT_TYPE_MAP = {
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'webp': 'image/webp'
}

# Standardized Error Codes - Comprehensive unified error management system
# Categories: SYS (System), RATE (Rate Limit), VAL (Validation), DUP (Duplicate),
#             AUTH (Auth), NF (Not Found), PAY (Payment), FRAUD (Fraud)
ERROR_CODES = {
    # =====================================================================
    # SYSTEM ERRORS (SYS)
    # =====================================================================
    "SYS_INTERNAL_ERROR": {"code": "SYS_001_0001", "message": "Something went wrong. Please try again.", "status": 500, "category": "SYS"},
    "SYS_DATABASE_ERROR": {"code": "SYS_001_0002", "message": "Database error occurred. Please try again later.", "status": 500, "category": "SYS"},
    "SYS_SERVICE_UNAVAILABLE": {"code": "SYS_001_0003", "message": "Service temporarily unavailable. Please try later.", "status": 503, "category": "SYS"},
    "SYS_CONFIG_ERROR": {"code": "SYS_001_0004", "message": "Configuration error. Please contact support.", "status": 500, "category": "SYS"},
    # Legacy system error aliases
    "DATABASE_ERROR": {"code": "ERR_DATABASE", "message": "An internal error occurred. Please try again later.", "status": 500, "category": "SYS"},
    "INTERNAL_ERROR": {"code": "ERR_INTERNAL", "message": "Something went wrong. Please try again.", "status": 500, "category": "SYS"},

    # =====================================================================
    # RATE LIMIT ERRORS (RATE)
    # =====================================================================
    "RATE_LIMIT_EXCEEDED": {"code": "RATE_001_0001", "message": "Too many attempts. Please wait a moment.", "status": 429, "category": "RATE"},
    "RATE_TOO_MANY_REQUESTS": {"code": "RATE_001_0002", "message": "Rate limit exceeded. Please slow down.", "status": 429, "category": "RATE"},
    # Legacy rate limit aliases
    "RATE_LIMIT": {"code": "ERR_RATE_LIMIT", "message": "Too many requests. Please slow down.", "status": 429, "category": "RATE"},

    # =====================================================================
    # VALIDATION ERRORS (VAL)
    # =====================================================================
    "VAL_MISSING_FIELDS": {"code": "VAL_003_0001", "message": "Please fill in all required fields", "status": 400, "category": "VAL", "field": "general"},
    "VAL_INVALID_FORMAT": {"code": "VAL_003_0002", "message": "Invalid request format", "status": 400, "category": "VAL"},
    "VAL_INVALID_REQUEST_ID": {"code": "VAL_003_0003", "message": "Invalid request ID format", "status": 400, "category": "VAL"},
    # Participant validation
    "VAL_USERNAME_INVALID": {"code": "VAL_001_0001", "message": "Username must be at least 2 characters and contain only letters, numbers, and underscores", "status": 400, "category": "VAL", "field": "username"},
    "VAL_EMAIL_INVALID": {"code": "VAL_001_0002", "message": "Please enter a valid email address from Gmail, Outlook, Hotmail, or iCloud", "status": 400, "category": "VAL", "field": "email"},
    "VAL_PHONE_INVALID": {"code": "VAL_001_0003", "message": "Please enter a valid 10-digit Indian mobile number", "status": 400, "category": "VAL", "field": "phone"},
    "VAL_AGE_INVALID": {"code": "VAL_001_0004", "message": "Age must be between 13 and 100", "status": 400, "category": "VAL", "field": "age"},
    "VAL_GENDER_REQUIRED": {"code": "VAL_001_0005", "message": "Please select a gender", "status": 400, "category": "VAL", "field": "gender_code"},
    "VAL_LOCATION_REQUIRED": {"code": "VAL_001_0006", "message": "Please enter your location", "status": 400, "category": "VAL", "field": "location"},
    "VAL_LANGUAGE_REQUIRED": {"code": "VAL_001_0007", "message": "Please select your native language", "status": 400, "category": "VAL", "field": "language_code"},
    "VAL_EXPERIENCE_REQUIRED": {"code": "VAL_001_0008", "message": "Please select your prior experience", "status": 400, "category": "VAL", "field": "prior_experience"},
    # Submission validation
    "VAL_DESC_LENGTH": {"code": "VAL_002_0001", "message": f"Description must be {MIN_DESCRIPTION_LENGTH}-{MAX_DESCRIPTION_LENGTH} characters", "status": 400, "category": "VAL", "field": "description"},
    "VAL_DESC_TOO_SHORT": {"code": "VAL_002_0002", "message": f"Description must be at least {MIN_DESCRIPTION_LENGTH} characters", "status": 400, "category": "VAL", "field": "description"},
    "VAL_DESC_TOO_LONG": {"code": "VAL_002_0003", "message": f"Description cannot exceed {MAX_DESCRIPTION_LENGTH} characters", "status": 400, "category": "VAL", "field": "description"},
    "VAL_WORD_COUNT": {"code": "VAL_002_0004", "message": f"At least {MIN_WORD_COUNT} words required", "status": 400, "category": "VAL", "field": "description"},
    "VAL_FEEDBACK_LENGTH": {"code": "VAL_002_0005", "message": f"Feedback must be {MIN_FEEDBACK_LENGTH}-{MAX_FEEDBACK_LENGTH} characters", "status": 400, "category": "VAL", "field": "feedback"},
    "VAL_FEEDBACK_TOO_SHORT": {"code": "VAL_002_0006", "message": f"Feedback must be at least {MIN_FEEDBACK_LENGTH} characters", "status": 400, "category": "VAL", "field": "feedback"},
    "VAL_FEEDBACK_TOO_LONG": {"code": "VAL_002_0007", "message": f"Feedback cannot exceed {MAX_FEEDBACK_LENGTH} characters", "status": 400, "category": "VAL", "field": "feedback"},
    "VAL_RATING_INVALID": {"code": "VAL_002_0008", "message": f"Rating must be between {MIN_RATING} and {MAX_RATING}", "status": 400, "category": "VAL", "field": "rating"},
    "VAL_SURVEY_INDEX": {"code": "VAL_002_0011", "message": "Invalid survey index", "status": 400, "category": "VAL", "field": "survey_index"},
    # Legacy validation aliases
    "MISSING_FIELDS": {"code": "ERR_MISSING_FIELDS", "message": "Required fields are missing.", "status": 400, "category": "VAL"},
    "INVALID_FORMAT": {"code": "ERR_INVALID_FORMAT", "message": "Invalid data format.", "status": 400, "category": "VAL"},
    "INVALID_UUID": {"code": "ERR_INVALID_UUID", "message": "Invalid identifier format.", "status": 400, "category": "VAL"},
    "DESCRIPTION_LENGTH": {"code": "ERR_DESC_LENGTH", "message": f"Description must be {MIN_DESCRIPTION_LENGTH}-{MAX_DESCRIPTION_LENGTH} characters.", "status": 400, "category": "VAL"},
    "FEEDBACK_LENGTH": {"code": "ERR_FEEDBACK_LENGTH", "message": f"Feedback must be {MIN_FEEDBACK_LENGTH}-{MAX_FEEDBACK_LENGTH} characters.", "status": 400, "category": "VAL"},
    "RATING_INVALID": {"code": "ERR_RATING_INVALID", "message": f"Rating must be between {MIN_RATING} and {MAX_RATING}.", "status": 400, "category": "VAL"},
    "WORD_COUNT": {"code": "ERR_WORD_COUNT", "message": f"At least {MIN_WORD_COUNT} words required.", "status": 400, "category": "VAL"},
    "INVALID_IMAGE_ID": {"code": "ERR_INVALID_IMAGE_ID", "message": "Invalid image identifier.", "status": 400, "category": "VAL"},

    # =====================================================================
    # DUPLICATE/CONFLICT ERRORS (DUP)
    # =====================================================================
    "DUP_USERNAME": {"code": "DUP_001_0001", "message": "This username is already taken", "status": 409, "category": "DUP", "field": "username"},
    "DUP_EMAIL": {"code": "DUP_001_0002", "message": "This email is already registered", "status": 409, "category": "DUP", "field": "email"},
    "DUP_PHONE": {"code": "DUP_001_0003", "message": "This phone number is already registered", "status": 409, "category": "DUP", "field": "phone"},
    "DUP_PUBLIC_ID": {"code": "DUP_001_0004", "message": "You have already registered", "status": 409, "category": "DUP"},
    "DUP_SUBMISSION": {"code": "DUP_002_0001", "message": "You have already described this image", "status": 409, "category": "DUP"},
    "DUP_SURVEY_ROUND": {"code": "DUP_002_0002", "message": "You have already completed this survey round", "status": 409, "category": "DUP"},
    "DUP_PAYMENT_IMAGE": {"code": "DUP_003_0001", "message": "This screenshot has already been submitted", "status": 409, "category": "DUP"},
    "DUP_TRANSACTION": {"code": "DUP_003_0002", "message": "This transaction has already been used", "status": 409, "category": "DUP"},
    "DUP_IMAGE_OTHER_USER": {"code": "DUP_003_0003", "message": "This screenshot was already used by another user", "status": 409, "category": "DUP"},
    # Legacy duplicate aliases
    "DUPLICATE_SUBMISSION": {"code": "ERR_DUPLICATE_SUBMISSION", "message": "You have already submitted for this image.", "status": 409, "category": "DUP"},
    "SURVEY_EXISTS": {"code": "ERR_SURVEY_EXISTS", "message": "This survey round has already been submitted.", "status": 409, "category": "DUP"},
    "PARTICIPANT_EXISTS": {"code": "ERR_PARTICIPANT_EXISTS", "message": "Username, email, or phone is already registered.", "status": 409, "category": "DUP"},

    # =====================================================================
    # AUTH/PERMISSION ERRORS (AUTH)
    # =====================================================================
    "AUTH_CONSENT_REQUIRED": {"code": "AUTH_001_0001", "message": "Please agree to the consent terms to continue", "status": 403, "category": "AUTH"},
    "AUTH_ACCOUNT_FLAGGED": {"code": "AUTH_001_0002", "message": "Your account has been flagged. Contact support.", "status": 403, "category": "AUTH"},
    "AUTH_ACCOUNT_DEACTIVATED": {"code": "AUTH_001_0003", "message": "Account has been deactivated", "status": 403, "category": "AUTH"},
    "AUTH_ACCESS_DENIED": {"code": "AUTH_002_0001", "message": "Access denied", "status": 403, "category": "AUTH"},
    # Legacy auth aliases
    "CONSENT_REQUIRED": {"code": "ERR_CONSENT_REQUIRED", "message": "Consent is required to continue.", "status": 403, "category": "AUTH"},
    "FLAGGED_ACCOUNT": {"code": "ERR_FLAGGED_ACCOUNT", "message": "Account flagged due to low attention scores.", "status": 403, "category": "AUTH"},

    # =====================================================================
    # NOT FOUND ERRORS (NF)
    # =====================================================================
    "NF_PARTICIPANT": {"code": "NF_001_0001", "message": "Account not found. Please register first.", "status": 404, "category": "NF"},
    "NF_IMAGE": {"code": "NF_001_0002", "message": "Image not found", "status": 404, "category": "NF"},
    "NF_PAYMENT": {"code": "NF_001_0003", "message": "Payment not found", "status": 404, "category": "NF"},
    "NF_CONSENT": {"code": "NF_001_0004", "message": "Consent record not found", "status": 404, "category": "NF"},
    # Legacy not found aliases
    "PARTICIPANT_NOT_FOUND": {"code": "ERR_PARTICIPANT_NOT_FOUND", "message": "Registration not found. Please complete registration first.", "status": 404, "category": "NF"},
    "NO_IMAGES": {"code": "ERR_NO_IMAGES", "message": "No images available.", "status": 404, "category": "NF"},
    "IMAGE_NOT_FOUND": {"code": "ERR_IMAGE_NOT_FOUND", "message": "Image not found.", "status": 404, "category": "NF"},
    "PAYMENT_NOT_FOUND": {"code": "ERR_PAYMENT_NOT_FOUND", "message": "Payment session not found.", "status": 404, "category": "NF"},

    # =====================================================================
    # PAYMENT ERRORS (PAY)
    # =====================================================================
    "PAY_EXPIRED": {"code": "PAY_001_0001", "message": "Payment session expired. Please start a new payment.", "status": 410, "category": "PAY"},
    "PAY_INVALID_STATE": {"code": "PAY_001_0002", "message": "Payment cannot be processed in current state", "status": 400, "category": "PAY"},
    "PAY_INVALID_AMOUNT": {"code": "PAY_001_0003", "message": "Invalid payment amount", "status": 400, "category": "PAY"},
    "PAY_ALREADY_PROCESSED": {"code": "PAY_001_0004", "message": "Payment has already been processed", "status": 400, "category": "PAY"},
    "PAY_INVALID_IMAGE_TYPE": {"code": "PAY_001_0005", "message": "Invalid image format. Allowed: JPG, PNG, WEBP", "status": 400, "category": "PAY"},
    "PAY_INVALID_SHA256": {"code": "PAY_001_0006", "message": "Invalid file hash", "status": 400, "category": "PAY"},
    # Legacy payment aliases
    "PAYMENT_EXPIRED": {"code": "ERR_PAYMENT_EXPIRED", "message": "Payment session has expired. Please create a new payment.", "status": 410, "category": "PAY"},
    "PAYMENT_INVALID_STATE": {"code": "ERR_PAYMENT_INVALID_STATE", "message": "This payment has already been processed.", "status": 400, "category": "PAY"},
    "INVALID_AMOUNT": {"code": "ERR_INVALID_AMOUNT", "message": "Invalid payment amount.", "status": 400, "category": "PAY"},
    "INVALID_IMAGE_TYPE": {"code": "ERR_INVALID_IMAGE_TYPE", "message": "Invalid image format. Allowed: JPG, PNG, WEBP.", "status": 400, "category": "PAY"},
    "INVALID_SHA256": {"code": "ERR_INVALID_SHA256", "message": "Invalid file hash.", "status": 400, "category": "PAY"},

    # =====================================================================
    # FRAUD DETECTION ERRORS (FRAUD)
    # =====================================================================
    "FRAUD_LOW_RESOLUTION": {"code": "FRAUD_001_0001", "message": "Screenshot is too blurry. Please upload a clearer image.", "status": 400, "category": "FRAUD"},
    "FRAUD_LOW_OCR_CONFIDENCE": {"code": "FRAUD_001_0002", "message": "Could not read the screenshot text. Please retake.", "status": 400, "category": "FRAUD"},
    "FRAUD_UNRECOGNIZED_APP": {"code": "FRAUD_001_0003", "message": "Please use GPay, PhonePe, Paytm, or other approved apps", "status": 400, "category": "FRAUD"},
    "FRAUD_VPA_MISMATCH": {"code": "FRAUD_002_0001", "message": "Payment not made to correct UPI ID", "status": 400, "category": "FRAUD"},
    "FRAUD_NOTE_MISMATCH": {"code": "FRAUD_002_0002", "message": "Payment note does not match. Use the exact note shown.", "status": 400, "category": "FRAUD"},
    "FRAUD_AMOUNT_MISMATCH": {"code": "FRAUD_002_0003", "message": "Payment amount must be exactly ₹1", "status": 400, "category": "FRAUD"},
    "FRAUD_MISSING_SUCCESS": {"code": "FRAUD_002_0004", "message": "Payment success not detected in screenshot", "status": 400, "category": "FRAUD"},
    "FRAUD_FAILURE_INDICATOR": {"code": "FRAUD_002_0005", "message": "Payment appears to have failed. Check your UPI app.", "status": 400, "category": "FRAUD"},
    "FRAUD_MISSING_TXN_ID": {"code": "FRAUD_002_0006", "message": "Transaction ID not found in screenshot", "status": 400, "category": "FRAUD"},
    "FRAUD_DUPLICATE_TXN_ID": {"code": "FRAUD_002_0007", "message": "This transaction has already been used. Please make a fresh payment.", "status": 409, "category": "FRAUD"},
    "FRAUD_DUPLICATE_IMAGE": {"code": "FRAUD_003_0001", "message": "This screenshot was already submitted by another user", "status": 409, "category": "FRAUD"},
    "FRAUD_REJECTED_REUSE": {"code": "FRAUD_003_0002", "message": "This screenshot was previously rejected", "status": 409, "category": "FRAUD"},
    # Legacy fraud aliases
    "DUPLICATE_IMAGE": {"code": "ERR_DUPLICATE_IMAGE", "message": "This screenshot has already been uploaded by another user.", "status": 409, "category": "FRAUD"},
    "REJECTED_REUSE": {"code": "ERR_REJECTED_REUSE", "message": "This screenshot was previously rejected. Please use a fresh payment screenshot.", "status": 409, "category": "FRAUD"},
    "DUPLICATE_TXN": {"code": "ERR_DUPLICATE_TXN", "message": "This transaction has already been used. Each payment must be unique.", "status": 409, "category": "FRAUD"},
    "PAYMENT_REJECTED": {"code": "ERR_PAYMENT_REJECTED", "message": "Payment screenshot could not be verified.", "status": 400, "category": "FRAUD"},
}

# S3 Configuration
AWS_ACCESS_KEY_ID = os.getenv("AWS_ACCESS_KEY_ID")
AWS_SECRET_ACCESS_KEY = os.getenv("AWS_SECRET_ACCESS_KEY")
AWS_REGION = os.getenv("AWS_REGION", "ap-south-1")
S3_BUCKET = os.getenv("S3_BUCKET", "cognitapi")

IP_HASH_SALT = os.getenv("IP_HASH_SALT")
if not IP_HASH_SALT:
    raise ValueError("IP_HASH_SALT is required")

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise ValueError("DATABASE_URL is required")
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    raise ValueError("SECRET_KEY is required")

app = Flask(__name__)
app.url_map.strict_slashes = False
app.config["SECRET_KEY"] = SECRET_KEY
app.config["SESSION_COOKIE_SECURE"] = True
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["MAX_CONTENT_LENGTH"] = 1 * 1024 * 1024

cors_origins = os.getenv("CORS_ORIGINS", "*")
if cors_origins != "*":
    cors_origins = [origin.strip() for origin in cors_origins.split(",")]
CORS(app, resources={r"/*": {"origins": cors_origins}})

limiter = Limiter(
    app=app,
    key_func=get_remote_address,
    default_limits=["200 per day", "50 per hour"],
    storage_uri=os.getenv("RATELIMIT_STORAGE_URI", "memory://")
)

engine = create_engine(
    DATABASE_URL,
    poolclass=NullPool,
    pool_pre_ping=True,
    connect_args={"sslmode": "require"} if "sslmode" not in DATABASE_URL else {}
)

SessionLocal = scoped_session(sessionmaker(bind=engine))

# S3 Client Setup
s3 = boto3.client(
    "s3",
    region_name=AWS_REGION,
    aws_access_key_id=AWS_ACCESS_KEY_ID,
    aws_secret_access_key=AWS_SECRET_ACCESS_KEY,
)

def get_db():
    if "db" not in g:
        g.db = SessionLocal()
    return g.db

@app.teardown_appcontext
def teardown_db(exception):
    db = g.pop("db", None)
    if db is not None:
        db.close()
    SessionLocal.remove()

# ────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────

def get_ip_hash():
    ip = (request.headers.get("X-Forwarded-For", request.remote_addr or "unknown")
          .split(",")[0].strip())
    if ip in ("", "unknown"):
        return "0" * 64
    try:
        import ipaddress
        return hashlib.sha256(f"{ipaddress.ip_address(ip)}{IP_HASH_SALT}".encode()).hexdigest()
    except:
        return "0" * 64

def count_words(text: str) -> int:
    if not text.strip():
        return 0
    words = re.findall(r"\b\w+\b", text.strip(), re.UNICODE)
    return len([w for w in words if re.search(r"[^\W\d_]", w, re.UNICODE)])

# AI detection completely removed - using attention checks for quality control only
def detect_bot_like_content(text: str, wc: int) -> tuple[bool, str]:
    # Always return False - AI detection completely disabled
    return False, ""

def calculate_quality_score(wc: int, att: bool | None, ts: float | None, fb_len: int, bot: bool) -> float:
    s_word = min(wc / 150.0, 1.0)
    s_att = 1.0 if att is None else (1.0 if att else 0.0)
    s_time = 0.5 if ts is not None and ts < TOO_FAST_SECONDS else 1.0
    s_fb = min(fb_len / 50.0, 1.0)
    score = 0.4 * s_word + 0.3 * s_att + 0.2 * s_time + 0.1 * s_fb
    if bot:
        score *= 0.3
    return round(score, 4)

def log_audit(db, event_type: str, participant_id: int | None = None, details: str = ""):
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
        current_app.logger.warning("audit log insert failed: %s", exc)


def error_response(error_key, **kwargs):
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


def success_response(data=None, message=None):
    """Generate standardized success response."""
    response = {"success": True}
    if message:
        response["message"] = message
    if data:
        response["data"] = data
    return jsonify(response)


def create_error_response(error_key: str, details: dict = None, custom_message: str = None):
    """Legacy wrapper for backward compatibility."""
    # Map to new error_response function
    if error_key == "INTERNAL_ERROR":
        return error_response(error_key, details=details, custom_message=custom_message)
    if error_key == "DATABASE_ERROR":
        return error_response(error_key, details=details, custom_message=custom_message)
    if error_key == "RATE_LIMIT":
        return error_response(error_key, details=details, custom_message=custom_message)
    if error_key == "MISSING_FIELDS":
        return error_response(error_key, details=details, custom_message=custom_message)
    if error_key == "INVALID_FORMAT":
        return error_response(error_key, details=details, custom_message=custom_message)
    if error_key == "INVALID_UUID":
        return error_response(error_key, details=details, custom_message=custom_message)
    if error_key == "PARTICIPANT_NOT_FOUND":
        return error_response(error_key, details=details, custom_message=custom_message)
    if error_key == "PARTICIPANT_EXISTS":
        return error_response(error_key, details=details, custom_message=custom_message)
    if error_key == "CONSENT_REQUIRED":
        return error_response(error_key, details=details, custom_message=custom_message)
    if error_key == "FLAGGED_ACCOUNT":
        return error_response(error_key, details=details, custom_message=custom_message)
    if error_key == "DESCRIPTION_LENGTH":
        return error_response(error_key, details=details, custom_message=custom_message)
    if error_key == "FEEDBACK_LENGTH":
        return error_response(error_key, details=details, custom_message=custom_message)
    if error_key == "RATING_INVALID":
        return error_response(error_key, details=details, custom_message=custom_message)
    if error_key == "WORD_COUNT":
        return error_response(error_key, details=details, custom_message=custom_message)
    if error_key == "DUPLICATE_SUBMISSION":
        return error_response(error_key, details=details, custom_message=custom_message)
    if error_key == "SURVEY_EXISTS":
        return error_response(error_key, details=details, custom_message=custom_message)
    if error_key == "PAYMENT_NOT_FOUND":
        return error_response(error_key, details=details, custom_message=custom_message)
    if error_key == "PAYMENT_EXPIRED":
        return error_response(error_key, details=details, custom_message=custom_message)
    if error_key == "PAYMENT_INVALID_STATE":
        return error_response(error_key, details=details, custom_message=custom_message)
    if error_key == "INVALID_AMOUNT":
        return error_response(error_key, details=details, custom_message=custom_message)
    if error_key == "INVALID_IMAGE_TYPE":
        return error_response(error_key, details=details, custom_message=custom_message)
    if error_key == "INVALID_SHA256":
        return error_response(error_key, details=details, custom_message=custom_message)
    if error_key == "DUPLICATE_IMAGE":
        return error_response(error_key, details=details, custom_message=custom_message)
    if error_key == "REJECTED_REUSE":
        return error_response(error_key, details=details, custom_message=custom_message)
    if error_key == "DUPLICATE_TXN":
        return error_response(error_key, details=details, custom_message=custom_message)
    if error_key == "PAYMENT_REJECTED":
        return error_response(error_key, details=details, custom_message=custom_message)
    if error_key == "NO_IMAGES":
        return error_response(error_key, details=details, custom_message=custom_message)
    if error_key == "IMAGE_NOT_FOUND":
        return error_response(error_key, details=details, custom_message=custom_message)
    if error_key == "INVALID_IMAGE_ID":
        return error_response(error_key, details=details, custom_message=custom_message)
    
    # Default fallback
    return error_response(error_key, details=details, custom_message=custom_message)


def get_file_extension(filename: str) -> str:
    """Extract file extension from filename."""
    if not filename:
        return ""
    return filename.split('.')[-1].lower() if '.' in filename else ""


def validate_image_extension(filename: str) -> tuple[bool, str, str]:
    """Validate image file extension and return (is_valid, extension, content_type)."""
    ext = get_file_extension(filename)
    if ext not in ALLOWED_IMAGE_EXTENSIONS:
        return False, ext, ""
    return True, ext, CONTENT_TYPE_MAP.get(ext, "image/jpeg")



# ────────────────────────────────────────────────
# Error Logging Decorator
# ────────────────────────────────────────────────

def log_errors(f):
    """Decorator to automatically log errors to database."""
    @functools.wraps(f)
    def wrapper(*args, **kwargs):
        try:
            return f(*args, **kwargs)
        except Exception as e:
            # Log to database
            try:
                db = get_db()
                db.execute(text("""
                    INSERT INTO error_log (
                        error_code, error_message, error_type,
                        endpoint, http_method, ip_hash, 
                        stack_trace, participant_id
                    ) VALUES (
                        :code, :message, :type,
                        :endpoint, :method, :ip,
                        :stack, :pid
                    )
                """), {
                    "code": getattr(e, 'error_code', 'SYS_001_0001'),
                    "message": str(e)[:500],
                    "type": type(e).__name__,
                    "endpoint": request.path,
                    "method": request.method,
                    "ip": get_ip_hash(),
                    "stack": traceback.format_exc()[:2000] if current_app.debug else None,
                    "pid": getattr(g, 'participant_id', None)
                })
                db.commit()
            except:
                pass  # Don't fail if error logging fails
            raise
    return wrapper


# ────────────────────────────────────────────────
# Database Error Handler
# ────────────────────────────────────────────────

def handle_db_error(exc):
    """Map database exceptions to standardized error codes."""
    exc_str = str(exc).lower()
    if "unique" in exc_str:
        if "username" in exc_str:
            return error_response("DUP_USERNAME")
        elif "email" in exc_str:
            return error_response("DUP_EMAIL")
        elif "phone" in exc_str:
            return error_response("DUP_PHONE")
        elif "public_id" in exc_str:
            return error_response("DUP_PUBLIC_ID")
        elif "survey_index" in exc_str:
            return error_response("DUP_SURVEY_ROUND")
        elif "sha256" in exc_str or "idx_payment_files_sha256" in exc_str:
            return error_response("FRAUD_DUPLICATE_IMAGE")
    elif "check constraint" in exc_str:
        if "age" in exc_str:
            return error_response("VAL_AGE_INVALID")
        elif "email" in exc_str:
            return error_response("VAL_EMAIL_INVALID")
        elif "phone" in exc_str:
            return error_response("VAL_PHONE_INVALID")
        elif "chk_valid_email" in exc_str:
            return error_response("VAL_EMAIL_INVALID")
    elif "foreign key" in exc_str:
        return error_response("NF_PARTICIPANT")
    return error_response("SYS_DATABASE_ERROR")


# ────────────────────────────────────────────────
# Payment & UPI Helpers
# ────────────────────────────────────────────────

def generate_payment_signature(public_id: str, amount: str, expires_at: str) -> str:
    payload = f"{public_id}:{amount}:{expires_at}"
    return hmac.new(
        PAYMENT_SECRET.encode(),
        payload.encode(),
        hashlib.sha256
    ).hexdigest()

def generate_upi_link(amount: float, note: str):
    params = {
        "pa": UPI_VPA,
        "pn": UPI_NAME,
        "am": f"{amount:.2f}",
        "cu": "INR",
        "tn": note
    }
    return "upi://pay?" + urllib.parse.urlencode(params)

def fetch_s3_image(object_key):
    obj = s3.get_object(Bucket=S3_BUCKET, Key=object_key)
    file_bytes = obj["Body"].read()
    return Image.open(BytesIO(file_bytes))

def extract_text_with_confidence(image):
    """Extract text and calculate OCR confidence score."""
    from pytesseract import Output
    data = pytesseract.image_to_data(image, output_type=Output.DICT)
    words = []
    confidences = []
    for i, word in enumerate(data["text"]):
        try:
            conf = int(data["conf"][i])
        except:
            continue
        if conf > 0 and word.strip():
            words.append(word)
            confidences.append(conf)
    if not words:
        return "", 0
    return " ".join(words), sum(confidences)/len(confidences)

def detect_upi_app(text):
    """Detect which UPI app from allowed whitelist."""
    lower = text.lower()
    for app, keywords in ALLOWED_APPS.items():
        if any(k in lower for k in keywords):
            return app
    return None

def normalize_vpa(text):
    """Normalize VPA for comparison."""
    return re.sub(r'[^a-z0-9@.]', '', text.lower())

def verify_payment_screenshot(image, text, expected_amount, payment_note, confidence):
    """
    Strict validation of UPI payment screenshot.
    Returns: (is_valid, detected_app, failure_reasons)
    """
    failures = []
    lower = text.lower()
    
    # 1. Resolution check
    if image.width < MIN_IMAGE_WIDTH:
        failures.append("low_resolution")
    
    # 2. OCR confidence check
    if confidence < MIN_OCR_CONFIDENCE:
        failures.append("low_ocr_confidence")
    
    # 3. App detection
    detected_app = detect_upi_app(text)
    if not detected_app:
        failures.append("unrecognized_app")
    
    # 4. VPA match
    if normalize_vpa(UPI_VPA) not in normalize_vpa(lower):
        failures.append("vpa_mismatch")
    
    # 5. Note binding - payment note must be in text
    if payment_note and payment_note.lower() not in lower:
        failures.append("note_mismatch")
    
    # 6. Amount match (₹1 with variations)
    if not re.search(r"\b1(\.00)?\b", lower):
        failures.append("amount_mismatch")
    
    # 7. Success keyword required
    if not any(k in lower for k in SUCCESS_KEYWORDS):
        failures.append("missing_success_indicator")
    
    # 8. Failure keywords forbidden
    if any(k in lower for k in FAILURE_KEYWORDS):
        failures.append("failure_indicator_present")
    
    # 9. Transaction ID required
    txn_match = re.search(r"\b[a-zA-Z0-9]{12,30}\b", text)
    if not txn_match:
        failures.append("missing_transaction_id")
    
    return len(failures) == 0, detected_app, failures

def extract_upi_ref(text: str):
    match = re.search(r"\b\d{12,16}\b", text)
    return match.group(0) if match else None


def check_duplicate_screenshot(db, sha256_hash: str) -> tuple[bool, int | None]:
    """
    Check if a screenshot with the given SHA256 hash already exists.
    Returns (is_duplicate, existing_payment_id).
    """
    try:
        result = db.execute(text("""
            SELECT pf.payment_id, p.status
            FROM payment_files pf
            JOIN payments p ON p.id = pf.payment_id
            WHERE pf.sha256 = :hash
            LIMIT 1
        """), {"hash": sha256_hash}).fetchone()
        
        if result:
            return True, result[0]
        return False, None
    except Exception as e:
        current_app.logger.warning(f"Duplicate screenshot check failed: {e}")
        return False, None


def check_rejected_screenshot(db, sha256_hash: str) -> bool:
    """
    Check if a screenshot with this hash was previously rejected.
    This prevents users from reusing screenshots that failed verification.
    """
    try:
        result = db.execute(text("""
            SELECT 1
            FROM payment_files pf
            JOIN payments p ON p.id = pf.payment_id
            WHERE pf.sha256 = :hash
              AND p.status = 'rejected_fraud'
            LIMIT 1
        """), {"hash": sha256_hash}).scalar()
        
        return bool(result)
    except Exception as e:
        current_app.logger.warning(f"Rejected screenshot check failed: {e}")
        return False


def check_duplicate_transaction(db, upi_ref: str, exclude_payment_id: int = None) -> tuple[bool, str | None]:
    """
    Check if a transaction ID has been used in any previous successful payment.
    Returns (is_duplicate, status_of_existing_payment).
    """
    if not upi_ref:
        return False, None
    
    try:
        query = """
            SELECT status
            FROM payments
            WHERE upi_txn_ref = :ref
        """
        params = {"ref": upi_ref}
        
        if exclude_payment_id:
            query += " AND id != :pid"
            params["pid"] = exclude_payment_id
        
        query += " LIMIT 1"
        
        result = db.execute(text(query), params).fetchone()
        
        if result:
            return True, result[0]
        return False, None
    except Exception as e:
        current_app.logger.warning(f"Duplicate transaction check failed: {e}")
        return False, None


def compute_fraud_score(text: str, expected_amount: float):
    score = 0.0
    lower = text.lower()

    # Missing amount
    if f"{expected_amount:.2f}" not in lower:
        score += 30

    # Suspicious keywords
    if "failed" in lower:
        score += 40
    if "pending" in lower:
        score += 20

    # No transaction ID
    if not extract_upi_ref(text):
        score += 30

    return min(score, 100.0)

# ────────────────────────────────────────────────
# Performance decorator
# ────────────────────────────────────────────────

def track_performance(f):
    @functools.wraps(f)
    def wrapper(*args, **kwargs):
        start = time.perf_counter()
        try:
            resp = f(*args, **kwargs)
            duration_ms = int((time.perf_counter() - start) * 1000)
            status = 200
            if isinstance(resp, tuple) and len(resp) > 1 and isinstance(resp[1], int):
                status = resp[1]

            if random.random() < PERFORMANCE_LOG_SAMPLE_RATE:
                db = get_db()
                db.execute(text("""
                    INSERT INTO performance_metrics (
                        endpoint, response_time_ms, status_code,
                        request_size_bytes, response_size_bytes
                    ) VALUES (:ep, :ms, :st, :req, 0)
                """), {
                    "ep": request.path, "ms": duration_ms, "st": status,
                    "req": request.content_length or 0
                })
            return resp
        except Exception as exc:
            duration_ms = int((time.perf_counter() - start) * 1000)
            if random.random() < PERFORMANCE_LOG_SAMPLE_RATE:
                db = get_db()
                db.execute(text("""
                    INSERT INTO performance_metrics (
                        endpoint, response_time_ms, status_code,
                        request_size_bytes, response_size_bytes
                    ) VALUES (:ep, :ms, 500, :req, 0)
                """), {"ep": request.path, "ms": duration_ms, "req": request.content_length or 0})
            raise exc
    return wrapper

# ────────────────────────────────────────────────
# Routes
# ────────────────────────────────────────────────

@app.route("/health")
@limiter.exempt
@track_performance
def health():
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return jsonify({"status": "healthy", "database": "connected"})
    except Exception as e:
        current_app.logger.error(f"Health check failed: {e}")
        return jsonify({"status": "degraded", "error": str(e)}), 503

@app.route("/participants", methods=["POST"])
@limiter.limit("30 per minute")
@track_performance
def create_participant():
    data = request.json or {}
    required = ["public_id", "session_id", "username", "email", "phone", "gender_code", "age", "location", "language_code", "prior_experience"]
    missing = [f for f in required if f not in data or not data[f]]
    if missing:
        return create_error_response("MISSING_FIELDS", {"fields": missing})

    public_id = str(data["public_id"]).strip()
    if not re.match(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', public_id, re.I):
        return create_error_response("INVALID_UUID", {"field": "public_id"})

    db = get_db()
    iph = get_ip_hash()
    ua = request.headers.get("User-Agent", "")[:512]

    try:
        result = db.execute(text("""
            INSERT INTO participants (
                public_id, session_id, username, email, phone,
                gender_code, age, location, language_code, prior_experience,
                ip_hash, user_agent, extra_metadata
            ) VALUES (
                :pub, :sid, :un, :em, :ph, :gc, :age, :loc, :lc, :pe, :iph, :ua, '{}'
            )
            RETURNING id
        """), {
            "pub": public_id,
            "sid": str(data["session_id"]).strip()[:128],
            "un": str(data["username"]).strip()[:50],
            "em": str(data["email"]).strip().lower()[:255],
            "ph": str(data["phone"]).strip()[:20],
            "gc": str(data["gender_code"]).strip().lower()[:32],
            "age": int(data["age"]),
            "loc": str(data["location"]).strip()[:120],
            "lc": str(data["language_code"]).strip().lower()[:20],
            "pe": str(data.get("prior_experience", "")).strip()[:120],
            "iph": iph,
            "ua": ua
        })
        participant_id = result.scalar()
        if participant_id is None:
            raise RuntimeError("participant insert did not return id")
        current_app.logger.debug(
            "Participant inserted id=%s public_id=%s",
            participant_id,
            public_id
        )
        visible_row = db.execute(text("""
            SELECT id FROM participants WHERE id = :pid
        """), {"pid": participant_id}).fetchone()
        if not visible_row:
            current_app.logger.warning(
                "Participant not visible after insert id=%s public_id=%s",
                participant_id,
                public_id
            )
        log_audit(db, "participant_created", participant_id=participant_id, details=f"public_id={public_id}")
        db.commit()
        return jsonify({"status": "created", "public_id": public_id}), 201
    except Exception as e:
        db.rollback()
        if "unique" in str(e).lower():
            return create_error_response("PARTICIPANT_EXISTS")
        current_app.logger.exception("create_participant failed")
        return create_error_response("DATABASE_ERROR")

@app.route("/check-username")
@limiter.limit("30 per minute")
@track_performance
def check_username():
    username = request.args.get("username", "").strip()
    if not username:
        return create_error_response("MISSING_FIELDS", {"fields": ["username"]})
    if len(username) < 2:
        return jsonify({"available": True})
    db = get_db()
    exists = db.execute(text("""
        SELECT 1 FROM participants
        WHERE username = :un AND is_deleted = false
        LIMIT 1
    """), {"un": username}).scalar()
    return jsonify({"available": not bool(exists)})


@app.route("/check-email")
@limiter.limit("30 per minute")
@track_performance
def check_email():
    email = request.args.get("email", "").strip().lower()
    if not email:
        return create_error_response("MISSING_FIELDS", {"fields": ["email"]})
    db = get_db()
    exists = db.execute(text("""
        SELECT 1 FROM participants
        WHERE email = :em AND is_deleted = false
        LIMIT 1
    """), {"em": email}).scalar()
    return jsonify({"available": not bool(exists)})


@app.route("/check-phone")
@limiter.limit("30 per minute")
@track_performance
def check_phone():
    phone = request.args.get("phone", "").strip()
    if not phone:
        return create_error_response("MISSING_FIELDS", {"fields": ["phone"]})
    db = get_db()
    exists = db.execute(text("""
        SELECT 1 FROM participants
        WHERE phone = :ph AND is_deleted = false
        LIMIT 1
    """), {"ph": phone}).scalar()
    return jsonify({"available": not bool(exists)})


@app.route("/consent", methods=["POST"])
@limiter.limit("20 per minute")
@track_performance
def record_consent():
    data = request.json or {}
    public_id = data.get("public_id")
    if not public_id:
        return create_error_response("MISSING_FIELDS", {"fields": ["public_id"]})

    db = get_db()
    try:
        row = db.execute(text("""
            SELECT id FROM participants
            WHERE public_id = :pub AND is_deleted = false
            FOR UPDATE
        """), {"pub": public_id}).fetchone()
        if not row:
            return create_error_response("PARTICIPANT_NOT_FOUND")
        pid = row[0]

        db.execute(text("""
            UPDATE participants
            SET consent_given = true, consent_at = CURRENT_TIMESTAMP
            WHERE id = :pid
        """), {"pid": pid})
        log_audit(db, "consent_recorded", participant_id=pid)
        db.commit()
        return jsonify({"status": "consent recorded"})
    except Exception:
        db.rollback()
        current_app.logger.exception("consent failed")
        return create_error_response("INTERNAL_ERROR")

@app.route("/images/random")
@track_performance
def random_image():
    exclude = request.args.get("exclude", "")
    excluded = [x.strip() for x in exclude.split(",") if x.strip()]

    db = get_db()
    where = "WHERE image_id NOT IN :ex" if excluded else ""
    params = {"ex": tuple(excluded)} if excluded else {}

    count = db.execute(text(f"SELECT COUNT(*) FROM images {where}"), params).scalar()
    if count == 0:
        return create_error_response("NO_IMAGES")

    offset = random.randint(0, count - 1)
    row = db.execute(text(f"""
        SELECT image_id, url
        FROM images
        {where}
        OFFSET :off LIMIT 1
    """), {**params, "off": offset}).fetchone()

    if not row:
        return create_error_response("INTERNAL_ERROR")

    return jsonify({"image_id": row[0], "url": row[1]})

@app.route("/submit", methods=["POST"])
@limiter.limit("60 per minute")
@track_performance
def submit():
    d = request.json or {}
    public_id = d.get("public_id")
    if not public_id:
        return create_error_response("MISSING_FIELDS", {"fields": ["public_id"]})

    image_id_str = d.get("image_id")
    if not image_id_str:
        return create_error_response("MISSING_FIELDS", {"fields": ["image_id"]})

    description = (d.get("description") or "").strip()
    if len(description) < MIN_DESCRIPTION_LENGTH or len(description) > MAX_DESCRIPTION_LENGTH:
        return create_error_response("DESCRIPTION_LENGTH")

    feedback = (d.get("feedback") or "").strip()
    if len(feedback) < MIN_FEEDBACK_LENGTH or len(feedback) > MAX_FEEDBACK_LENGTH:
        return create_error_response("FEEDBACK_LENGTH")

    try:
        rating = int(d["rating"])
        if not MIN_RATING <= rating <= MAX_RATING:
            raise ValueError
    except:
        return create_error_response("RATING_INVALID")

    word_count = count_words(description)
    if word_count < MIN_WORD_COUNT:
        return create_error_response("WORD_COUNT", {"actual": word_count})

    ts = d.get("time_spent_seconds")
    if ts is not None:
        try:
            ts = float(ts)
            if ts < 0:
                ts = None
        except:
            ts = None

    is_survey = bool(d.get("is_survey"))
    survey_index = None
    if is_survey:
        try:
            survey_index = int(d["survey_index"])
            if survey_index < 0:
                raise ValueError
        except:
            return create_error_response("INVALID_FORMAT", {"field": "survey_index", "message": "survey_index must be >= 0"})

    db = get_db()
    iph = get_ip_hash()
    ua = request.headers.get("User-Agent", "")[:512]

    p_row = db.execute(text("""
        SELECT id, consent_given, is_deleted
        FROM participants
        WHERE public_id = :pub
    """), {"pub": public_id}).fetchone()

    if not p_row or p_row[2]:
        return create_error_response("PARTICIPANT_NOT_FOUND")
    if not p_row[1]:
        return create_error_response("CONSENT_REQUIRED")

    participant_id = p_row[0]

    flagged = db.execute(text("""
        SELECT is_flagged FROM participant_attention_stats
        WHERE participant_id = :pid
    """), {"pid": participant_id}).scalar()
    if flagged:
        return create_error_response("FLAGGED_ACCOUNT")

    img_row = db.execute(text("SELECT id FROM images WHERE image_id = :iid"), {"iid": image_id_str}).fetchone()
    if not img_row:
        return create_error_response("INVALID_IMAGE_ID")
    image_id_fk = img_row[0]

    if not is_survey:
        dup = db.execute(text("""
            SELECT 1 FROM submissions
            WHERE participant_id = :pid AND image_id = :iid AND is_survey = false
        """), {"pid": participant_id, "iid": image_id_fk}).scalar()
        if dup:
            return create_error_response("DUPLICATE_SUBMISSION")

    ac_row = db.execute(text("""
        SELECT expected_word, is_strict
        FROM attention_checks
        WHERE image_id = :iid AND is_active = true
    """), {"iid": image_id_fk}).fetchone()

    is_attention = ac_row is not None
    attention_passed = None
    if is_attention:
        expected = ac_row[0].strip().lower()
        strict = ac_row[1]
        dlow = description.lower()
        attention_passed = bool(re.search(rf"\b{re.escape(expected)}\b", dlow)) if strict else (expected in dlow)

    too_fast = ts is not None and ts < TOO_FAST_SECONDS
    # AI detection completely removed - using attention check only
    quality = calculate_quality_score(word_count, attention_passed, ts, len(feedback), False)

    # Get engagement tracking data
    tab_switch_count = d.get("tab_switch_count", 0)
    page_close_attempts = d.get("page_close_attempts", 0)
    network_disconnects = d.get("network_disconnects", 0)

    try:
        db.execute(text("""
            INSERT INTO submissions (
                participant_id, image_id, survey_index, description, word_count,
                rating, feedback, time_spent_seconds, is_survey, is_attention_check,
                attention_passed, flagged_too_fast, quality_score,
                ip_hash, user_agent, extra_metadata,
                tab_switch_count, page_close_attempts, network_disconnects
            ) VALUES (
                :pid, :iid, :sidx, :desc, :wc, :rt, :fb, :ts, :isv, :isa,
                :ap, :tf, :qs, :iph, :ua, '{}',
                :tsc, :pca, :nd
            )
        """), {
            "pid": participant_id, "iid": image_id_fk, "sidx": survey_index,
            "desc": description, "wc": word_count, "rt": rating, "fb": feedback,
            "ts": ts, "isv": is_survey, "isa": is_attention, "ap": attention_passed,
            "tf": too_fast, "qs": quality, "iph": iph, "ua": ua,
            "tsc": tab_switch_count, "pca": page_close_attempts, "nd": network_disconnects
        })
        current_app.logger.debug(
            "Submission inserted participant_id=%s image_id=%s survey=%s attention=%s",
            participant_id,
            image_id_fk,
            is_survey,
            is_attention
        )

        if is_attention:
            passed_inc = 1 if attention_passed else 0
            failed_inc = 1 - passed_inc
            db.execute(text("""
                INSERT INTO participant_attention_stats (
                    participant_id, total_checks, passed_checks, failed_checks,
                    attention_score, is_flagged
                ) VALUES (
                    :pid, 1, :p, :f, :sc, false
                ) ON CONFLICT (participant_id) DO UPDATE SET
                    total_checks    = participant_attention_stats.total_checks + 1,
                    passed_checks   = participant_attention_stats.passed_checks + :p,
                    failed_checks   = participant_attention_stats.failed_checks + :f,
                    attention_score = (participant_attention_stats.passed_checks + :p)::numeric /
                                      (participant_attention_stats.total_checks + 1),
                    is_flagged      = (
                        (participant_attention_stats.passed_checks + :p)::numeric /
                        (participant_attention_stats.total_checks + 1)
                    ) < :thresh AND
                    (participant_attention_stats.total_checks + 1) >= :minc
            """), {
                "pid": participant_id, "p": passed_inc, "f": failed_inc,
                "thresh": ATTENTION_FLAG_THRESHOLD, "minc": ATTENTION_FLAG_MIN_CHECKS
            })

        db.execute(text("""
            INSERT INTO participant_activity_stats (
                participant_id, total_words, total_submissions, survey_rounds
            ) VALUES (:pid, :w, 1, :sr)
            ON CONFLICT (participant_id) DO UPDATE SET
                total_words       = participant_activity_stats.total_words + :w,
                total_submissions = participant_activity_stats.total_submissions + 1,
                survey_rounds     = participant_activity_stats.survey_rounds + :sr,
                priority_eligible = (
                    (participant_activity_stats.total_words + :w) >= :wth OR
                    (participant_activity_stats.survey_rounds + :sr) >= :rth
                ) AND COALESCE(
                    (SELECT attention_score FROM participant_attention_stats WHERE participant_id = :pid),
                    1.0
                ) >= :ath
        """), {
            "pid": participant_id,
            "w": word_count,
            "sr": 1 if is_survey else 0,
            "wth": PRIORITY_WORD_THRESHOLD,
            "rth": PRIORITY_ROUNDS_THRESHOLD,
            "ath": PRIORITY_ATTENTION_THRESHOLD
        })

        log_audit(db, "submission", participant_id=participant_id,
                  details=f"wc={word_count} q={quality:.3f} survey={is_survey}")

        db.commit()

        return jsonify({
            "status": "submitted",
            "word_count": word_count,
            "quality_score": quality,
            "attention_passed": attention_passed,
            "flagged_too_fast": too_fast
        })

    except Exception as exc:
        db.rollback()
        if "unique" in str(exc).lower() and "survey_index" in str(exc):
            return create_error_response("SURVEY_EXISTS")
        current_app.logger.exception("submit failed")
        return create_error_response("DATABASE_ERROR")

# ────────────────────────────────────────────────
# Engagement Tracking Routes
# ────────────────────────────────────────────────

@app.route("/engagement/track", methods=["POST"])
@limiter.limit("60 per minute")
@track_performance
def track_engagement():
    """Track engagement events: tab switches, page close attempts, network disconnects."""
    data = request.json or {}
    public_id = data.get("public_id")
    event_type = data.get("event_type")
    
    if not public_id:
        return create_error_response("MISSING_FIELDS", {"fields": ["public_id"]})
    
    if not event_type:
        return create_error_response("MISSING_FIELDS", {"fields": ["event_type"]})
    
    # Validate event_type
    allowed_events = ["tab_switch", "page_close_attempt", "network_disconnect"]
    if event_type not in allowed_events:
        return create_error_response("INVALID_FORMAT", {"field": "event_type", "allowed": allowed_events})
    
    db = get_db()
    
    # Get participant
    row = db.execute(text("""
        SELECT id FROM participants
        WHERE public_id = :pub AND is_deleted = false
    """), {"pub": public_id}).fetchone()
    
    if not row:
        return create_error_response("PARTICIPANT_NOT_FOUND")
    
    participant_id = row[0]

    try:
        # Get current metadata
        current_meta = db.execute(text("""
            SELECT extra_metadata FROM participants WHERE id = :pid
        """), {"pid": participant_id}).scalar() or {}
        
        if isinstance(current_meta, str):
            current_meta = json.loads(current_meta)
        
        # Initialize engagement tracking if not exists
        if "engagement_tracking" not in current_meta:
            current_meta["engagement_tracking"] = {
                "tab_switches": 0,
                "page_close_attempts": 0,
                "network_disconnects": 0,
                "total_events": 0,
                "events": []
            }
        
        # Update the specific counter
        if event_type == "tab_switch":
            current_meta["engagement_tracking"]["tab_switches"] += 1
        elif event_type == "page_close_attempt":
            current_meta["engagement_tracking"]["page_close_attempts"] += 1
        elif event_type == "network_disconnect":
            current_meta["engagement_tracking"]["network_disconnects"] += 1
        
        current_meta["engagement_tracking"]["total_events"] += 1
        current_meta["engagement_tracking"]["events"].append({
            "type": event_type,
            "timestamp": datetime.now(timezone.utc).isoformat()
        })
        
        # Keep only last 100 events to prevent unbounded growth
        if len(current_meta["engagement_tracking"]["events"]) > 100:
            current_meta["engagement_tracking"]["events"] = current_meta["engagement_tracking"]["events"][-100:]
        
        db.execute(text("""
            UPDATE participants
            SET extra_metadata = :meta, updated_at = CURRENT_TIMESTAMP
            WHERE id = :pid
        """), {
            "meta": json.dumps(current_meta),
            "pid": participant_id
        })
        
        db.commit()
        
        return jsonify({
            "status": "tracked",
            "event_type": event_type,
            "total_events": current_meta["engagement_tracking"]["total_events"]
        })
        
    except Exception as e:
        db.rollback()
        current_app.logger.exception("track_engagement failed")
        return create_error_response("INTERNAL_ERROR", custom_message="Tracking failed. Please try again.")

# ────────────────────────────────────────────────
# Payment Routes
# ────────────────────────────────────────────────

@app.route("/payments/create", methods=["POST"])
@limiter.limit("20 per minute")
@track_performance
def create_payment():
    data = request.json or {}
    public_id = data.get("public_id")
    amount = data.get("amount")

    if not public_id or not amount:
        return create_error_response("MISSING_FIELDS", {"fields": ["public_id", "amount"]})

    try:
        amount = round(float(amount), 2)
        if amount <= 0:
            raise ValueError
    except:
        return create_error_response("INVALID_AMOUNT")

    db = get_db()

    row = db.execute(text("""
        SELECT id FROM participants
        WHERE public_id = :pub AND is_deleted = false
    """), {"pub": public_id}).fetchone()

    if not row:
        return create_error_response("PARTICIPANT_NOT_FOUND")

    participant_id = row[0]

    # Mark any existing pending/processing payments as failed to allow new payment creation
    db.execute(text("""
        UPDATE payments
        SET status = 'failed',
            updated_at = CURRENT_TIMESTAMP
        WHERE participant_id = :pid
          AND status IN ('pending', 'processing')
    """), {"pid": participant_id})

    # Timer starts immediately when payment is created (as requested)
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=PAYMENT_EXPIRY_SECONDS)
    expires_str = expires_at.isoformat()

    signature = generate_payment_signature(public_id, str(amount), expires_str)

    try:
        payment_row = db.execute(text("""
            INSERT INTO payments (
                participant_id, amount, signature, expires_at, timer_activated_at
            ) VALUES (
                :pid, :amt, :sig, :exp, :timer_time
            )
            RETURNING public_id
        """), {
            "pid": participant_id,
            "amt": amount,
            "sig": signature,
            "exp": expires_at,
            "timer_time": datetime.now(timezone.utc)  # Timer starts immediately
        }).fetchone()

        # Generate UPI note and store in database
        upi_note = f"COGNIT {payment_row[0]}"
        db.execute(text("""
            UPDATE payments
            SET upi_note = :note
            WHERE public_id = :pub
        """), {
            "note": upi_note,
            "pub": payment_row[0]
        })

        db.commit()

        # Generate UPI link and QR code
        upi_link = generate_upi_link(amount, upi_note)

        qr = qrcode.make(upi_link)
        buffer = BytesIO()
        qr.save(buffer, format="PNG")
        qr_base64 = base64.b64encode(buffer.getvalue()).decode()

        return jsonify({
            "payment_id": str(payment_row[0]),
            "amount": amount,
            "expires_at": expires_str,
            "signature": signature,
            "upi_link": upi_link,
            "upi_note": upi_note,
            "qr_base64": qr_base64,
            "timer_activated": True,
            "time_remaining_seconds": PAYMENT_EXPIRY_SECONDS
        })

    except Exception:
        db.rollback()
        return create_error_response("INTERNAL_ERROR", custom_message="Payment creation failed. Please try again.")

@app.route("/payments/<payment_public_id>/upload-url", methods=["POST"])
@limiter.limit("20 per minute")
@track_performance
def generate_upload_url(payment_public_id):
    db = get_db()
    
    # Get optional file extension from request
    data = request.json or {}
    file_extension = data.get("file_extension", "jpg").lower().strip(".")
    
    # Validate file extension
    is_valid, ext, content_type = validate_image_extension(f"file.{file_extension}")
    if not is_valid:
        return create_error_response("INVALID_IMAGE_TYPE", {"allowed": list(ALLOWED_IMAGE_EXTENSIONS)})

    row = db.execute(text("""
        SELECT id, participant_id, status, expires_at
        FROM payments
        WHERE public_id = :pid
    """), {"pid": payment_public_id}).fetchone()

    if not row:
        return create_error_response("PAYMENT_NOT_FOUND")

    payment_id, participant_id, status, expires_at = row

    # Check if payment has expired
    if expires_at and datetime.now(timezone.utc) > expires_at:
        # Auto-update expired payment
        db.execute(text("""
            UPDATE payments
            SET status = 'expired', updated_at = CURRENT_TIMESTAMP
            WHERE id = :pid
        """), {"pid": payment_id})
        db.commit()
        return create_error_response("PAYMENT_EXPIRED")

    if status not in ("pending", "processing"):
        return create_error_response("PAYMENT_INVALID_STATE")


    object_key = f"payments/{payment_public_id}.{ext}"

    presigned = s3.generate_presigned_url(
        "put_object",
        Params={
            "Bucket": S3_BUCKET,
            "Key": object_key,
            "ContentType": content_type
        },
        ExpiresIn=300
    )

    return jsonify({
        "upload_url": presigned,
        "object_key": object_key,
        "content_type": content_type
    })

@app.route("/payments/<payment_public_id>/finalize", methods=["POST"])
@limiter.limit("20 per minute")
@track_performance
def finalize_payment_upload(payment_public_id):
    data = request.json or {}
    object_key = data.get("object_key")
    sha256_hash = data.get("sha256")

    if not object_key or not sha256_hash:
        return create_error_response("MISSING_FIELDS", {"fields": ["object_key", "sha256"]})

    if not re.match(r"^[a-f0-9]{64}$", sha256_hash):
        return create_error_response("INVALID_SHA256")

    db = get_db()

    row = db.execute(text("""
        SELECT id, participant_id, status, expires_at
        FROM payments
        WHERE public_id = :pid
        FOR UPDATE
    """), {"pid": payment_public_id}).fetchone()

    if not row:
        return create_error_response("PAYMENT_NOT_FOUND")

    payment_id, participant_id, status, expires_at = row

    # Check if payment has expired
    if expires_at and datetime.now(timezone.utc) > expires_at:
        db.execute(text("""
            UPDATE payments
            SET status = 'expired', updated_at = CURRENT_TIMESTAMP
            WHERE id = :pid
        """), {"pid": payment_id})
        db.commit()
        return create_error_response("PAYMENT_EXPIRED")

    if status != "pending":
        return create_error_response("PAYMENT_INVALID_STATE")


    # ────────────────────────────────────────────────
    # Fraud Detection Checks
    # ────────────────────────────────────────────────
    
    # 1. Check if this screenshot was already uploaded (duplicate detection)
    is_duplicate, existing_payment_id = check_duplicate_screenshot(db, sha256_hash)
    if is_duplicate:
        log_audit(db, "fraud_detected_duplicate_image", participant_id=participant_id,
                  details=f"SHA256 {sha256_hash[:16]}... already exists in payment {existing_payment_id}")
        db.commit()
        return create_error_response("DUPLICATE_IMAGE")
    
    # 2. Check if this screenshot was previously rejected
    was_rejected = check_rejected_screenshot(db, sha256_hash)
    if was_rejected:
        log_audit(db, "fraud_detected_rejected_reuse", participant_id=participant_id,
                  details=f"SHA256 {sha256_hash[:16]}... was previously rejected")
        db.commit()
        return create_error_response("REJECTED_REUSE")

    try:
        db.execute(text("""
            INSERT INTO payment_files (
                payment_id, object_key, sha256
            ) VALUES (
                :pid, :key, :hash
            )
        """), {
            "pid": payment_id,
            "key": object_key,
            "hash": sha256_hash
        })

        db.execute(text("""
            UPDATE payments
            SET status = 'processing'
            WHERE id = :pid
        """), {"pid": payment_id})

        db.commit()

        # Run verification immediately after finalize
        # Fetch payment details again after commit
        verification_result = {"status": "processing", "verified": False}
        try:
            row = db.execute(text("""
                SELECT p.id, p.participant_id, p.amount, f.object_key, p.upi_note
                FROM payments p
                JOIN payment_files f ON f.payment_id = p.id
                WHERE p.public_id = :pid
                FOR UPDATE
            """), {"pid": payment_public_id}).fetchone()

            if row:
                payment_id, participant_id, amount, object_key, payment_note = row

                image = fetch_s3_image(object_key)
                extracted_text, confidence = extract_text_with_confidence(image)

                # Run strict validation
                is_valid, detected_app, failures = verify_payment_screenshot(
                    image, extracted_text, amount, payment_note, confidence
                )

                # Build verification details JSON
                verification_details = {
                    "ocr_confidence": confidence,
                    "failure_reasons": failures,
                    "extracted_text_length": len(extracted_text) if extracted_text else 0
                }

                # Extract transaction ID
                txn_match = re.search(r"\b[a-zA-Z0-9]{12,30}\b", extracted_text)
                upi_ref = txn_match.group(0) if txn_match else None
                
                # 3. Check for duplicate transaction ID (if we have a valid-looking one)
                if upi_ref and is_valid:
                    txn_duplicate, txn_status = check_duplicate_transaction(db, upi_ref, exclude_payment_id=payment_id)
                    if txn_duplicate:
                        log_audit(db, "fraud_detected_duplicate_txn", participant_id=participant_id,
                                  details=f"Transaction {upi_ref} already used in payment with status {txn_status}")
                        # Mark as fraud and reject
                        is_valid = False
                        failures.append("duplicate_transaction_id")
                        # Insert fraud signal for duplicate transaction
                        db.execute(text("""
                            INSERT INTO payment_fraud_signals (
                                payment_id, signal_type, signal_score, details
                            ) VALUES (
                                :pid, :type, :score, :details
                            ) ON CONFLICT DO NOTHING
                        """), {
                            "pid": payment_id,
                            "type": "duplicate_transaction_id",
                            "score": 100,
                            "details": json.dumps({"upi_ref": upi_ref, "existing_status": txn_status})
                        })

                new_status = "success" if is_valid else "rejected_fraud"

                db.execute(text("""
                    UPDATE payments
                    SET extracted_text = :txt,
                        upi_txn_ref = :ref,
                        fraud_score = :fs,
                        verified_at = CURRENT_TIMESTAMP,
                        status = :status,
                        detected_app = :app,
                        verification_details = :details
                    WHERE id = :pid
                """), {
                    "txt": extracted_text,
                    "ref": upi_ref,
                    "fs": len(failures) * 10,
                    "status": new_status,
                    "app": detected_app,
                    "details": json.dumps(verification_details),
                    "pid": payment_id
                })

                # Insert fraud signals for each failure reason
                for failure in failures:
                    db.execute(text("""
                        INSERT INTO payment_fraud_signals (
                            payment_id, signal_type, signal_score, details
                        ) VALUES (
                            :pid, :type, :score, :details
                        ) ON CONFLICT DO NOTHING
                    """), {
                        "pid": payment_id,
                        "type": failure,
                        "score": 100,
                        "details": json.dumps({"reason": failure, "confidence": confidence})
                    })

                db.commit()
                verification_result = {
                    "status": new_status,
                    "verified": True,
                    "failure_reasons": failures
                }
        except Exception as e:
            if "TesseractNotFoundError" in type(e).__name__ or "tesseract is not installed" in str(e).lower():
                current_app.logger.warning("Tesseract not available - skipping OCR verification")
            else:
                current_app.logger.exception("Verification failed after upload")
            # Don't fail the upload if verification fails - status remains processing

        return jsonify({"status": "uploaded", "verification": verification_result})

    except Exception:
        db.rollback()
        return create_error_response("DUPLICATE_IMAGE")

@app.route("/payments/<payment_public_id>/status", methods=["GET"])
@limiter.limit("30 per minute")
@track_performance
def get_payment_status(payment_public_id):
    """Get current payment status including expiry check."""
    db = get_db()

    row = db.execute(text("""
        SELECT p.id, p.participant_id, p.status, p.expires_at, p.amount, p.verified_at, p.verification_details, p.detected_app, p.auto_rejected
        FROM payments p
        WHERE p.public_id = :pid
    """), {"pid": payment_public_id}).fetchone()

    if not row:
        return create_error_response("PAYMENT_NOT_FOUND")

    payment_id, participant_id, status, expires_at, amount, verified_at, verification_details, detected_app, auto_rejected = row

    # Check if payment should be marked as expired
    now = datetime.now(timezone.utc)
    is_expired = expires_at and now > expires_at

    if is_expired and status in ("pending", "processing"):
        # Auto-update expired payment
        db.execute(text("""
            UPDATE payments
            SET status = 'expired', updated_at = CURRENT_TIMESTAMP
            WHERE id = :pid
        """), {"pid": payment_id})
        db.commit()
        status = "expired"

    response = {
        "payment_id": payment_public_id,
        "status": status,
        "amount": float(amount) if amount else None,
        "expires_at": expires_at.isoformat() if expires_at else None,
        "is_expired": status == "expired",
        "time_remaining_seconds": max(0, int((expires_at - now).total_seconds())) if expires_at and status in ("pending", "processing") else 0,
        "verified_at": verified_at.isoformat() if verified_at else None
    }

    if verification_details:
        response["verification_details"] = verification_details
    if detected_app:
        response["detected_app"] = detected_app
    if auto_rejected:
        response["auto_rejected"] = True

    return jsonify(response)

@app.route("/internal/payments/<payment_public_id>/verify", methods=["POST"])
@limiter.exempt
def verify_payment(payment_public_id):
    db = get_db()

    row = db.execute(text("""
        SELECT p.id, p.participant_id, p.amount, f.object_key, p.upi_note
        FROM payments p
        JOIN payment_files f ON f.payment_id = p.id
        WHERE p.public_id = :pid
        FOR UPDATE
    """), {"pid": payment_public_id}).fetchone()

    if not row:
        return create_error_response("PAYMENT_NOT_FOUND")

    payment_id, participant_id, amount, object_key, payment_note = row

    image = fetch_s3_image(object_key)
    extracted_text, confidence = extract_text_with_confidence(image)

    # Run strict validation
    is_valid, detected_app, failures = verify_payment_screenshot(
        image, extracted_text, amount, payment_note, confidence
    )

    # Build verification details JSON
    verification_details = {
        "ocr_confidence": confidence,
        "failure_reasons": failures,
        "extracted_text_length": len(extracted_text) if extracted_text else 0
    }

    # Extract transaction ID
    txn_match = re.search(r"\b[a-zA-Z0-9]{12,30}\b", extracted_text)
    upi_ref = txn_match.group(0) if txn_match else None

    if is_valid:
        new_status = "success"
    else:
        new_status = "rejected_fraud"

    db.execute(text("""
        UPDATE payments
        SET extracted_text = :txt,
            upi_txn_ref = :ref,
            fraud_score = :fs,
            verified_at = CURRENT_TIMESTAMP,
            status = :status,
            detected_app = :app,
            verification_details = :details
        WHERE id = :pid
    """), {
        "txt": extracted_text,
        "ref": upi_ref,
        "fs": len(failures) * 10,
        "status": new_status,
        "app": detected_app,
        "details": json.dumps(verification_details),
        "pid": payment_id
    })

    # Insert fraud signals for each failure reason
    for failure in failures:
        db.execute(text("""
            INSERT INTO payment_fraud_signals (
                payment_id, signal_type, signal_score, details
            ) VALUES (
                :pid, :type, :score, :details
            ) ON CONFLICT DO NOTHING
        """), {
            "pid": payment_id,
            "type": failure,
            "score": 100,
            "details": json.dumps({"reason": failure, "confidence": confidence})
        })

    db.commit()

    if is_valid:
        return jsonify({
            "status": "success",
            "detected_app": detected_app
        })
    else:
        return jsonify({
            "status": "rejected_fraud",
            "detected_app": detected_app,
            "failure_reasons": failures
        })


# ────────────────────────────────────────────────
# Client Error Logging Endpoint
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


@app.route("/")
@limiter.limit("30 per minute")
@track_performance
def root():
    base_url = "https://api.cognit.online"
    return render_template("api_docs.html", base_url=base_url)

@app.route("/docs")
@limiter.limit("30 per minute")
@track_performance
def api_docs():
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
                    "is_expired": false,
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
