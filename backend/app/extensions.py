"""
Extensions module for C.O.G.N.I.T. backend.
Initializes and configures Flask extensions following application factory pattern.
"""

import os
import boto3
from flask import Flask
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from redis import Redis
from werkzeug.middleware.proxy_fix import ProxyFix

from app.config import (
    CACHE_REDIS_URL,
    SECRET_KEY,
    CORS_ORIGINS,
    CORS_SUPPORTS_CREDENTIALS,
    RATELIMIT_STORAGE_URI,
    MAX_CONTENT_LENGTH_MB,
    SESSION_COOKIE_SECURE,
    SESSION_COOKIE_SAMESITE,
)
from app.config import AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION
from app.config import TRUST_PROXY_HEADERS


# ────────────────────────────────────────────────
# Flask Application
# ────────────────────────────────────────────────

template_dir = os.path.join(os.path.dirname(__file__), '..', 'templates')

app = Flask(__name__, template_folder=template_dir)
app.url_map.strict_slashes = False
if TRUST_PROXY_HEADERS:
    # Required on Vercel/edge proxies so client IP/scheme are interpreted correctly.
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_port=1)
app.config["SECRET_KEY"] = SECRET_KEY
app.config["SESSION_COOKIE_SECURE"] = bool(SESSION_COOKIE_SECURE)
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = SESSION_COOKIE_SAMESITE
app.config["MAX_CONTENT_LENGTH"] = MAX_CONTENT_LENGTH_MB * 1024 * 1024


# ────────────────────────────────────────────────
# CORS Configuration
# ────────────────────────────────────────────────

cors_origins = [origin.strip() for origin in CORS_ORIGINS.split(",") if origin.strip()]
if not cors_origins:
    cors_origins = ["*"]
supports_credentials = CORS_SUPPORTS_CREDENTIALS and "*" not in cors_origins
CORS(
    app,
    resources={r"/*": {"origins": cors_origins}},
    supports_credentials=supports_credentials,
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=[
        "Content-Type",
        "Authorization",
        "X-Request-ID",
        "X-Idempotency-Key",
        "X-Connectivity-Probe",
    ],
    expose_headers=["X-Request-ID"],
    max_age=86400,
)


# ────────────────────────────────────────────────
# Rate Limiter
# ────────────────────────────────────────────────

limiter = Limiter(
    app=app,
    key_func=get_remote_address,
    default_limits=["200 per day", "50 per hour"],
    storage_uri=RATELIMIT_STORAGE_URI
)


# ────────────────────────────────────────────────
# S3 Client
# ────────────────────────────────────────────────

s3 = boto3.client(
    "s3",
    region_name=AWS_REGION,
    aws_access_key_id=AWS_ACCESS_KEY_ID,
    aws_secret_access_key=AWS_SECRET_ACCESS_KEY,
)

cache_redis = Redis.from_url(CACHE_REDIS_URL, decode_responses=True) if CACHE_REDIS_URL else None
