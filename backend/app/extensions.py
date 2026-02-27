"""
Extensions module for C.O.G.N.I.T. backend.
Initializes and configures Flask extensions following application factory pattern.
"""

import boto3
from flask import Flask
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

from app.config import SECRET_KEY, CORS_ORIGINS, RATELIMIT_STORAGE_URI
from app.config import AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, LOG_LEVEL


# ────────────────────────────────────────────────
# Flask Application
# ────────────────────────────────────────────────

import os
template_dir = os.path.join(os.path.dirname(__file__), '..', 'templates')
import logging

app = Flask(__name__, template_folder=template_dir)
app.url_map.strict_slashes = False
app.config["SECRET_KEY"] = SECRET_KEY
app.logger.setLevel(getattr(logging, LOG_LEVEL.upper(), logging.INFO))
app.config["SESSION_COOKIE_SECURE"] = True
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["MAX_CONTENT_LENGTH"] = 1 * 1024 * 1024


# ────────────────────────────────────────────────
# CORS Configuration
# ────────────────────────────────────────────────

cors_origins = CORS_ORIGINS
if cors_origins != "*":
    cors_origins = [origin.strip() for origin in cors_origins.split(",")]
CORS(app, resources={r"/*": {"origins": cors_origins}})


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