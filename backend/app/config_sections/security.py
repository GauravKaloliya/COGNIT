"""Security, identity, cookie, CORS and turnstile config section."""

from __future__ import annotations

from .env import bool_env, required_bool_env, required_env, required_float_env, str_env


WEBSITE_URL = required_env("WEBSITE_URL")
_default_cookie_secure = bool(WEBSITE_URL.lower().startswith("https://"))
SESSION_COOKIE_SECURE = _default_cookie_secure
SESSION_COOKIE_SAMESITE = "None" if SESSION_COOKIE_SECURE else "Lax"
PARTICIPANT_SESSION_COOKIE_NAME = "cognit_session"
PARTICIPANT_PUBLIC_COOKIE_NAME = "cognit_public_id"
PARTICIPANT_SESSION_STALE_TTL_SECONDS = 60

TURNSTILE_ENABLED = required_bool_env("TURNSTILE_ENABLED")
TURNSTILE_SECRET_KEY = required_env("TURNSTILE_SECRET_KEY") if TURNSTILE_ENABLED else ""
TURNSTILE_VERIFY_URL = required_env("TURNSTILE_VERIFY_URL")
TURNSTILE_TIMEOUT_SECONDS = required_float_env("TURNSTILE_TIMEOUT_SECONDS")

SECRET_KEY = required_env("SECRET_KEY")
IP_HASH_SALT = required_env("IP_HASH_SALT")
CORS_ORIGINS = str_env("CORS_ORIGINS", "http://localhost:3000,http://localhost:5173")
CORS_SUPPORTS_CREDENTIALS = bool_env("CORS_SUPPORTS_CREDENTIALS", True)
TRUST_PROXY_HEADERS = bool_env("TRUST_PROXY_HEADERS", True)
RATELIMIT_STORAGE_URI = required_env("RATELIMIT_STORAGE_URI")

SECURITY_HSTS_ENABLED = True
SECURITY_HSTS_MAX_AGE = 31536000
SECURITY_HSTS_INCLUDE_SUBDOMAINS = True
SECURITY_HSTS_PRELOAD = False
SECURITY_FRAME_OPTIONS = "DENY"
SECURITY_REFERRER_POLICY = "strict-origin-when-cross-origin"
SECURITY_PERMISSIONS_POLICY = "geolocation=(self), microphone=(), camera=()"
SECURITY_CONTENT_TYPE_OPTIONS = "nosniff"
SECURITY_XSS_PROTECTION = "0"
