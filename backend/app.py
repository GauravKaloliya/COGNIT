import hashlib
import os
import random
import re
import time
import functools
from datetime import datetime, timezone, timedelta
from contextlib import contextmanager

import requests

from flask import Flask, jsonify, request, abort, g, render_template, send_from_directory, send_file
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from sqlalchemy import create_engine, text, event, Column, Integer, String, Boolean, Float, TIMESTAMP, CheckConstraint, ForeignKey
from sqlalchemy.orm import sessionmaker, scoped_session, declarative_base
from sqlalchemy.pool import QueuePool, NullPool
from pathlib import Path


# Image directory configuration
IMAGES_DIR = Path(__file__).parent / "images"

MIN_WORD_COUNT = int(os.getenv("MIN_WORD_COUNT", "60"))
TOO_FAST_SECONDS = float(os.getenv("TOO_FAST_SECONDS", "5"))
IP_HASH_SALT = os.getenv("IP_HASH_SALT", "local-salt")

# UPI Payment Configuration (required)
UPI_ID = os.getenv("UPI_ID")
UPI_PAYEE_NAME = os.getenv("UPI_PAYEE_NAME")
PAYMENT_AMOUNT = int(os.getenv("PAYMENT_AMOUNT", "100"))  # Amount in paise (₹1 = 100)

# AWS S3 Configuration (required for image uploads)
AWS_ACCESS_KEY_ID = os.getenv("AWS_ACCESS_KEY_ID")
AWS_SECRET_ACCESS_KEY = os.getenv("AWS_SECRET_ACCESS_KEY")
AWS_REGION = os.getenv("AWS_REGION", "us-east-1")
S3_BUCKET_NAME = os.getenv("S3_BUCKET_NAME")
S3_PAYMENT_PROOFS_PREFIX = os.getenv("S3_PAYMENT_PROOFS_PREFIX", "payment-proofs/")

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise ValueError("DATABASE_URL environment variable is required")

if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

WEBSITE_URL = os.getenv("WEBSITE_URL", "").strip()
IS_VERCEL = os.getenv("VERCEL_ENV") is not None

app = Flask(__name__)

# Disable strict slashes to prevent 308 redirects (fixes CORS preflight issues)
app.url_map.strict_slashes = False

app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'local-secret-key')
app.config['SESSION_COOKIE_SECURE'] = True
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['PERMANENT_SESSION_LIFETIME'] = 1800
app.config['MAX_CONTENT_LENGTH'] = 1 * 1024 * 1024

app.config['SQLALCHEMY_DATABASE_URI'] = DATABASE_URL
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
if IS_VERCEL:
    app.config['SQLALCHEMY_ENGINE_OPTIONS'] = {
        'pool_pre_ping': True,
        'poolclass': NullPool
    }
else:
    app.config['SQLALCHEMY_ENGINE_OPTIONS'] = {
        'pool_size': 10,
        'pool_recycle': 3600,
        'pool_pre_ping': True,
        'max_overflow': 20,
        'poolclass': QueuePool
    }

def _get_cors_origins():
    env_origins = os.getenv("CORS_ORIGINS", "").strip()
    if not env_origins:
        app.logger.warning("CORS_ORIGINS is not set. CORS will be disabled for all origins.")
        return []

    origins = [origin.strip() for origin in env_origins.split(",") if origin.strip()]
    # Security: Never allow wildcard origins
    if "*" in origins:
        raise ValueError("Wildcard CORS origins ('*') are not allowed. Use specific domains only.")
    return origins

CORS(app, resources={
    r"/*": {
        "origins": _get_cors_origins(),
        "methods": ["GET", "POST", "OPTIONS"],
        "allow_headers": ["Content-Type", "Authorization", "X-Requested-With"],
        "supports_credentials": False,
        "max_age": 86400,
        "automatic_options": True  # Automatically handle OPTIONS requests
    }
})

env_storage_uri = os.getenv("RATELIMIT_STORAGE_URI", "").strip()

if env_storage_uri:
    if env_storage_uri.startswith("redis://") or env_storage_uri.startswith("rediss://"):
        from urllib.parse import urlparse, urlunparse
        parsed = urlparse(env_storage_uri)
        storage_uri = urlunparse(parsed._replace(path="/0"))
        app.logger.info(f"Using Redis with forced database 0: {storage_uri}")
    else:
        storage_uri = env_storage_uri
else:
    storage_uri = "memory://"
    app.logger.info("Using memory storage for rate limiting")

def _validate_rate_limit_storage(uri: str) -> str:
    if uri.startswith(("redis://", "rediss://", "redis+unix://", "valkey://", "valkeys://", "valkey+unix://")):
        try:
            from limits.storage import storage_from_string
            storage = storage_from_string(uri)
            if hasattr(storage, "get_connection"):
                storage.get_connection().ping()
            return uri
        except Exception as exc:
            app.logger.warning(f"Rate limit storage unavailable ({exc}); using memory storage")
            return "memory://"
    return uri

storage_uri = _validate_rate_limit_storage(storage_uri)

try:
    limiter = Limiter(
        app=app,
        key_func=get_remote_address,
        default_limits=["200 per day", "50 per hour"],
        storage_uri=storage_uri
    )
    actual_storage_uri = storage_uri
    app.logger.info(f"Rate limiter initialized with storage: {actual_storage_uri}")
except Exception as e:
    app.logger.warning(f"Failed to initialize rate limiter: {e}")
    limiter = Limiter(
        app=app,
        key_func=get_remote_address,
        default_limits=["200 per day", "50 per hour"],
        storage_uri="memory://"
    )
    actual_storage_uri = "memory://"

@app.after_request
def add_security_headers(response):
    # Add CORS headers to all responses (including errors and redirects)
    origin = request.headers.get('Origin')
    allowed_origins = _get_cors_origins()
    if origin and origin in allowed_origins:
        response.headers['Access-Control-Allow-Origin'] = origin
        response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
        response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, X-Requested-With'
        response.headers['Access-Control-Max-Age'] = '86400'

    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['X-Permitted-Cross-Domain-Policies'] = 'none'
    response.headers['X-Download-Options'] = 'noopen'
    response.headers['X-DNS-Prefetch-Control'] = 'off'
    response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: http:; font-src 'self'; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'"
    response.headers['Strict-Transport-Security'] = 'max-age=63072000; includeSubDomains; preload'
    response.headers['Referrer-Policy'] = 'no-referrer'
    response.headers['Permissions-Policy'] = 'geolocation=(), microphone=(), camera=(), payment=()'
    response.headers['Server'] = 'Secure Server'
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, proxy-revalidate'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    return response

engine_options = {
    "pool_pre_ping": True,
    "echo": False
}
if IS_VERCEL:
    engine_options["poolclass"] = NullPool
else:
    engine_options.update({
        "poolclass": QueuePool,
        "pool_size": 10,
        "max_overflow": 20,
        "pool_recycle": 3600
    })

engine = create_engine(DATABASE_URL, **engine_options)
SessionLocal = scoped_session(sessionmaker(autocommit=False, autoflush=False, bind=engine))
Base = declarative_base()

def get_db():
    if 'db' not in g:
        g.db = SessionLocal()
    return g.db

@app.teardown_appcontext
def close_db(exception):
    db = g.pop('db', None)
    if db is not None:
        db.close()
        SessionLocal.remove()

def get_ip_hash():
    ip_address = request.headers.get("X-Forwarded-For", request.remote_addr) or "unknown"
    digest = hashlib.sha256(f"{ip_address}{IP_HASH_SALT}".encode("utf-8")).hexdigest()
    return digest

def generate_payment_reference(participant_id: str) -> str:
    base = f"{participant_id}_{int(time.time())}"
    short_hash = hashlib.sha256(base.encode()).hexdigest()[:12]
    return f"COGNIT_{short_hash.upper()}"


def generate_upi_qr_url(upi_id: str, payee_name: str, amount: int, transaction_note: str) -> str:
    """Generate UPI QR code URL using the UPI protocol."""
    # UPI URL format: upi://pay?pa=UPI_ID&pn=PAYEE_NAME&am=AMOUNT&tn=TRANSACTION_NOTE
    import urllib.parse
    params = {
        'pa': upi_id,
        'pn': payee_name,
        'am': f"{amount / 100:.2f}",
        'tn': transaction_note
    }
    query = urllib.parse.urlencode(params)
    return f"upi://pay?{query}"


def extract_utr_from_image(image_data: bytes) -> dict:
    """
    Extract UTR (Unique Transaction Reference) from payment screenshot using OCR.
    Returns dict with 'utr' (str or None), 'confidence' (float), and 'raw_text' (str).
    """
    try:
        from PIL import Image
        import pytesseract
        import io
        import re

        # Load image from bytes
        image = Image.open(io.BytesIO(image_data))

        # Convert to RGB if necessary
        if image.mode != 'RGB':
            image = image.convert('RGB')

        # Perform OCR
        raw_text = pytesseract.image_to_string(image)

        # Common UTR patterns in Indian UPI apps
        utr_patterns = [
            r'UTR[\s:]*([A-Z0-9]{12,22})',
            r'UPI[\s-]*REF[\s:]*([A-Z0-9]{12,22})',
            r'Reference[\s:]*([A-Z0-9]{12,22})',
            r'Transaction[\s-]*ID[\s:]*([A-Z0-9]{12,22})',
            r'Txn[\s-]*ID[\s:]*([A-Z0-9]{12,22})',
            r'Order[\s-]*ID[\s:]*([A-Z0-9]{12,22})',
            r'([A-Z0-9]{16,20})',  # Generic long alphanumeric pattern (fallback)
        ]

        for pattern in utr_patterns:
            match = re.search(pattern, raw_text, re.IGNORECASE)
            if match:
                utr = match.group(1).strip()
                # Validate UTR length (typically 12-22 characters)
                if 12 <= len(utr) <= 22:
                    return {
                        'utr': utr,
                        'confidence': 0.85,
                        'raw_text': raw_text[:500]  # First 500 chars for debugging
                    }

        # No UTR found
        return {
            'utr': None,
            'confidence': 0.0,
            'raw_text': raw_text[:500]
        }

    except Exception as e:
        app.logger.error(f"OCR extraction failed: {e}")
        return {
            'utr': None,
            'confidence': 0.0,
            'raw_text': f"Error: {str(e)}"
        }


def upload_to_s3(image_data: bytes, participant_id: str, payment_reference: str) -> dict:
    """
    Upload payment screenshot to AWS S3.
    Returns dict with 'success' (bool), 'url' (str), and 'key' (str).
    """
    if not all([AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, S3_BUCKET_NAME]):
        return {
            'success': False,
            'error': 'S3 not configured',
            'url': None,
            'key': None
        }

    try:
        import boto3
        from botocore.exceptions import ClientError

        s3_client = boto3.client(
            's3',
            aws_access_key_id=AWS_ACCESS_KEY_ID,
            aws_secret_access_key=AWS_SECRET_ACCESS_KEY,
            region_name=AWS_REGION
        )

        # Generate unique file key
        timestamp = int(time.time())
        file_extension = 'png'  # Default, will be detected from image
        try:
            from PIL import Image
            import io
            img = Image.open(io.BytesIO(image_data))
            file_extension = img.format.lower() if img.format else 'png'
        except:
            file_extension = 'png'

        file_key = f"{S3_PAYMENT_PROOFS_PREFIX}{participant_id}/{payment_reference}_{timestamp}.{file_extension}"

        # Upload to S3
        s3_client.put_object(
            Bucket=S3_BUCKET_NAME,
            Key=file_key,
            Body=image_data,
            ContentType=f'image/{file_extension}',
            Metadata={
                'participant-id': participant_id,
                'payment-reference': payment_reference,
                'upload-timestamp': str(timestamp)
            }
        )

        # Generate URL (not presigned - assumes bucket policy allows read)
        s3_url = f"https://{S3_BUCKET_NAME}.s3.{AWS_REGION}.amazonaws.com/{file_key}"

        return {
            'success': True,
            'url': s3_url,
            'key': file_key
        }

    except ClientError as e:
        app.logger.error(f"S3 upload failed: {e}")
        return {
            'success': False,
            'error': str(e),
            'url': None,
            'key': None
        }
    except Exception as e:
        app.logger.error(f"S3 upload unexpected error: {e}")
        return {
            'success': False,
            'error': str(e),
            'url': None,
            'key': None
        }


def _get_or_create_participant_fk(db, participant_id):
    result = db.execute(text("SELECT id FROM participants WHERE participant_id = :participant_id"),
                       {"participant_id": participant_id})
    row = result.fetchone()
    if row:
        return row[0]
    return None

def _update_participant_stats_internal(db, participant_fk, participant_id, word_count, is_survey, attention_score=None):
    try:
        result = db.execute(text('''
            SELECT total_words, total_submissions, survey_rounds, attention_score
            FROM participant_stats
            WHERE participant_fk = :participant_fk
        '''), {"participant_fk": participant_fk})
        row = result.fetchone()

        if row:
            new_words = row[0] + word_count
            new_submissions = row[1] + 1
            new_survey_rounds = row[2] + (1 if is_survey else 0)
            current_attention_score = attention_score if attention_score is not None else row[3]
        else:
            new_words = word_count
            new_submissions = 1
            new_survey_rounds = 1 if is_survey else 0
            current_attention_score = attention_score if attention_score is not None else 1.0

        priority_eligible = (new_words >= 500 or new_survey_rounds >= 3) and current_attention_score >= 0.75

        db.execute(text('''
            INSERT INTO participant_stats
            (participant_fk, participant_id, total_words, total_submissions, survey_rounds, priority_eligible, attention_score)
            VALUES (:participant_fk, :participant_id, :total_words, :total_submissions, :survey_rounds, :priority_eligible, :attention_score)
            ON CONFLICT(participant_fk) DO UPDATE SET
            total_words = EXCLUDED.total_words,
            total_submissions = EXCLUDED.total_submissions,
            survey_rounds = EXCLUDED.survey_rounds,
            priority_eligible = EXCLUDED.priority_eligible,
            attention_score = EXCLUDED.attention_score
        '''), {
            "participant_fk": participant_fk,
            "participant_id": participant_id,
            "total_words": new_words,
            "total_submissions": new_submissions,
            "survey_rounds": new_survey_rounds,
            "priority_eligible": priority_eligible,
            "attention_score": current_attention_score
        })
    except Exception as e:
        pass

def update_participant_stats(participant_fk, participant_id, word_count, is_survey, attention_score=None):
    try:
        db = get_db()
        _update_participant_stats_internal(db, participant_fk, participant_id, word_count, is_survey, attention_score)
        db.commit()
    except Exception as e:
        pass

def get_reward_eligibility(participant_fk):
    try:
        db = get_db()
        result = db.execute(text('''
            SELECT reward_amount, status FROM reward_winners WHERE participant_fk = :participant_fk
        '''), {"participant_fk": participant_fk})
        winner_row = result.fetchone()

        if winner_row:
            return {"is_winner": True, "reward_amount": winner_row[0], "status": winner_row[1]}

        result = db.execute(text('''
            SELECT total_words, survey_rounds, priority_eligible
            FROM participant_stats
            WHERE participant_fk = :participant_fk
        '''), {"participant_fk": participant_fk})
        stats_row = result.fetchone()

        if stats_row:
            return {
                "is_winner": False,
                "total_words": stats_row[0],
                "survey_rounds": stats_row[1],
                "priority_eligible": bool(stats_row[2])
            }

        return {"is_winner": False, "total_words": 0, "survey_rounds": 0, "priority_eligible": False}
    except Exception as e:
        return {"is_winner": False, "total_words": 0, "survey_rounds": 0, "priority_eligible": False, "error": str(e)}

def select_reward_winner(participant_id):
    try:
        db = get_db()
        result = db.execute(text('SELECT id FROM participants WHERE participant_id = :participant_id'), {"participant_id": participant_id})
        participant_row = result.fetchone()
        if not participant_row:
            return {"selected": False, "error": "Participant not found"}
        participant_fk = participant_row[0]

        result = db.execute(text('SELECT participant_fk FROM reward_winners WHERE participant_fk = :participant_fk'), {"participant_fk": participant_fk})
        if result.fetchone():
            return {"selected": False, "already_winner": True}

        result = db.execute(text('''
            SELECT last_reward_attempt_at FROM participant_stats WHERE participant_fk = :participant_fk
        '''), {"participant_fk": participant_fk})
        stats_row = result.fetchone()

        if stats_row and stats_row[0]:
            last_attempt = stats_row[0]
            if isinstance(last_attempt, str):
                last_attempt = datetime.fromisoformat(last_attempt.replace('Z', '+00:00'))
            cooldown_seconds = 60
            time_since_last = (datetime.now(timezone.utc) - last_attempt).total_seconds()
            if time_since_last < cooldown_seconds:
                return {"selected": False, "cooldown_active": True, "retry_after": cooldown_seconds - int(time_since_last)}

        priority_eligible = bool(stats_row[0]) if stats_row else False

        result = db.execute(text('''
            SELECT attention_score FROM participant_stats WHERE participant_fk = :participant_fk
        '''), {"participant_fk": participant_fk})
        attention_row = result.fetchone()
        attention_score = attention_row[0] if attention_row and attention_row[0] is not None else 1.0

        db.execute(text('''
            INSERT INTO participant_stats (participant_fk, participant_id, last_reward_attempt_at)
            VALUES (:participant_fk, :participant_id, CURRENT_TIMESTAMP)
            ON CONFLICT(participant_fk) DO UPDATE SET
            last_reward_attempt_at = CURRENT_TIMESTAMP
        '''), {"participant_fk": participant_fk, "participant_id": participant_id})

        base_probability = 0.05
        priority_boost = 0.10 if priority_eligible else 0.0
        attention_penalty = 0.0 if attention_score >= 0.75 else -0.15
        selection_probability = max(0.01, base_probability + priority_boost + attention_penalty)

        if random.random() < selection_probability:
            db.execute(text('''
                INSERT INTO reward_winners (participant_fk, participant_id, reward_amount, status)
                VALUES (:participant_fk, :participant_id, 10, 'pending')
            '''), {"participant_fk": participant_fk, "participant_id": participant_id})
            db.commit()
            return {"selected": True, "reward_amount": 10}

        db.commit()
        return {"selected": False, "priority_eligible": priority_eligible}
    except Exception as e:
        db.rollback()
        return {"selected": False, "error": str(e)}

def count_words(text: str):
    return len([word for word in text.strip().split() if word])

def calculate_quality_score(word_count: int, attention_passed: bool, time_spent_seconds: float, feedback: str) -> float:
    word_score = min(word_count / 150.0, 1.0)
    attention_score = 1.0 if attention_passed is not False else 0.0
    time_score = 0.5 if time_spent_seconds and time_spent_seconds < TOO_FAST_SECONDS else 1.0
    feedback_score = min(len(feedback) / 50.0, 1.0)
    quality_score = (0.4 * word_score + 0.3 * attention_score + 0.2 * time_score + 0.1 * feedback_score)
    return round(quality_score, 3)

def _log_audit_event(db, event_type, participant_fk=None, participant_id=None, user_id=None, endpoint=None,
                    method=None, status_code=None, details=None):
    try:
        db.execute(text('''
            INSERT INTO audit_log
            (event_type, user_id, participant_fk, participant_id, endpoint, method, status_code, ip_hash, user_agent, details)
            VALUES (:event_type, :user_id, :participant_fk, :participant_id, :endpoint, :method, :status_code, :ip_hash, :user_agent, :details)
        '''), {
            "event_type": event_type,
            "user_id": user_id,
            "participant_fk": participant_fk,
            "participant_id": participant_id,
            "endpoint": endpoint,
            "method": method,
            "status_code": status_code,
            "ip_hash": get_ip_hash(),
            "user_agent": request.headers.get('User-Agent', ''),
            "details": details
        })
        db.commit()
    except Exception as e:
        pass

def _log_performance_metric(endpoint, response_time_ms, status_code, request_size=0, response_size=0):
    try:
        db = get_db()
        db.execute(text('''
            INSERT INTO performance_metrics
            (endpoint, response_time_ms, status_code, request_size_bytes, response_size_bytes)
            VALUES (:endpoint, :response_time_ms, :status_code, :request_size_bytes, :response_size_bytes)
        '''), {
            "endpoint": endpoint,
            "response_time_ms": response_time_ms,
            "status_code": status_code,
            "request_size_bytes": request_size,
            "response_size_bytes": response_size
        })
        db.commit()
    except Exception as e:
        pass

def track_performance(f):
    @functools.wraps(f)
    def wrapper(*args, **kwargs):
        start_time = time.time()
        try:
            response = f(*args, **kwargs)
            end_time = time.time()
            response_time_ms = int((end_time - start_time) * 1000)
            _log_performance_metric(
                endpoint=request.path,
                response_time_ms=response_time_ms,
                status_code=response.status_code if hasattr(response, 'status_code') else 200,
                request_size=request.content_length or 0,
                response_size=len(response.get_data()) if hasattr(response, 'get_data') else 0
            )
            return response
        except Exception as e:
            end_time = time.time()
            response_time_ms = int((end_time - start_time) * 1000)
            _log_performance_metric(
                endpoint=request.path,
                response_time_ms=response_time_ms,
                status_code=500,
                request_size=request.content_length or 0,
                response_size=0
            )
            raise e
    return wrapper

@app.route("/health")
@limiter.exempt
@track_performance
def health_check():
    status = {
        "status": "healthy",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "services": {}
    }
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        status["services"]["database"] = "connected"
    except Exception as e:
        status["services"]["database"] = f"error: {str(e)}"
        status["status"] = "degraded"
    return jsonify(status)

@app.route("/participants", methods=["POST"])
@limiter.limit("30 per minute")
@track_performance
def create_participant():
    data = request.get_json(silent=True) or {}
    required_fields = ['participant_id', 'session_id', 'username', 'gender', 'age', 'place', 'native_language', 'prior_experience']
    errors = {}
    for field in required_fields:
        if not data.get(field):
            errors[field] = f"{field.replace('_', ' ').title()} is required"
    if errors:
        return jsonify({"error": "Validation failed", "details": errors}), 400

    username = data.get('username', '').strip()
    if username and not re.match(r'^[a-zA-Z0-9_]+$', username):
        return jsonify({"error": "Username can only contain letters, numbers, and underscores"}), 400

    allowed_email_domains = ['gmail.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'me.com', 'mac.com']
    email = data.get('email', '').strip().lower()
    if email:
        if not re.match(r'^[^@\s]+@[^@\s]+\.[^@\s]+$', email):
            return jsonify({"error": "Invalid email format"}), 400
        domain = email.split('@')[1]
        if domain not in allowed_email_domains:
            return jsonify({"error": "Only Gmail, Outlook, Hotmail, and iCloud email addresses are allowed"}), 400

    phone = data.get('phone', '').strip()
    if phone:
        phone_digits = re.sub(r'\D', '', phone)
        is_valid_indian = re.match(r'^[6-9]\d{9}$', phone_digits) or (len(phone_digits) == 12 and phone_digits.startswith('91') and re.match(r'^[6-9]', phone_digits[2:]))
        if not is_valid_indian:
            return jsonify({"error": "Please enter a valid 10-digit Indian mobile number"}), 400

    try:
        age = int(data.get('age', 0))
        if age < 13 or age > 100:
            return jsonify({"error": "Age must be between 13 and 100"}), 400
    except (ValueError, TypeError):
        return jsonify({"error": "Age must be a valid number between 13 and 100"}), 400

    db = None
    try:
        db = get_db()
        _log_audit_event(db, event_type='participant_creation_attempt', participant_id=data['participant_id'],
                        endpoint='/participants', method='POST', status_code=201, details='Participant creation attempt')

        result = db.execute(text('''
            INSERT INTO participants
            (participant_id, session_id, username, email, phone, gender, age, place, native_language, prior_experience, ip_hash, user_agent)
            VALUES (:participant_id, :session_id, :username, :email, :phone, :gender, :age, :place, :native_language, :prior_experience, :ip_hash, :user_agent)
            RETURNING id
        '''), {
            "participant_id": data['participant_id'], "session_id": data['session_id'], "username": data['username'],
            "email": email or None, "phone": phone or None, "gender": data['gender'], "age": int(data['age']),
            "place": data['place'], "native_language": data['native_language'], "prior_experience": data['prior_experience'],
            "ip_hash": get_ip_hash(), "user_agent": request.headers.get('User-Agent', '')
        })
        participant_fk = result.fetchone()[0]

        try:
            consent_result = db.execute(text('''
                SELECT consent_given, consent_timestamp FROM consent_records
                WHERE participant_id = :participant_id AND consent_given = TRUE
            '''), {"participant_id": data['participant_id']})
            consent_row = consent_result.fetchone()

            if consent_row:
                db.execute(text('''
                    UPDATE participants SET consent_given = TRUE, consent_timestamp = :consent_timestamp
                    WHERE id = :participant_fk
                '''), {"consent_timestamp": consent_row[1], "participant_fk": participant_fk})
        except Exception as consent_error:
            app.logger.warning(f"Consent lookup failed for participant {data['participant_id']}: {consent_error}")

        db.commit()
        _log_audit_event(db, event_type='participant_created', participant_fk=participant_fk, participant_id=data['participant_id'],
                        endpoint='/participants', method='POST', status_code=201, details='Participant created successfully')

        return jsonify({"status": "success", "participant_id": data['participant_id'], "participant_fk": participant_fk,
                       "message": "Participant created successfully"}), 201
    except Exception as e:
        error_msg = str(e)
        if db is not None:
            db.rollback()
        if "duplicate" in error_msg.lower() or "unique" in error_msg.lower():
            if db is not None:
                _log_audit_event(db, event_type='participant_creation_failed', participant_id=data['participant_id'],
                               endpoint='/participants', method='POST', status_code=409, details=f'Duplicate participant ID: {error_msg}')
            return jsonify({"error": "Participant ID already exists"}), 409
        if db is not None:
            _log_audit_event(db, event_type='participant_creation_failed', participant_id=data['participant_id'],
                           endpoint='/participants', method='POST', status_code=500, details=f'Database error: {error_msg}')
        return jsonify({"error": "Database error", "details": error_msg}), 500

@app.route("/participants/<participant_id>")
def get_participant(participant_id):
    db = get_db()
    result = db.execute(text('''
        SELECT participant_id, username, email, phone, gender, age, place, native_language, prior_experience, consent_given, created_at
        FROM participants WHERE participant_id = :participant_id
    '''), {"participant_id": participant_id})
    row = result.fetchone()
    if not row:
        return jsonify({"error": "Participant not found"}), 404
    return jsonify({
        "participant_id": row[0], "username": row[1], "email": row[2], "phone": row[3], "gender": row[4],
        "age": row[5], "place": row[6], "native_language": row[7], "prior_experience": row[8],
        "consent_given": bool(row[9]), "created_at": str(row[10])
    })

@app.route("/consent", methods=["POST"])
@limiter.limit("20 per minute")
@track_performance
def record_consent():
    data = request.get_json(silent=True) or {}
    participant_id = data.get('participant_id')
    consent_given = data.get('consent_given', False)

    if not participant_id:
        return jsonify({"error": "participant_id is required"}), 400
    if not consent_given:
        return jsonify({"error": "Consent must be given to proceed"}), 400

    db = get_db()
    result = db.execute(text("SELECT id FROM participants WHERE participant_id = :participant_id"), {"participant_id": participant_id})
    participant_row = result.fetchone()
    if not participant_row:
        return jsonify({"error": "Participant not found"}), 404

    participant_fk = participant_row[0]
    timestamp = datetime.now(timezone.utc).isoformat()

    db.execute(text('''
        UPDATE participants SET consent_given = TRUE, consent_timestamp = :consent_timestamp
        WHERE id = :participant_fk
    '''), {"consent_timestamp": timestamp, "participant_fk": participant_fk})

    db.execute(text('''
        INSERT INTO consent_records (participant_fk, participant_id, consent_given, consent_timestamp, ip_hash, user_agent)
        VALUES (:participant_fk, :participant_id, TRUE, :consent_timestamp, :ip_hash, :user_agent)
        ON CONFLICT(participant_id) DO UPDATE SET
        consent_given = TRUE, consent_timestamp = EXCLUDED.consent_timestamp,
        ip_hash = EXCLUDED.ip_hash, user_agent = EXCLUDED.user_agent
    '''), {
        "participant_fk": participant_fk, "participant_id": participant_id, "consent_timestamp": timestamp,
        "ip_hash": get_ip_hash(), "user_agent": request.headers.get('User-Agent', '')
    })
    db.commit()

    return jsonify({"status": "success", "message": "Consent recorded successfully", "timestamp": timestamp})


@app.route("/payment/upi-details", methods=["POST"])
@limiter.limit("30 per minute")
@track_performance
def get_upi_details():
    """Get UPI payment details including UPI ID, QR code URL, and payment reference."""
    # Validate UPI configuration
    if not UPI_ID:
        return jsonify({"error": "UPI payment not configured"}), 500

    data = request.get_json(silent=True) or {}
    participant_id = data.get("participant_id")
    if not participant_id:
        return jsonify({"error": "participant_id required"}), 400

    db = get_db()
    participant_row = db.execute(
        text("SELECT id FROM participants WHERE participant_id = :participant_id"),
        {"participant_id": participant_id}
    ).fetchone()
    if not participant_row:
        return jsonify({"error": "Participant not found"}), 400
    participant_fk = participant_row[0]

    # Check for existing pending payment
    existing_payment = db.execute(text("""
        SELECT payment_reference, status FROM payments
        WHERE participant_fk = :participant_fk ORDER BY created_at DESC LIMIT 1
    """), {"participant_fk": participant_fk}).fetchone()

    if existing_payment and existing_payment[1] not in ['verified', 'rejected']:
        payment_reference = existing_payment[0]
    else:
        payment_reference = generate_payment_reference(participant_id)
        # Create new payment record
        db.execute(text("""
            INSERT INTO payments (participant_fk, participant_id, payment_reference, amount, status)
            VALUES (:participant_fk, :participant_id, :payment_reference, :amount, 'pending')
        """), {
            "participant_fk": participant_fk,
            "participant_id": participant_id,
            "payment_reference": payment_reference,
            "amount": PAYMENT_AMOUNT
        })
        db.commit()

    # Generate UPI QR URL
    qr_url = generate_upi_qr_url(UPI_ID, UPI_PAYEE_NAME, PAYMENT_AMOUNT, payment_reference)

    return jsonify({
        "upi_id": UPI_ID,
        "payee_name": UPI_PAYEE_NAME,
        "amount": PAYMENT_AMOUNT,
        "amount_display": f"₹{PAYMENT_AMOUNT / 100:.2f}",
        "payment_reference": payment_reference,
        "qr_url": qr_url,
        "instructions": [
            f"Open your UPI app (GPay, PhonePe, Paytm, etc.)",
            f"Send ₹{PAYMENT_AMOUNT / 100:.0f} to: {UPI_ID}",
            f"Add reference: {payment_reference}",
            f"Take a screenshot of the payment success screen",
            f"Upload the screenshot below"
        ]
    })


@app.route("/payment/submit", methods=["POST"])
@limiter.limit("30 per minute")
@track_performance
def submit_payment_proof():
    """Submit payment screenshot and UTR for verification."""
    participant_id = request.form.get("participant_id")
    manual_utr = request.form.get("utr", "").strip()

    if not participant_id:
        return jsonify({"error": "participant_id required"}), 400

    # Check if screenshot is provided
    if 'screenshot' not in request.files:
        return jsonify({"error": "Payment screenshot is required"}), 400

    screenshot = request.files['screenshot']
    if screenshot.filename == '':
        return jsonify({"error": "No screenshot selected"}), 400

    # Validate file type
    allowed_extensions = {'.png', '.jpg', '.jpeg'}
    file_ext = os.path.splitext(screenshot.filename.lower())[1]
    if file_ext not in allowed_extensions:
        return jsonify({"error": "Invalid file type. Please upload PNG or JPG image"}), 400

    # Read image data
    image_data = screenshot.read()
    if len(image_data) > 5 * 1024 * 1024:  # 5MB limit
        return jsonify({"error": "Image too large. Maximum size is 5MB"}), 400

    db = get_db()
    participant_row = db.execute(
        text("SELECT id FROM participants WHERE participant_id = :participant_id"),
        {"participant_id": participant_id}
    ).fetchone()
    if not participant_row:
        return jsonify({"error": "Participant not found"}), 400
    participant_fk = participant_row[0]

    # Get the pending payment record
    payment_row = db.execute(text("""
        SELECT id, payment_reference FROM payments
        WHERE participant_fk = :participant_fk AND status = 'pending'
        ORDER BY created_at DESC LIMIT 1
    """), {"participant_fk": participant_fk}).fetchone()

    if not payment_row:
        return jsonify({"error": "No pending payment found. Please initiate payment first"}), 400

    payment_id = payment_row[0]
    payment_reference = payment_row[1]

    # Extract UTR using OCR
    ocr_result = extract_utr_from_image(image_data)
    extracted_utr = ocr_result.get('utr')
    confidence = ocr_result.get('confidence', 0)

    # Use manual UTR if provided, otherwise use extracted
    final_utr = manual_utr if manual_utr else extracted_utr

    # Upload screenshot to S3
    s3_result = upload_to_s3(image_data, participant_id, payment_reference)
    screenshot_url = s3_result.get('url') if s3_result.get('success') else None
    screenshot_hash = hashlib.sha256(image_data).hexdigest()[:32]

    # Update payment record
    db.execute(text("""
        UPDATE payments SET
            status = 'submitted',
            utr_number = :utr,
            utr_extracted = :utr_extracted,
            ocr_confidence = :confidence,
            screenshot_url = :screenshot_url,
            screenshot_hash = :screenshot_hash,
            submitted_at = CURRENT_TIMESTAMP
        WHERE id = :payment_id
    """), {
        "utr": final_utr,
        "utr_extracted": extracted_utr,
        "confidence": confidence,
        "screenshot_url": screenshot_url,
        "screenshot_hash": screenshot_hash,
        "payment_id": payment_id
    })

    # Update participant payment status to 'pending_verification'
    db.execute(text("""
        UPDATE participants SET payment_status = 'pending_verification'
        WHERE id = :participant_fk
    """), {"participant_fk": participant_fk})

    db.commit()

    # Log the submission
    _log_audit_event(db, event_type='payment_submitted', participant_fk=participant_fk,
                    participant_id=participant_id, endpoint='/payment/submit',
                    method='POST', status_code=200,
                    details=f'Payment proof submitted. UTR: {final_utr}, OCR confidence: {confidence}')

    return jsonify({
        "status": "submitted",
        "message": "Payment proof submitted successfully. It will be verified shortly.",
        "utr": final_utr,
        "utr_extracted": extracted_utr,
        "utr_manual": manual_utr if manual_utr else None,
        "ocr_confidence": confidence,
        "payment_reference": payment_reference
    })


@app.route("/payment/status/<participant_id>", methods=["GET"])
@limiter.limit("60 per minute")
@track_performance
def get_payment_status(participant_id):
    """Get the current payment status for a participant."""
    db = get_db()
    result = db.execute(text("""
        SELECT p.status, p.utr_number, p.submitted_at, p.verified_at,
               p.payment_reference, p.ocr_confidence, p.screenshot_url,
               part.payment_status as participant_payment_status
        FROM payments p
        JOIN participants part ON p.participant_fk = part.id
        WHERE p.participant_id = :participant_id
        ORDER BY p.created_at DESC LIMIT 1
    """), {"participant_id": participant_id}).fetchone()

    if not result:
        return jsonify({
            "status": "not_initiated",
            "message": "Payment not initiated"
        })

    return jsonify({
        "status": result[0],
        "participant_status": result[7],
        "utr": result[1],
        "payment_reference": result[4],
        "screenshot_url": result[6],
        "submitted_at": result[2].isoformat() if result[2] else None,
        "verified_at": result[3].isoformat() if result[3] else None,
        "ocr_confidence": result[5]
    })


@app.route("/payment/verify-admin", methods=["POST"])
@limiter.limit("60 per minute")
@track_performance
def verify_payment_admin():
    """Admin endpoint to verify a payment submission."""
    data = request.get_json(silent=True) or {}
    participant_id = data.get("participant_id")
    action = data.get("action")  # 'approve' or 'reject'
    admin_notes = data.get("notes", "")

    if not participant_id or action not in ['approve', 'reject']:
        return jsonify({"error": "Invalid request"}), 400

    db = get_db()
    participant_row = db.execute(
        text("SELECT id FROM participants WHERE participant_id = :participant_id"),
        {"participant_id": participant_id}
    ).fetchone()
    if not participant_row:
        return jsonify({"error": "Participant not found"}), 404
    participant_fk = participant_row[0]

    new_status = 'verified' if action == 'approve' else 'rejected'
    participant_payment_status = 'paid' if action == 'approve' else 'rejected'

    db.execute(text("""
        UPDATE payments SET
            status = :status,
            verified_at = CURRENT_TIMESTAMP,
            admin_notes = :notes
        WHERE participant_fk = :participant_fk AND status = 'submitted'
    """), {
        "status": new_status,
        "notes": admin_notes,
        "participant_fk": participant_fk
    })

    db.execute(text("""
        UPDATE participants SET payment_status = :status
        WHERE id = :participant_fk
    """), {
        "status": participant_payment_status,
        "participant_fk": participant_fk
    })

    db.commit()

    return jsonify({
        "status": "success",
        "action": action,
        "participant_payment_status": participant_payment_status
    })

def get_images_from_db():
    db = get_db()
    try:
        result = db.execute(text('SELECT image_id, image_url FROM images'))
        return [{"image_id": row[0], "image_url": row[1]} for row in result.fetchall()]
    except Exception as e:
        app.logger.error(f"Error querying images: {e}")
        return []

def build_image_payload(image_data: dict):
    return {"image_id": image_data["image_id"], "image_url": image_data["image_url"]}

@app.route("/images/random")
def random_image():
    images = get_images_from_db()
    if not images:
        return jsonify({"error": "No images available"}), 404
    exclude_param = request.args.get('exclude', '')
    excluded_ids = set(exclude_param.split(',')) if exclude_param else set()
    available_images = [img for img in images if img["image_id"] not in excluded_ids]
    if not available_images:
        available_images = images
    image_data = random.choice(available_images)
    return jsonify(build_image_payload(image_data))

@app.route("/images/<path:image_id>")
def serve_image(image_id):
    if image_id.endswith('.svg'):
        return send_from_directory(IMAGES_DIR, image_id, mimetype='image/svg+xml')
    return send_from_directory(IMAGES_DIR, image_id)

@app.route("/logo")
def serve_logo():
    # Serve logo directly from GitHub
    import requests
    github_logo_url = "https://github.com/GauravKaloliya/COGNIT/raw/main/images/cognit_logo.png"
    try:
        response = requests.get(github_logo_url, stream=True, timeout=5)
        if response.status_code == 200:
            return response.content, 200, {'Content-Type': 'image/png'}
    except Exception as e:
        app.logger.error(f"Failed to fetch logo from GitHub: {e}")
    # Fallback to local file if available
    logo_path = IMAGES_DIR / "cognit_logo.png"
    if logo_path.exists():
        return send_file(logo_path, mimetype='image/png')
    # If no logo available, return 404
    return jsonify({"error": "Logo not found"}), 404


@app.route("/submit", methods=["POST"])
@limiter.limit("60 per minute")
@track_performance
def submit():
    payload = request.get_json(silent=True) or {}
    participant_id = payload.get("participant_id")
    if not participant_id:
        return jsonify({"error": "participant_id is required"}), 400

    db = get_db()
    participant_fk = _get_or_create_participant_fk(db, participant_id)
    if not participant_fk:
        return jsonify({"error": "Participant not found. Please complete registration first."}), 400

    flag_check = db.execute(text("SELECT is_flagged FROM attention_stats WHERE participant_fk = :participant_fk"),
                           {"participant_fk": participant_fk}).fetchone()
    if flag_check and flag_check[0]:
        return jsonify({"error": "Account flagged for low attention quality"}), 403

    result = db.execute(text("SELECT consent_given, payment_status FROM participants WHERE id = :participant_fk"),
                       {"participant_fk": participant_fk})
    db_result = result.fetchone()
    if not db_result:
        return jsonify({"error": "Participant not found. Please complete registration first."}), 400
    if db_result[1] != 'paid':
        return jsonify({"error": "Payment required"}), 403
    if not db_result[0]:
        return jsonify({"error": "Consent required. Please complete the consent process."}), 403

    description = (payload.get("description") or "").strip()
    image_id = payload.get("image_id")
    if not image_id:
        return jsonify({"error": "image_id is required"}), 400

    word_count = count_words(description)
    if word_count < MIN_WORD_COUNT:
        return jsonify({"error": f"Minimum {MIN_WORD_COUNT} words required", "word_count": word_count}), 400

    rating = payload.get("rating")
    time_spent_seconds = payload.get("time_spent_seconds")
    if rating is None:
        return jsonify({"error": "rating is required"}), 400
    try:
        rating = int(rating)
        if not 1 <= rating <= 10:
            raise ValueError
    except (TypeError, ValueError):
        return jsonify({"error": "rating must be an integer between 1-10"}), 400

    feedback = (payload.get("feedback") or "").strip()
    if len(feedback) < 5:
        return jsonify({"error": "comments must be at least 5 characters"}), 400

    is_survey = bool(payload.get("is_survey"))

    attention_result = db.execute(text("""
        SELECT expected_word, strict FROM attention_checks WHERE image_id = :image_id AND is_active = TRUE
    """), {"image_id": image_id})
    attention_row = attention_result.fetchone()
    is_attention = attention_row is not None
    attention_passed = None
    current_attention_score = None

    if is_attention:
        expected_word = attention_row[0].strip().lower()
        strict = attention_row[1]
        description_lower = description.lower()
        if strict:
            pattern = rf"\b{re.escape(expected_word)}\b"
            attention_passed = bool(re.search(pattern, description_lower))
        else:
            attention_passed = expected_word in description_lower

    too_fast_flag = False
    try:
        time_spent_seconds = float(time_spent_seconds)
        too_fast_flag = time_spent_seconds < TOO_FAST_SECONDS
    except (TypeError, ValueError):
        time_spent_seconds = None

    try:
        image_result = db.execute(text('SELECT image_id FROM images WHERE image_id = :image_id'), {"image_id": image_id})
        if not image_result.fetchone():
            db.execute(text('''
                INSERT INTO images (image_id, difficulty_score, object_count, width, height)
                VALUES (:image_id, 5.0, 1, 800, 600) ON CONFLICT (image_id) DO NOTHING
            '''), {"image_id": image_id})
    except Exception as e:
        _log_audit_event(db, event_type='image_insert_failed', participant_fk=participant_fk, participant_id=participant_id,
                        endpoint='/submit', method='POST', status_code=200, details=f'Failed to insert image {image_id}: {str(e)}')

    try:
        survey_index = payload.get("survey_index", 0)
        try:
            survey_index = int(survey_index)
        except (TypeError, ValueError):
            survey_index = 0

        quality_score = calculate_quality_score(word_count, attention_passed, time_spent_seconds, feedback)

        attention_score_snapshot = None
        if is_attention:
            stats_result = db.execute(text("SELECT attention_score FROM attention_stats WHERE participant_fk = :participant_fk"),
                                     {"participant_fk": participant_fk}).fetchone()
            attention_score_snapshot = stats_result[0] if stats_result else 1.0

        db.execute(text('''
            INSERT INTO submissions
            (participant_fk, participant_id, session_id, image_id, image_url, survey_index, description, word_count, rating,
             feedback, time_spent_seconds, is_survey, is_attention, attention_passed, too_fast_flag,
             attention_score_at_submission, quality_score, user_agent, ip_hash)
            VALUES (:participant_fk, :participant_id, :session_id, :image_id, :image_url, :survey_index, :description, :word_count, :rating,
             :feedback, :time_spent_seconds, :is_survey, :is_attention, :attention_passed, :too_fast_flag,
             :attention_score_at_submission, :quality_score, :user_agent, :ip_hash)
        '''), {
            "participant_fk": participant_fk, "participant_id": participant_id, "session_id": payload.get("session_id", ""),
            "image_id": image_id, "image_url": payload.get("image_url", f"/api/images/{image_id}"), "survey_index": survey_index,
            "description": description, "word_count": word_count, "rating": rating, "feedback": feedback,
            "time_spent_seconds": time_spent_seconds, "is_survey": is_survey, "is_attention": is_attention,
            "attention_passed": attention_passed, "too_fast_flag": too_fast_flag,
            "attention_score_at_submission": attention_score_snapshot, "quality_score": quality_score,
            "user_agent": request.headers.get("User-Agent", ""), "ip_hash": get_ip_hash()
        })

        if is_attention:
            stats = db.execute(text("""
                SELECT total_checks, passed_checks, failed_checks FROM attention_stats WHERE participant_fk = :participant_fk
            """), {"participant_fk": participant_fk}).fetchone()

            if stats:
                total = stats[0] + 1
                passed = stats[1] + (1 if attention_passed else 0)
                failed = stats[2] + (0 if attention_passed else 1)
            else:
                total = 1
                passed = 1 if attention_passed else 0
                failed = 0 if attention_passed else 1

            current_attention_score = passed / total
            is_flagged = current_attention_score < 0.6 and total >= 3

            db.execute(text("""
                INSERT INTO attention_stats
                (participant_fk, participant_id, total_checks, passed_checks, failed_checks, attention_score, is_flagged)
                VALUES (:participant_fk, :participant_id, :total, :passed, :failed, :score, :flagged)
                ON CONFLICT(participant_fk) DO UPDATE SET
                total_checks = :total, passed_checks = :passed, failed_checks = :failed,
                attention_score = :score, is_flagged = :flagged
            """), {
                "participant_fk": participant_fk, "participant_id": participant_id, "total": total,
                "passed": passed, "failed": failed, "score": current_attention_score, "flagged": is_flagged
            })

        _update_participant_stats_internal(db, participant_fk, participant_id, word_count, is_survey,
                                           current_attention_score if is_attention else None)
        db.commit()

        return jsonify({"status": "ok", "word_count": word_count, "attention_passed": attention_passed, "quality_score": quality_score})
    except Exception as e:
        db.rollback()
        return jsonify({"error": "Failed to save submission", "details": str(e)}), 500

@app.route("/submissions/<participant_id>")
def get_submissions(participant_id):
    db = get_db()
    result = db.execute(text('''
        SELECT image_id, image_url, description, word_count, rating, feedback,
               time_spent_seconds, quality_score, created_at
        FROM submissions WHERE participant_id = :participant_id
        ORDER BY created_at ASC
    '''), {"participant_id": participant_id})
    rows = result.fetchall()
    submissions = []
    for row in rows:
        submissions.append({
            "image_id": row[0], "image_url": row[1], "description": row[2],
            "word_count": row[3], "rating": row[4], "feedback": row[5],
            "time_spent_seconds": row[6], "quality_score": row[7], "created_at": str(row[8])
        })
    return jsonify({"submissions": submissions, "count": len(submissions)})

@app.route("/reward/entries")
def reward_entries():
    db = get_db()
    try:
        result = db.execute(text('''
            SELECT COUNT(*) FROM participants WHERE payment_status = 'paid'
        '''))
        total_paid = result.fetchone()[0]
        result = db.execute(text('''
            SELECT COUNT(*) FROM reward_winners WHERE status = 'pending'
        '''))
        pending_winners = result.fetchone()[0]
        return jsonify({
            "total_eligible_participants": total_paid,
            "pending_winners": pending_winners
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/reward/<participant_id>")
def get_reward_status(participant_id):
    db = get_db()
    result = db.execute(text("SELECT id FROM participants WHERE participant_id = :participant_id"),
                       {"participant_id": participant_id})
    participant_row = result.fetchone()
    if not participant_row:
        return jsonify({"error": "Participant not found"}), 404
    participant_fk = participant_row[0]
    eligibility = get_reward_eligibility(participant_fk)
    return jsonify(eligibility)

@app.route("/reward/select/<participant_id>", methods=["POST"])
@limiter.limit("10 per minute")
def select_reward(participant_id):
    result_data = select_reward_winner(participant_id)
    if result_data.get("error"):
        return jsonify(result_data), 500
    if result_data.get("already_winner"):
        return jsonify({"message": "Already a winner", **result_data}), 200
    if result_data.get("cooldown_active"):
        return jsonify(result_data), 429
    return jsonify(result_data)

@app.route("/security/info")
@limiter.limit("30 per minute")
@track_performance
def security_info():
    cors_origins = _get_cors_origins()
    return jsonify({
        "security": {
            "last_updated": datetime.now(timezone.utc).isoformat(),
            "rate_limits": {
                "default": "200 per day, 50 per hour",
                "participant_creation": "30 per minute",
                "consent_recording": "20 per minute",
                "submission": "60 per minute",
                "api_docs": "30 per minute",
                "reward_selection": "10 per minute per IP, 60 seconds cooldown per participant"
            },
            "rate_limit_storage": {
                "configured_backend": "redis" if actual_storage_uri != "memory://" else "memory",
                "fallback_behavior": "Automatically falls back to memory storage if configured Redis backend is unavailable"
            },
            "content_length_limit": "1 MB (1048576 bytes)",
            "cors_configuration": {
                "allowed_origins": cors_origins,
                "allowed_methods": ["GET", "POST", "OPTIONS"],
                "allowed_headers": ["Content-Type", "Authorization", "X-Requested-With"],
                "supports_credentials": False,
                "max_age": 86400
            },
            "security_headers": {
                "X-Content-Type-Options": "nosniff",
                "X-Frame-Options": "DENY",
                "X-XSS-Protection": "1; mode=block",
                "X-Permitted-Cross-Domain-Policies": "none",
                "X-Download-Options": "noopen",
                "X-DNS-Prefetch-Control": "off",
                "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'",
                "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
                "Referrer-Policy": "no-referrer",
                "Permissions-Policy": "geolocation=(), microphone=(), camera=(), payment=()",
                "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate"
            },
            "data_protection": {
                "ip_hashing": "SHA-256 with configurable salt",
                "anonymous_data": True,
                "storage": "PostgreSQL with comprehensive indexing",
                "encryption": "At-rest protection via filesystem encryption",
                "data_validation": "Comprehensive input validation and sanitization"
            },
            "database_security": {
                "foreign_key_constraints": "Enabled - using surrogate BIGINT keys",
                "input_validation": "Length and format constraints on all fields",
                "audit_logging": "Automatic logging of all participant actions",
                "performance_monitoring": "Comprehensive endpoint performance tracking",
                "data_integrity": "Check constraints and validation rules including score ranges"
            },
            "api_security": {
                "input_sanitization": "Protection against injection attacks",
                "content_validation": "Strict validation of all user inputs",
                "error_handling": "Secure error messages without sensitive data",
                "rate_limiting": "Per-IP and global rate limiting",
                "cors_restriction": "Strict origin and method restrictions"
            },
            "monitoring": {
                "audit_logs": "Comprehensive logging of all participant actions",
                "performance_metrics": "Response time and size tracking",
                "error_tracking": "Detailed error logging and monitoring",
                "security_events": "Logging of potential security violations"
            },
            "compliance": {
                "gdpr": "Privacy-preserving data collection",
                "data_minimization": "Only essential data collected",
                "consent_management": "Explicit consent recording",
                "data_retention": "Configurable retention policies"
            }
        },
        "recommendations": {
            "production": [
                "Configure proper IP_HASH_SALT",
                "Set strong SECRET_KEY",
                "Enable HTTPS with valid certificate",
                "Configure proper CORS origins",
                "Implement regular database backups",
                "Monitor audit logs regularly",
                "Rotate secrets periodically"
            ],
            "monitoring": [
                "Monitor /api/security/info for changes",
                "Review audit logs via database queries",
                "Track performance metrics for optimization",
                "Set up alerts for security violations"
            ]
        }
    })

def _get_api_documentation():
    return {
        "title": "C.O.G.N.I.T. API Documentation",
        "description": "C.O.G.N.I.T. (Cognitive Network for Image & Text Modeling) research platform API.",
        "base_url": "https://api.cognit.online",
        "security": {
            "rate_limiting": {
                "default": "200 per day, 50 per hour",
                "endpoints": {
                    "participant_creation": "30 per minute",
                    "consent_recording": "20 per minute",
                    "submission": "60 per minute",
                    "api_docs": "30 per minute",
                    "reward_selection": "10 per minute per IP, 60 seconds cooldown per participant"
                }
            },
            "content_length_limit": "1 MB (1048576 bytes)",
            "cors_configuration": {
                "allowed_origins": _get_cors_origins(),
                "allowed_methods": ["GET", "POST", "OPTIONS"],
                "allowed_headers": ["Content-Type", "Authorization", "X-Requested-With"],
                "supports_credentials": False,
                "max_age": 86400
            },
            "database_security": {
                "foreign_key_constraints": "Enabled - using surrogate BIGINT keys",
                "input_validation": "Length and format constraints on all fields",
                "score_constraints": "attention_score and quality_score constrained to 0-1 range"
            }
        },
        "endpoints": {
            "health": {"path": "/health", "method": "GET", "auth_required": False},
            "security_info": {"path": "/security/info", "method": "GET", "auth_required": False},
            "create_participant": {"path": "/participants", "method": "POST", "auth_required": False},
            "get_participant": {"path": "/participants/<participant_id>", "method": "GET", "auth_required": False},
            "record_consent": {"path": "/consent", "method": "POST", "auth_required": False},
            "get_consent": {"path": "/consent/<participant_id>", "method": "GET", "auth_required": False},
            "get_upi_details": {"path": "/payment/upi-details", "method": "POST", "auth_required": False, "description": "Get UPI payment details and QR code"},
            "submit_payment": {"path": "/payment/submit", "method": "POST", "auth_required": False, "description": "Submit payment screenshot with UTR"},
            "get_payment_status": {"path": "/payment/status/<participant_id>", "method": "GET", "auth_required": False, "description": "Check payment status"},
            "verify_payment_admin": {"path": "/payment/verify-admin", "method": "POST", "auth_required": False, "description": "Admin endpoint to verify payments"},
            "random_image": {"path": "/images/random", "method": "GET", "auth_required": False},
            "serve_image": {"path": "/images/<image_id>", "method": "GET", "auth_required": False},
            "submit": {"path": "/submit", "method": "POST", "auth_required": False},
            "reward_entries": {"path": "/reward/entries", "method": "GET", "auth_required": False},
            "get_reward_status": {"path": "/reward/<participant_id>", "method": "GET", "auth_required": False},
            "select_reward_winner": {"path": "/reward/select/<participant_id>", "method": "POST", "auth_required": False},
            "get_submissions": {"path": "/submissions/<participant_id>", "method": "GET", "auth_required": False}
        }
    }

@app.route("/")
def serve_api_docs():
    return render_template("api_docs.html", base_url="https://api.cognit.online")

@app.route("/docs")
@limiter.limit("30 per minute")
@track_performance
def get_api_docs():
    return jsonify(_get_api_documentation())


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=int(os.getenv("PORT", 5000)))
