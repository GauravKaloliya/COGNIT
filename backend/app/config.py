"""
Configuration module for C.O.G.N.I.T. backend.
Centralized configuration management following 2025 best practices.
"""

import os
from typing import Dict, Any

from pathlib import Path
backend_dir = Path(__file__).parent.parent
env_file = backend_dir / ".env"

try:
    from dotenv import load_dotenv
    load_dotenv(env_file)
except ImportError:
    pass


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
PRIORITY_WORD_THRESHOLD = int(os.getenv("PRIORITY_WORD_THRESHOLD", "500"))
PRIORITY_ROUNDS_THRESHOLD = int(os.getenv("PRIORITY_ROUNDS_THRESHOLD", "3"))
PRIORITY_ATTENTION_THRESHOLD = float(os.getenv("PRIORITY_ATTENTION_THRESHOLD", "0.75"))
PRIORITY_MIN_SUBMISSIONS = int(os.getenv("PRIORITY_MIN_SUBMISSIONS", "3"))
SURVEY_ROUNDS = int(os.getenv("SURVEY_ROUNDS", "1"))

PERFORMANCE_LOG_SAMPLE_RATE = float(os.getenv("PERFORMANCE_LOG_SAMPLE_RATE", "0.10"))

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


# ────────────────────────────────────────────────
# UPI Screenshot Validation Configuration
# ────────────────────────────────────────────────

ALLOWED_APPS: Dict[str, list] = {
    "gpay": ["gpay", "google pay", "tez"],
    "phonepe": ["phonepe"],
    "paytm": ["paytm"],
    "bhim": ["bhim"],
    "amazonpay": ["amazon pay", "amazonpay"],
    "bharatpe": ["bharatpe"]
}

SUCCESS_KEYWORDS = ["success", "successful", "completed", "paid", "payment successful", "transaction successful"]
FAILURE_KEYWORDS = ["failed", "pending", "declined", "cancelled"]
MIN_OCR_CONFIDENCE = int(os.getenv("MIN_OCR_CONFIDENCE", "55"))
MIN_IMAGE_WIDTH = int(os.getenv("MIN_IMAGE_WIDTH", "600"))


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
    "FRAUD_NOT_UPI_PAYMENT": {"code": "FRAUD_002_0008", "message": "Screenshot does not appear to be a UPI payment", "status": 400, "category": "FRAUD"},
    "FRAUD_MISSING_RECIPIENT": {"code": "FRAUD_002_0009", "message": "Payment recipient details not found in screenshot", "status": 400, "category": "FRAUD"},
    "FRAUD_MISSING_TIMESTAMP": {"code": "FRAUD_002_0010", "message": "Payment date/time not found in screenshot", "status": 400, "category": "FRAUD"},
    "PAYMENT_NOT_VERIFIED": {"code": "PAY_001_0007", "message": "Payment not verified. Please complete payment first.", "status": 403, "category": "PAY"},
    "DUPLICATE_IMAGE": {"code": "ERR_DUPLICATE_IMAGE", "message": "This screenshot has already been uploaded by another user.", "status": 409, "category": "FRAUD"},
    "REJECTED_REUSE": {"code": "ERR_REJECTED_REUSE", "message": "This screenshot was previously rejected. Please use a fresh payment screenshot.", "status": 409, "category": "FRAUD"},
    "DUPLICATE_TXN": {"code": "ERR_DUPLICATE_TXN", "message": "This transaction has already been used. Each payment must be unique.", "status": 409, "category": "FRAUD"},
    "PAYMENT_REJECTED": {"code": "ERR_PAYMENT_REJECTED", "message": "Payment screenshot could not be verified.", "status": 400, "category": "FRAUD"},
}


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


# ────────────────────────────────────────────────
# Flask App Configuration
# ────────────────────────────────────────────────

SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    raise ValueError("SECRET_KEY is required")


# ────────────────────────────────────────────────
# CORS Configuration
# ────────────────────────────────────────────────

CORS_ORIGINS = os.getenv("CORS_ORIGINS", "*")


# ────────────────────────────────────────────────
# Rate Limiter Configuration
# ────────────────────────────────────────────────

RATELIMIT_STORAGE_URI = os.getenv("RATELIMIT_STORAGE_URI", "memory://")
