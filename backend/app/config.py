"""
Configuration module for C.O.G.N.I.T. backend.
Centralized configuration management following 2025 best practices.
"""

import os
from typing import Dict, Any

from pathlib import Path

backend_dir = Path(__file__).parent.parent
# Local/dev startup: load the first available env file if present.
# This does not override already-exported environment variables.
candidate_env_files = [
    backend_dir / ".env",
    backend_dir / ".env.development",
    backend_dir / ".env.local",
]
try:
    from dotenv import load_dotenv
    for env_path in candidate_env_files:
        if env_path.exists():
            load_dotenv(env_path)
            break
except ImportError:
    for env_path in candidate_env_files:
        if not env_path.exists():
            continue
        with env_path.open("r", encoding="utf-8") as fh:
            for raw_line in fh:
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                os.environ.setdefault(key, value)
        break


# ────────────────────────────────────────────────
# Application Constants
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
ATTENTION_HARD_FLAG_CONSEC_FAILS = int(os.getenv("ATTENTION_HARD_FLAG_CONSEC_FAILS", "2"))
ATTENTION_MIN_DISTINCT_WORDS = int(os.getenv("ATTENTION_MIN_DISTINCT_WORDS", "12"))
ATTENTION_MIN_CHAR_LENGTH = int(os.getenv("ATTENTION_MIN_CHAR_LENGTH", "120"))
ATTENTION_INTERVAL = int(os.getenv("ATTENTION_INTERVAL", "4"))
PRIORITY_WORD_THRESHOLD = int(os.getenv("PRIORITY_WORD_THRESHOLD", "500"))
PRIORITY_ROUNDS_THRESHOLD = int(os.getenv("PRIORITY_ROUNDS_THRESHOLD", "3"))
PRIORITY_ATTENTION_THRESHOLD = float(os.getenv("PRIORITY_ATTENTION_THRESHOLD", "0.75"))
PRIORITY_MIN_SUBMISSIONS = int(os.getenv("PRIORITY_MIN_SUBMISSIONS", "3"))
PRIORITY_QUEUE_MIN_TOTAL_WORDS = int(os.getenv("PRIORITY_QUEUE_MIN_TOTAL_WORDS", "120"))
PRIORITY_QUEUE_MIN_ROUNDS = int(os.getenv("PRIORITY_QUEUE_MIN_ROUNDS", "3"))
REWARD_MAX_AVG_TIME_SECONDS = float(os.getenv("REWARD_MAX_AVG_TIME_SECONDS", "180"))
REWARD_MIN_AVG_FEEDBACK_LENGTH = int(os.getenv("REWARD_MIN_AVG_FEEDBACK_LENGTH", "20"))
REWARD_MIN_AVG_RATING = float(os.getenv("REWARD_MIN_AVG_RATING", "7"))
REWARD_MIN_AVG_QUALITY_SCORE = float(os.getenv("REWARD_MIN_AVG_QUALITY_SCORE", "0.75"))

PERFORMANCE_LOG_SAMPLE_RATE = float(os.getenv("PERFORMANCE_LOG_SAMPLE_RATE", "0.10"))
ENABLE_PERFORMANCE_METRICS = os.getenv("ENABLE_PERFORMANCE_METRICS", "true").lower() == "true"
MAX_CONTENT_LENGTH_MB = int(os.getenv("MAX_CONTENT_LENGTH_MB", "16"))
PAYMENT_MAX_IMAGE_MB = int(os.getenv("PAYMENT_MAX_IMAGE_MB", "8"))

DB_POOL_SIZE = int(os.getenv("DB_POOL_SIZE", "10"))
DB_MAX_OVERFLOW = int(os.getenv("DB_MAX_OVERFLOW", "20"))
DB_POOL_TIMEOUT_SECONDS = int(os.getenv("DB_POOL_TIMEOUT_SECONDS", "30"))
DB_POOL_RECYCLE_SECONDS = int(os.getenv("DB_POOL_RECYCLE_SECONDS", "1800"))
PARTICIPANT_CACHE_TTL_SECONDS = int(os.getenv("PARTICIPANT_CACHE_TTL_SECONDS", "600"))
IMAGE_POOL_CACHE_TTL_SECONDS = int(os.getenv("IMAGE_POOL_CACHE_TTL_SECONDS", "60"))

HEALTH_CACHE_TTL_SECONDS = float(os.getenv("HEALTH_CACHE_TTL_SECONDS", "5.0"))

LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
VERCEL_ENV = os.getenv("VERCEL_ENV", "development")
WEBSITE_URL = os.getenv("WEBSITE_URL", "http://localhost:5000")


# ────────────────────────────────────────────────
# Payment & UPI Configuration
# ────────────────────────────────────────────────

UPI_VPA = os.getenv("UPI_VPA")
if not UPI_VPA:
    raise ValueError("UPI_VPA is required")
UPI_NAME = os.getenv("UPI_NAME")
if not UPI_NAME:
    raise ValueError("UPI_NAME is required")
PAYMENT_AMOUNT = float(os.getenv("PAYMENT_AMOUNT", "1"))
PAYMENT_SECRET = os.getenv("PAYMENT_SECRET")
if not PAYMENT_SECRET:
    raise ValueError("PAYMENT_SECRET is required")
PAYMENT_EXPIRY_SECONDS = int(os.getenv("PAYMENT_EXPIRY_SECONDS", "300"))
PAYMENT_SCREENSHOT_TIMEZONE = os.getenv("PAYMENT_SCREENSHOT_TIMEZONE", "Asia/Kolkata")
PAYMENT_VERIFICATION_MAX_TIME_DIFF_SECONDS = int(os.getenv("PAYMENT_VERIFICATION_MAX_TIME_DIFF_SECONDS", "300"))
PAYMENT_VERIFICATION_TIME_GRACE_SECONDS = int(os.getenv("PAYMENT_VERIFICATION_TIME_GRACE_SECONDS", "180"))


# ────────────────────────────────────────────────
# UPI Screenshot Validation Configuration
# ────────────────────────────────────────────────

ALLOWED_APPS: Dict[str, list] = {
    "gpay": ["gpay", "google pay", "googlepay", "tez"],
    "paytm": ["paytm"],
    "bhim": ["bhim"]
}

SUCCESS_KEYWORDS = ["success", "successful", "completed", "paid", "payment successful", "transaction successful"]
FAILURE_KEYWORDS = ["failed", "pending", "declined", "cancelled"]
MIN_OCR_CONFIDENCE = int(os.getenv("MIN_OCR_CONFIDENCE", "55"))
MIN_IMAGE_WIDTH = int(os.getenv("MIN_IMAGE_WIDTH", "600"))
IMAGE_VALIDATE_URL_AVAILABILITY = os.getenv("IMAGE_VALIDATE_URL_AVAILABILITY", "false").lower() == "true"


# ────────────────────────────────────────────────
# Image Upload Configuration
# ────────────────────────────────────────────────

_raw_extensions = os.getenv("ALLOWED_IMAGE_EXTENSIONS", "jpg,jpeg,png,webp")
ALLOWED_IMAGE_EXTENSIONS = {ext.strip().lower() for ext in _raw_extensions.split(",")}
CONTENT_TYPE_MAP = {
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'webp': 'image/webp'
}


# ────────────────────────────────────────────────
# Fraud Detection & Feature Flags
# ────────────────────────────────────────────────

MAX_FRAUD_SCORE = float(os.getenv("MAX_FRAUD_SCORE", "50.0"))
ENABLE_DUPLICATE_DETECTION = os.getenv("ENABLE_DUPLICATE_DETECTION", "true").lower() == "true"
ENABLE_DEVICE_FINGERPRINTING = os.getenv("ENABLE_DEVICE_FINGERPRINTING", "true").lower() == "true"
ENABLE_AUDIT_LOGGING = os.getenv("ENABLE_AUDIT_LOGGING", "true").lower() == "true"
ENABLE_ERROR_LOGGING = os.getenv("ENABLE_ERROR_LOGGING", "true").lower() == "true"


# ────────────────────────────────────────────────
# Standardized Error Codes
# ────────────────────────────────────────────────

ERROR_CODES: Dict[str, Dict[str, Any]] = {
    # =====================================================================
    # SYSTEM ERRORS (SYS)
    # =====================================================================
    "SYS_INTERNAL_ERROR": {"code": "SYS_001_0001", "message": "Something went wrong. Please try again.", "status": 500, "category": "SYS"},
    "SYS_DATABASE_ERROR": {"code": "SYS_001_0002", "message": "Database error occurred. Please try again later.", "status": 500, "category": "SYS"},
    "SYS_SERVICE_UNAVAILABLE": {"code": "SYS_001_0003", "message": "Service temporarily unavailable. Please try later.", "status": 503, "category": "SYS"},
    "SYS_CONFIG_ERROR": {"code": "SYS_001_0004", "message": "Configuration error. Please contact support.", "status": 500, "category": "SYS"},
    "DATABASE_ERROR": {"code": "ERR_DATABASE", "message": "An internal error occurred. Please try again later.", "status": 500, "category": "SYS"},
    "INTERNAL_ERROR": {"code": "ERR_INTERNAL", "message": "Something went wrong. Please try again.", "status": 500, "category": "SYS"},

    # =====================================================================
    # RATE LIMIT ERRORS (RATE)
    # =====================================================================
    "RATE_LIMIT_EXCEEDED": {"code": "RATE_001_0001", "message": "Too many attempts. Please wait a moment.", "status": 429, "category": "RATE"},
    "RATE_TOO_MANY_REQUESTS": {"code": "RATE_001_0002", "message": "Rate limit exceeded. Please slow down.", "status": 429, "category": "RATE"},
    "RATE_LIMIT": {"code": "ERR_RATE_LIMIT", "message": "Too many requests. Please slow down.", "status": 429, "category": "RATE"},

    # =====================================================================
    # VALIDATION ERRORS (VAL)
    # =====================================================================
    "VAL_MISSING_FIELDS": {"code": "VAL_003_0001", "message": "Please fill in all required fields", "status": 400, "category": "VAL", "field": "general"},
    "VAL_INVALID_FORMAT": {"code": "VAL_003_0002", "message": "Invalid request format", "status": 400, "category": "VAL"},
    "VAL_INVALID_REQUEST_ID": {"code": "VAL_003_0003", "message": "Invalid request ID format", "status": 400, "category": "VAL"},
    "VAL_METHOD_NOT_ALLOWED": {"code": "VAL_003_0007", "message": "HTTP method not allowed for this route", "status": 405, "category": "VAL"},
    "VAL_FILE_TOO_LARGE": {"code": "VAL_003_0005", "message": "The file is too large. Please upload a smaller image.", "status": 413, "category": "VAL", "field": "image_base64"},
    "VAL_USERNAME_INVALID": {"code": "VAL_001_0001", "message": "Username must be at least 2 characters and contain only letters, numbers, and underscores", "status": 400, "category": "VAL", "field": "username"},
    "VAL_EMAIL_INVALID": {"code": "VAL_001_0002", "message": "Please enter a valid email address from Gmail, Outlook, Hotmail, or iCloud", "status": 400, "category": "VAL", "field": "email"},
    "VAL_PHONE_INVALID": {"code": "VAL_001_0003", "message": "Please enter a valid 10-digit Indian mobile number", "status": 400, "category": "VAL", "field": "phone"},
    "VAL_AGE_INVALID": {"code": "VAL_001_0004", "message": "Age must be between 13 and 100", "status": 400, "category": "VAL", "field": "age"},
    "VAL_GENDER_REQUIRED": {"code": "VAL_001_0005", "message": "Please select a gender", "status": 400, "category": "VAL", "field": "gender_code"},
    "VAL_LOCATION_REQUIRED": {"code": "VAL_001_0006", "message": "Please enter your location", "status": 400, "category": "VAL", "field": "location"},
    "VAL_LANGUAGE_REQUIRED": {"code": "VAL_001_0007", "message": "Please select your native language", "status": 400, "category": "VAL", "field": "language_code"},
    "VAL_EXPERIENCE_REQUIRED": {"code": "VAL_001_0008", "message": "Please select your prior experience", "status": 400, "category": "VAL", "field": "prior_experience"},
    "VAL_DESC_LENGTH": {"code": "VAL_002_0001", "message": f"Description must be {MIN_DESCRIPTION_LENGTH}-{MAX_DESCRIPTION_LENGTH} characters", "status": 400, "category": "VAL", "field": "description"},
    "VAL_DESC_TOO_SHORT": {"code": "VAL_002_0002", "message": f"Description must be at least {MIN_DESCRIPTION_LENGTH} characters", "status": 400, "category": "VAL", "field": "description"},
    "VAL_DESC_TOO_LONG": {"code": "VAL_002_0003", "message": f"Description cannot exceed {MAX_DESCRIPTION_LENGTH} characters", "status": 400, "category": "VAL", "field": "description"},
    "VAL_WORD_COUNT": {"code": "VAL_002_0004", "message": f"At least {MIN_WORD_COUNT} words required", "status": 400, "category": "VAL", "field": "description"},
    "VAL_FEEDBACK_LENGTH": {"code": "VAL_002_0005", "message": f"Feedback must be {MIN_FEEDBACK_LENGTH}-{MAX_FEEDBACK_LENGTH} characters", "status": 400, "category": "VAL", "field": "feedback"},
    "VAL_FEEDBACK_TOO_SHORT": {"code": "VAL_002_0006", "message": f"Feedback must be at least {MIN_FEEDBACK_LENGTH} characters", "status": 400, "category": "VAL", "field": "feedback"},
    "VAL_FEEDBACK_TOO_LONG": {"code": "VAL_002_0007", "message": f"Feedback cannot exceed {MAX_FEEDBACK_LENGTH} characters", "status": 400, "category": "VAL", "field": "feedback"},
    "VAL_RATING_INVALID": {"code": "VAL_002_0008", "message": f"Rating must be between {MIN_RATING} and {MAX_RATING}", "status": 400, "category": "VAL", "field": "rating"},
    "VAL_SURVEY_INDEX": {"code": "VAL_002_0011", "message": "Invalid survey index", "status": 400, "category": "VAL", "field": "survey_index"},
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
    "CONSENT_REQUIRED": {"code": "ERR_CONSENT_REQUIRED", "message": "Consent is required to continue.", "status": 403, "category": "AUTH"},
    "FLAGGED_ACCOUNT": {"code": "ERR_FLAGGED_ACCOUNT", "message": "Account flagged due to low attention scores.", "status": 403, "category": "AUTH"},

    # =====================================================================
    # NOT FOUND ERRORS (NF)
    # =====================================================================
    "NF_PARTICIPANT": {"code": "NF_001_0001", "message": "Account not found. Please register first.", "status": 404, "category": "NF"},
    "NF_IMAGE": {"code": "NF_001_0002", "message": "Image not found", "status": 404, "category": "NF"},
    "NF_PAYMENT": {"code": "NF_001_0003", "message": "Payment not found", "status": 404, "category": "NF"},
    "NF_CONSENT": {"code": "NF_001_0004", "message": "Consent record not found", "status": 404, "category": "NF"},
    "NF_ROUTE_NOT_FOUND": {"code": "NF_001_0005", "message": "Route not found", "status": 404, "category": "NF"},
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
    "FRAUD_UNRECOGNIZED_APP": {"code": "FRAUD_001_0003", "message": "Please use Google Pay, Paytm, or BHIM", "status": 400, "category": "FRAUD"},
    "FRAUD_INVALID_BANKING_NAME": {"code": "FRAUD_001_0004", "message": "Payment not made to the correct beneficiary", "status": 400, "category": "FRAUD"},
    "FRAUD_INVALID_AMOUNT": {"code": "FRAUD_001_0005", "message": "Payment amount must be exactly ₹1", "status": 400, "category": "FRAUD"},
    "FRAUD_TIME_OUT_OF_RANGE": {"code": "FRAUD_001_0006", "message": "Payment time is outside the allowed payment-session window", "status": 400, "category": "FRAUD"},
    "FRAUD_INVALID_TIMESTAMP": {"code": "FRAUD_001_0007", "message": "Could not read payment time from screenshot", "status": 400, "category": "FRAUD"},
    "FRAUD_MISSING_TIMESTAMP": {"code": "FRAUD_001_0008", "message": "Payment time not found in screenshot", "status": 400, "category": "FRAUD"},
    "FRAUD_VPA_MISMATCH": {"code": "FRAUD_002_0001", "message": "Payment not made to correct UPI ID", "status": 400, "category": "FRAUD"},
    "FRAUD_NOTE_MISMATCH": {"code": "FRAUD_002_0002", "message": "Payment note does not match. Use the exact note shown.", "status": 400, "category": "FRAUD"},
    "FRAUD_AMOUNT_MISMATCH": {"code": "FRAUD_002_0003", "message": "Payment amount must be exactly ₹1", "status": 400, "category": "FRAUD"},
    "FRAUD_MISSING_SUCCESS": {"code": "FRAUD_002_0004", "message": "Payment success not detected in screenshot", "status": 400, "category": "FRAUD"},
    "FRAUD_FAILURE_INDICATOR": {"code": "FRAUD_002_0005", "message": "Payment appears to have failed. Check your UPI app.", "status": 400, "category": "FRAUD"},
    "FRAUD_DUPLICATE_IMAGE": {"code": "FRAUD_003_0001", "message": "This screenshot was already submitted by another user", "status": 409, "category": "FRAUD"},
    "FRAUD_DUPLICATE_IMAGE_SELF": {"code": "FRAUD_003_0004", "message": "You already submitted this screenshot. Please use a new payment screenshot.", "status": 409, "category": "FRAUD"},
    "FRAUD_REJECTED_REUSE": {"code": "FRAUD_003_0002", "message": "This screenshot was previously rejected", "status": 409, "category": "FRAUD"},
    "FRAUD_NOT_UPI_PAYMENT": {"code": "FRAUD_002_0008", "message": "Screenshot does not appear to be a UPI payment", "status": 400, "category": "FRAUD"},
    "FRAUD_MISSING_RECIPIENT": {"code": "FRAUD_002_0009", "message": "Payment recipient details not found in screenshot", "status": 400, "category": "FRAUD"},
    "FRAUD_MISSING_TIMESTAMP": {"code": "FRAUD_002_0010", "message": "Payment date/time not found in screenshot", "status": 400, "category": "FRAUD"},
    "PAYMENT_NOT_VERIFIED": {"code": "PAY_001_0007", "message": "Payment not verified. Please complete payment first.", "status": 403, "category": "PAY"},
    "DUPLICATE_IMAGE": {"code": "ERR_DUPLICATE_IMAGE", "message": "This screenshot has already been uploaded by another user.", "status": 409, "category": "FRAUD"},
    "DUPLICATE_IMAGE_SELF": {"code": "ERR_DUPLICATE_IMAGE_SELF", "message": "You already submitted this screenshot. Please use a new payment screenshot.", "status": 409, "category": "FRAUD"},
    "REJECTED_REUSE": {"code": "ERR_REJECTED_REUSE", "message": "This screenshot was previously rejected. Please use a fresh payment screenshot.", "status": 409, "category": "FRAUD"},
    "PAYMENT_REJECTED": {"code": "ERR_PAYMENT_REJECTED", "message": "Payment screenshot could not be verified.", "status": 400, "category": "FRAUD"},
}

# Canonicalize legacy keys to strict modern codes without breaking call sites.
_ERROR_KEY_ALIASES = {
    "DATABASE_ERROR": "SYS_DATABASE_ERROR",
    "INTERNAL_ERROR": "SYS_INTERNAL_ERROR",
    "MISSING_FIELDS": "VAL_MISSING_FIELDS",
    "INVALID_FORMAT": "VAL_INVALID_FORMAT",
    "INVALID_UUID": "VAL_INVALID_REQUEST_ID",
    "RATE_LIMIT": "RATE_LIMIT_EXCEEDED",
    "DESCRIPTION_LENGTH": "VAL_DESC_LENGTH",
    "FEEDBACK_LENGTH": "VAL_FEEDBACK_LENGTH",
    "RATING_INVALID": "VAL_RATING_INVALID",
    "WORD_COUNT": "VAL_WORD_COUNT",
    "DUPLICATE_SUBMISSION": "DUP_SUBMISSION",
    "SURVEY_EXISTS": "DUP_SURVEY_ROUND",
    "PARTICIPANT_EXISTS": "DUP_PUBLIC_ID",
    "CONSENT_REQUIRED": "AUTH_CONSENT_REQUIRED",
    "FLAGGED_ACCOUNT": "AUTH_ACCOUNT_FLAGGED",
    "PARTICIPANT_NOT_FOUND": "NF_PARTICIPANT",
    "NO_IMAGES": "NF_IMAGE",
    "IMAGE_NOT_FOUND": "NF_IMAGE",
    "PAYMENT_NOT_FOUND": "NF_PAYMENT",
    "PAYMENT_EXPIRED": "PAY_EXPIRED",
    "PAYMENT_INVALID_STATE": "PAY_INVALID_STATE",
    "INVALID_AMOUNT": "PAY_INVALID_AMOUNT",
    "INVALID_IMAGE_TYPE": "PAY_INVALID_IMAGE_TYPE",
    "INVALID_SHA256": "PAY_INVALID_SHA256",
    "DUPLICATE_IMAGE": "FRAUD_DUPLICATE_IMAGE",
    "DUPLICATE_IMAGE_SELF": "FRAUD_DUPLICATE_IMAGE_SELF",
    "REJECTED_REUSE": "FRAUD_REJECTED_REUSE",
    "PAYMENT_REJECTED": "FRAUD_MISSING_SUCCESS",
}
for _legacy_key, _canonical_key in _ERROR_KEY_ALIASES.items():
    if _canonical_key in ERROR_CODES:
        ERROR_CODES[_legacy_key] = ERROR_CODES[_canonical_key]


# ────────────────────────────────────────────────
# AWS S3 Configuration
# ────────────────────────────────────────────────

AWS_ACCESS_KEY_ID = os.getenv("AWS_ACCESS_KEY_ID")
if not AWS_ACCESS_KEY_ID:
    raise ValueError("AWS_ACCESS_KEY_ID is required")
AWS_SECRET_ACCESS_KEY = os.getenv("AWS_SECRET_ACCESS_KEY")
if not AWS_SECRET_ACCESS_KEY:
    raise ValueError("AWS_SECRET_ACCESS_KEY is required")
AWS_REGION = os.getenv("AWS_REGION", "ap-south-1")
S3_BUCKET_NAME = os.getenv("S3_BUCKET_NAME", os.getenv("S3_BUCKET", "cognitapi"))


# ────────────────────────────────────────────────
# Security Configuration
# ────────────────────────────────────────────────

IP_HASH_SALT = os.getenv("IP_HASH_SALT")
if not IP_HASH_SALT:
    raise ValueError("IP_HASH_SALT is required")


# ────────────────────────────────────────────────
# Database Configuration
# ────────────────────────────────────────────────

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise ValueError("DATABASE_URL is required")
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)
DATABASE_SSLMODE = os.getenv("DATABASE_SSLMODE", "auto")


# ────────────────────────────────────────────────
# Flask App Configuration
# ────────────────────────────────────────────────

SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    raise ValueError("SECRET_KEY is required")


# ────────────────────────────────────────────────
# CORS Configuration
# ────────────────────────────────────────────────

CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:5173")
CORS_SUPPORTS_CREDENTIALS = os.getenv("CORS_SUPPORTS_CREDENTIALS", "true").lower() == "true"
TRUST_PROXY_HEADERS = os.getenv("TRUST_PROXY_HEADERS", "true").lower() == "true"


# ────────────────────────────────────────────────
# HTTP Security Headers
# ────────────────────────────────────────────────

SECURITY_HSTS_ENABLED = os.getenv("SECURITY_HSTS_ENABLED", "true").lower() == "true"
SECURITY_HSTS_MAX_AGE = int(os.getenv("SECURITY_HSTS_MAX_AGE", "31536000"))
SECURITY_HSTS_INCLUDE_SUBDOMAINS = os.getenv("SECURITY_HSTS_INCLUDE_SUBDOMAINS", "true").lower() == "true"
SECURITY_HSTS_PRELOAD = os.getenv("SECURITY_HSTS_PRELOAD", "false").lower() == "true"
SECURITY_FRAME_OPTIONS = os.getenv("SECURITY_FRAME_OPTIONS", "DENY")
SECURITY_REFERRER_POLICY = os.getenv("SECURITY_REFERRER_POLICY", "strict-origin-when-cross-origin")
SECURITY_PERMISSIONS_POLICY = os.getenv(
    "SECURITY_PERMISSIONS_POLICY",
    "geolocation=(), microphone=(), camera=()"
)
SECURITY_CONTENT_TYPE_OPTIONS = os.getenv("SECURITY_CONTENT_TYPE_OPTIONS", "nosniff")
SECURITY_XSS_PROTECTION = os.getenv("SECURITY_XSS_PROTECTION", "0")


# ────────────────────────────────────────────────
# Rate Limiter Configuration
# ────────────────────────────────────────────────

RATELIMIT_STORAGE_URI = os.getenv("RATELIMIT_STORAGE_URI", "memory://")


# ────────────────────────────────────────────────
# Route Rate Limits & Runtime Tunables
# ────────────────────────────────────────────────

DOCS_BASE_URL = os.getenv("DOCS_BASE_URL", WEBSITE_URL)
FLASK_HOST = os.getenv("FLASK_HOST", "0.0.0.0")
FLASK_PORT = int(os.getenv("FLASK_PORT", os.getenv("PORT", "5000")))
FLASK_DEBUG = os.getenv("FLASK_DEBUG", "true").lower() == "true"

ROOT_RATE_LIMIT = os.getenv("ROOT_RATE_LIMIT", "30 per minute")
DOCS_RATE_LIMIT = os.getenv("DOCS_RATE_LIMIT", "30 per minute")
PARTICIPANT_CREATE_RATE_LIMIT = os.getenv("PARTICIPANT_CREATE_RATE_LIMIT", "30 per minute")
PARTICIPANT_CHECK_RATE_LIMIT = os.getenv("PARTICIPANT_CHECK_RATE_LIMIT", "30 per minute")
CONSENT_RATE_LIMIT = os.getenv("CONSENT_RATE_LIMIT", "20 per minute")
PARTICIPANT_PAYMENT_STATUS_RATE_LIMIT = os.getenv("PARTICIPANT_PAYMENT_STATUS_RATE_LIMIT", "30 per minute")
SUBMIT_RATE_LIMIT = os.getenv("SUBMIT_RATE_LIMIT", "60 per minute")
PAYMENT_CREATE_RATE_LIMIT = os.getenv("PAYMENT_CREATE_RATE_LIMIT", "20 per minute")
PAYMENT_VERIFY_UPLOAD_RATE_LIMIT = os.getenv("PAYMENT_VERIFY_UPLOAD_RATE_LIMIT", "20 per minute")
PAYMENT_STATUS_RATE_LIMIT = os.getenv("PAYMENT_STATUS_RATE_LIMIT", "30 per minute")
ENGAGEMENT_TRACK_RATE_LIMIT = os.getenv("ENGAGEMENT_TRACK_RATE_LIMIT", "120 per minute")

ENGAGEMENT_EVENT_HISTORY_LIMIT = int(os.getenv("ENGAGEMENT_EVENT_HISTORY_LIMIT", "100"))
OFFLINE_ENGAGEMENT_QUEUE_MAX = int(os.getenv("OFFLINE_ENGAGEMENT_QUEUE_MAX", "200"))

IMAGE_PICK_ATTEMPTS_ATTENTION = int(os.getenv("IMAGE_PICK_ATTEMPTS_ATTENTION", "4"))
IMAGE_PICK_ATTEMPTS_NON_ATTENTION = int(os.getenv("IMAGE_PICK_ATTEMPTS_NON_ATTENTION", "8"))
IMAGE_PICK_ATTEMPTS_FALLBACK = int(os.getenv("IMAGE_PICK_ATTEMPTS_FALLBACK", "10"))
