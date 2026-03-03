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

from app.config import SECRET_KEY, CORS_ORIGINS, CORS_SUPPORTS_CREDENTIALS, RATELIMIT_STORAGE_URI, LOG_LEVEL
from app.config import AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION


# ────────────────────────────────────────────────
# Flask Application
# ────────────────────────────────────────────────

template_dir = os.path.join(os.path.dirname(__file__), '..', 'templates')

app = Flask(__name__, template_folder=template_dir)
app.url_map.strict_slashes = False
app.config["SECRET_KEY"] = SECRET_KEY
app.config["SESSION_COOKIE_SECURE"] = True
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "None"
app.config["MAX_CONTENT_LENGTH"] = 1 * 1024 * 1024


# ────────────────────────────────────────────────
# CORS Configuration
# ────────────────────────────────────────────────

cors_origins = [origin.strip() for origin in CORS_ORIGINS.split(",")]
CORS(
    app,
    resources={r"/*": {"origins": cors_origins}},
    supports_credentials=CORS_SUPPORTS_CREDENTIALS
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