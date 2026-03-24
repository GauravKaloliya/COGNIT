"""
Configuration module for C.O.G.N.I.T. backend.
Centralized configuration management for the active workflow.
"""

import os
from pathlib import Path
from typing import Any, Dict

from app.constants.error_codes import build_error_codes

backend_dir = Path(__file__).parent.parent
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
                os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))
        break


def _required_env(name: str) -> str:
    value = os.getenv(name)
    if value is None or str(value).strip() == "":
        raise ValueError(f"{name} is required")
    return value


def _required_int_env(name: str) -> int:
    return int(_required_env(name))


def _required_float_env(name: str) -> float:
    return float(_required_env(name))


def _required_bool_env(name: str) -> bool:
    raw = _required_env(name).strip().lower()
    if raw in {"true", "1", "yes", "on"}:
        return True
    if raw in {"false", "0", "no", "off"}:
        return False
    raise ValueError(f"{name} must be a boolean value")


def _bool_env(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None or str(raw).strip() == "":
        return bool(default)
    raw = str(raw).strip().lower()
    if raw in {"true", "1", "yes", "on"}:
        return True
    if raw in {"false", "0", "no", "off"}:
        return False
    raise ValueError(f"{name} must be a boolean value")


def _int_env(name: str, default: int, *, min_value: int | None = None, max_value: int | None = None) -> int:
    raw = os.getenv(name)
    value = int(default if raw is None or str(raw).strip() == "" else raw)
    if min_value is not None and value < min_value:
        raise ValueError(f"{name} must be >= {min_value}")
    if max_value is not None and value > max_value:
        raise ValueError(f"{name} must be <= {max_value}")
    return value


def _float_env(name: str, default: float, *, min_value: float | None = None, max_value: float | None = None) -> float:
    raw = os.getenv(name)
    value = float(default if raw is None or str(raw).strip() == "" else raw)
    if min_value is not None and value < min_value:
        raise ValueError(f"{name} must be >= {min_value}")
    if max_value is not None and value > max_value:
        raise ValueError(f"{name} must be <= {max_value}")
    return value


def _str_env(name: str, default: str, *, allow_blank: bool = False, choices: set[str] | None = None) -> str:
    raw = os.getenv(name)
    value = str(default if raw is None else raw).strip()
    if not allow_blank and value == "":
        raise ValueError(f"{name} cannot be blank")
    if choices is not None and value not in choices:
        raise ValueError(f"{name} must be one of: {sorted(choices)}")
    return value


def _validate_url(name: str, value: str) -> None:
    if not value:
        raise ValueError(f"{name} cannot be blank")
    if not (value.startswith("http://") or value.startswith("https://")):
        raise ValueError(f"{name} must start with http:// or https://")


def validate_config() -> None:
    _validate_url("WEBSITE_URL", WEBSITE_URL)
    _validate_url("EMAIL_OTP_WEBHOOK_URL", EMAIL_OTP_WEBHOOK_URL)


MIN_WORD_COUNT = int(os.getenv("MIN_WORD_COUNT", "60"))
MIN_DESCRIPTION_LENGTH = int(os.getenv("MIN_DESCRIPTION_LENGTH", "60"))
MAX_DESCRIPTION_LENGTH = int(os.getenv("MAX_DESCRIPTION_LENGTH", "10000"))
MIN_FEEDBACK_LENGTH = int(os.getenv("MIN_FEEDBACK_LENGTH", "5"))
MAX_FEEDBACK_LENGTH = int(os.getenv("MAX_FEEDBACK_LENGTH", "2000"))
MIN_RATING = int(os.getenv("MIN_RATING", "1"))
MAX_RATING = int(os.getenv("MAX_RATING", "10"))
TOO_FAST_SECONDS = float(os.getenv("TOO_FAST_SECONDS", "5.0"))

ATTENTION_FLAG_THRESHOLD = 0.60
ATTENTION_FLAG_MIN_CHECKS = 3
ATTENTION_HARD_FLAG_CONSEC_FAILS = 2
ATTENTION_MIN_DISTINCT_WORDS = 12
ATTENTION_MIN_CHAR_LENGTH = 120
ATTENTION_INTERVAL = 3
PRIORITY_WORD_THRESHOLD = 500
PRIORITY_ROUNDS_THRESHOLD = 3
PRIORITY_ATTENTION_THRESHOLD = 0.75

PERFORMANCE_LOG_SAMPLE_RATE = 0.10
ENABLE_PERFORMANCE_METRICS = True
MAX_CONTENT_LENGTH_MB = 16

DB_POOL_SIZE = 10
DB_MAX_OVERFLOW = 20
DB_POOL_TIMEOUT_SECONDS = 30
DB_POOL_RECYCLE_SECONDS = 1800
IMAGE_RESERVATION_TTL_SECONDS = 900
API_LATENCY_SLO_MS = 1200
IDEMPOTENCY_TTL_SECONDS = 86400

LOG_LEVEL = "INFO"
LOGGING_AUTO_CONFIG = True
SUPPRESS_ACCESS_LOGS = _bool_env("SUPPRESS_ACCESS_LOGS", True)
WEBSITE_URL = _required_env("WEBSITE_URL")
_default_cookie_secure = bool(WEBSITE_URL.lower().startswith("https://"))
SESSION_COOKIE_SECURE = _bool_env("SESSION_COOKIE_SECURE", _default_cookie_secure)
SESSION_COOKIE_SAMESITE = _str_env(
    "SESSION_COOKIE_SAMESITE",
    "None" if SESSION_COOKIE_SECURE else "Lax",
    choices={"Lax", "Strict", "None"},
)
PARTICIPANT_SESSION_COOKIE_NAME = "cognit_session"
PARTICIPANT_PUBLIC_COOKIE_NAME = "cognit_public_id"

EMAIL_OTP_LENGTH = _required_int_env("EMAIL_OTP_LENGTH")
EMAIL_OTP_EXPIRY_SECONDS = _required_int_env("EMAIL_OTP_EXPIRY_SECONDS")
EMAIL_OTP_MAX_ATTEMPTS = _required_int_env("EMAIL_OTP_MAX_ATTEMPTS")
EMAIL_OTP_WEBHOOK_URL = _required_env("EMAIL_OTP_WEBHOOK_URL")
EMAIL_OTP_SENDER = _required_env("EMAIL_OTP_SENDER")
EMAIL_OTP_SUBJECT = _required_env("EMAIL_OTP_SUBJECT")
EMAIL_OTP_HTML_TEMPLATE = _required_env("EMAIL_OTP_HTML_TEMPLATE")
EMAIL_OTP_WEBHOOK_TIMEOUT_SECONDS = _int_env("EMAIL_OTP_WEBHOOK_TIMEOUT_SECONDS", 15, min_value=1, max_value=30)
EMAIL_OTP_JWT_SECRET = _required_env("EMAIL_OTP_JWT_SECRET")
EMAIL_OTP_JWT_TTL_SECONDS = _int_env("EMAIL_OTP_JWT_TTL_SECONDS", 3600, min_value=60, max_value=86400)

TURNSTILE_ENABLED = _required_bool_env("TURNSTILE_ENABLED")
TURNSTILE_SECRET_KEY = os.getenv("TURNSTILE_SECRET_KEY", "")
if TURNSTILE_ENABLED and not TURNSTILE_SECRET_KEY:
    raise ValueError("TURNSTILE_SECRET_KEY is required when TURNSTILE_ENABLED=true")
TURNSTILE_VERIFY_URL = _required_env("TURNSTILE_VERIFY_URL")
TURNSTILE_TIMEOUT_SECONDS = _required_float_env("TURNSTILE_TIMEOUT_SECONDS")
TURNSTILE_BYPASS_LOCAL = _bool_env("TURNSTILE_BYPASS_LOCAL", False)

_raw_extensions = os.getenv("ALLOWED_IMAGE_EXTENSIONS", "jpg,jpeg,png,webp")
ALLOWED_IMAGE_EXTENSIONS = {ext.strip().lower() for ext in _raw_extensions.split(",")}
CONTENT_TYPE_MAP = {
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "png": "image/png",
    "webp": "image/webp",
}
IMAGE_VALIDATE_URL_AVAILABILITY = _bool_env("IMAGE_VALIDATE_URL_AVAILABILITY", False)

ENABLE_DUPLICATE_DETECTION = _bool_env("ENABLE_DUPLICATE_DETECTION", True)
ENABLE_DEVICE_FINGERPRINTING = _bool_env("ENABLE_DEVICE_FINGERPRINTING", True)
ENABLE_AUDIT_LOGGING = _bool_env("ENABLE_AUDIT_LOGGING", True)
ENABLE_ERROR_LOGGING = _bool_env("ENABLE_ERROR_LOGGING", True)
DEVICE_FINGERPRINT_SALTS = _str_env("DEVICE_FINGERPRINT_SALTS", "cognit_fingerprint_salt_2024")

ERROR_CODES: Dict[str, Dict[str, Any]] = build_error_codes(
    min_description_length=MIN_DESCRIPTION_LENGTH,
    max_description_length=MAX_DESCRIPTION_LENGTH,
    min_feedback_length=MIN_FEEDBACK_LENGTH,
    max_feedback_length=MAX_FEEDBACK_LENGTH,
    min_rating=MIN_RATING,
    max_rating=MAX_RATING,
    min_word_count=MIN_WORD_COUNT,
)

AWS_ACCESS_KEY_ID = _required_env("AWS_ACCESS_KEY_ID")
AWS_SECRET_ACCESS_KEY = _required_env("AWS_SECRET_ACCESS_KEY")
AWS_REGION = os.getenv("AWS_REGION", "ap-south-1")
S3_BUCKET_NAME = _required_env("S3_BUCKET_NAME")

IP_HASH_SALT = _required_env("IP_HASH_SALT")

DATABASE_URL = _required_env("DATABASE_URL")
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)
DATABASE_SSLMODE = _str_env(
    "DATABASE_SSLMODE",
    "auto",
    choices={"auto", "disable", "allow", "prefer", "require", "verify-ca", "verify-full"},
)

SECRET_KEY = _required_env("SECRET_KEY")
CORS_ORIGINS = _str_env("CORS_ORIGINS", "http://localhost:3000,http://localhost:5173")
CORS_SUPPORTS_CREDENTIALS = _bool_env("CORS_SUPPORTS_CREDENTIALS", True)
TRUST_PROXY_HEADERS = _bool_env("TRUST_PROXY_HEADERS", True)

SECURITY_HSTS_ENABLED = True
SECURITY_HSTS_MAX_AGE = 31536000
SECURITY_HSTS_INCLUDE_SUBDOMAINS = True
SECURITY_HSTS_PRELOAD = False
SECURITY_FRAME_OPTIONS = "DENY"
SECURITY_REFERRER_POLICY = "strict-origin-when-cross-origin"
SECURITY_PERMISSIONS_POLICY = "geolocation=(self), microphone=(), camera=()"
SECURITY_CONTENT_TYPE_OPTIONS = "nosniff"
SECURITY_XSS_PROTECTION = "0"

RATELIMIT_STORAGE_URI = _required_env("RATELIMIT_STORAGE_URI")

DOCS_BASE_URL = _str_env("DOCS_BASE_URL", WEBSITE_URL)
PORT = _int_env("PORT", 5000, min_value=1, max_value=65535)
FLASK_DEBUG = _bool_env("FLASK_DEBUG", True)

ROOT_RATE_LIMIT = "60 per minute"
DOCS_RATE_LIMIT = "30 per minute"
HEALTH_RATE_LIMIT = "20 per minute"
PARTICIPANT_CREATE_RATE_LIMIT = "20 per minute"
PARTICIPANT_CHECK_RATE_LIMIT = "60 per minute"
CONSENT_RATE_LIMIT = "20 per minute"
SUBMIT_RATE_LIMIT = "20 per minute"
EMAIL_OTP_REQUEST_RATE_LIMIT = "10 per hour"
EMAIL_OTP_VERIFY_RATE_LIMIT = "12 per minute"

IMAGE_PICK_ATTEMPTS_ATTENTION = _int_env("IMAGE_PICK_ATTEMPTS_ATTENTION", 4, min_value=1, max_value=50)
IMAGE_PICK_ATTEMPTS_NON_ATTENTION = _int_env("IMAGE_PICK_ATTEMPTS_NON_ATTENTION", 4, min_value=1, max_value=50)
FORCE_ATTENTION_IMAGES = _required_bool_env("FORCE_ATTENTION_IMAGES")

validate_config()
