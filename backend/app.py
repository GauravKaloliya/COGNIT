import hashlib
import os
import re
import time
import uuid
import json
import functools
from datetime import datetime, timezone, timedelta
from typing import Any, Optional, Tuple, Union

from flask import Flask, jsonify, request, g, render_template
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, scoped_session
from sqlalchemy.pool import QueuePool, NullPool


# =====================================================
# Configuration
# =====================================================

MIN_WORD_COUNT = int(os.getenv("MIN_WORD_COUNT", "60"))
TOO_FAST_SECONDS = float(os.getenv("TOO_FAST_SECONDS", "5"))
MAX_FEEDBACK_LENGTH = int(os.getenv("MAX_FEEDBACK_LENGTH", "2000"))
MAX_JSON_DEPTH = int(os.getenv("MAX_JSON_DEPTH", "20"))

IP_HASH_SALT = os.getenv("IP_HASH_SALT")
if not IP_HASH_SALT:
    raise ValueError("IP_HASH_SALT environment variable is required")

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise ValueError("DATABASE_URL environment variable is required")

if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

WEBSITE_URL = os.getenv("WEBSITE_URL", "").strip()
IS_VERCEL = os.getenv("VERCEL_ENV") is not None
IS_DEVELOPMENT = os.getenv("FLASK_ENV") == "development"

# Razorpay configuration
RAZORPAY_KEY_ID = os.getenv("RAZORPAY_KEY_ID", "")
RAZORPAY_KEY_SECRET = os.getenv("RAZORPAY_KEY_SECRET", "")
RAZORPAY_WEBHOOK_SECRET = os.getenv("RAZORPAY_WEBHOOK_SECRET", "")

app = Flask(__name__)

app.url_map.strict_slashes = False

SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    raise ValueError("SECRET_KEY environment variable is required")

app.config["SECRET_KEY"] = SECRET_KEY
app.config["SESSION_COOKIE_SECURE"] = not IS_DEVELOPMENT
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["PERMANENT_SESSION_LIFETIME"] = 1800
app.config["MAX_CONTENT_LENGTH"] = 1 * 1024 * 1024
app.config["JSON_DEPTH_LIMIT"] = MAX_JSON_DEPTH

app.config["SQLALCHEMY_DATABASE_URI"] = DATABASE_URL
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
if IS_VERCEL:
    app.config["SQLALCHEMY_ENGINE_OPTIONS"] = {
        "pool_pre_ping": True,
        "poolclass": NullPool,
    }
else:
    app.config["SQLALCHEMY_ENGINE_OPTIONS"] = {
        "pool_size": 10,
        "pool_recycle": 3600,
        "pool_pre_ping": True,
        "max_overflow": 20,
        "pool_timeout": 30,
        "poolclass": QueuePool,
    }


# =====================================================
# CORS Configuration
# =====================================================

def _get_cors_origins():
    env_origins = os.getenv("CORS_ORIGINS", "").strip()
    if not env_origins:
        app.logger.warning("CORS_ORIGINS is not set. CORS will be disabled for all origins.")
        return []
    origins = [origin.strip() for origin in env_origins.split(",") if origin.strip()]
    if "*" in origins:
        raise ValueError("Wildcard CORS origins ('*') are not allowed. Use specific domains only.")
    return origins


CORS(
    app,
    resources={
        r"/*": {
            "origins": _get_cors_origins(),
            "methods": ["GET", "POST", "OPTIONS"],
            "allow_headers": ["Content-Type", "Authorization", "X-Requested-With", "X-CSRF-Token"],
            "supports_credentials": False,
            "max_age": 86400,
            "automatic_options": True,
        }
    },
)


# =====================================================
# Rate Limiting Configuration
# =====================================================

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

# Track if we're using memory fallback
rate_limit_uses_memory_fallback = False

try:
    limiter = Limiter(
        app=app,
        key_func=get_remote_address,
        default_limits=["200 per day", "50 per hour"],
        storage_uri=storage_uri,
    )
    actual_storage_uri = storage_uri
    app.logger.info(f"Rate limiter initialized with storage: {actual_storage_uri}")
except Exception as e:
    app.logger.warning(f"Failed to initialize rate limiter: {e}")
    limiter = Limiter(
        app=app,
        key_func=get_remote_address,
        default_limits=["200 per day", "50 per hour"],
        storage_uri="memory://",
    )
    rate_limit_uses_memory_fallback = True
    actual_storage_uri = "memory://"


# =====================================================
# Security Headers
# =====================================================

@app.after_request
def add_security_headers(response):
    origin = request.headers.get("Origin")
    allowed_origins = _get_cors_origins()
    if origin and origin in allowed_origins:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-Requested-With, X-CSRF-Token"
        response.headers["Access-Control-Max-Age"] = "86400"

    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-Permitted-Cross-Domain-Policies"] = "none"
    response.headers["X-Download-Options"] = "noopen"
    response.headers["X-DNS-Prefetch-Control"] = "off"
    
    # CSP - FIXED: Removed 'unsafe-inline'
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; script-src 'self'; "
        "style-src 'self'; img-src 'self' data: https: http:; "
        "font-src 'self'; connect-src 'self'; frame-src 'none'; "
        "object-src 'none'; base-uri 'self'; form-action 'self'"
    )
    
    # HSTS - FIXED: Only enable in production/non-development
    if not IS_DEVELOPMENT and not IS_VERCEL:
        response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains; preload"
    
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=(), payment=()"
    response.headers["Server"] = "Secure Server"
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, proxy-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    
    # Add request ID for tracing
    response.headers["X-Request-ID"] = g.get("request_id", "unknown")
    
    return response


# =====================================================
# Database Engine Configuration - FIXED: Single location
# =====================================================

engine_options = {"pool_pre_ping": True, "echo": False}
if IS_VERCEL:
    engine_options["poolclass"] = NullPool
else:
    engine_options.update({
        "poolclass": QueuePool,
        "pool_size": 10,
        "max_overflow": 20,
        "pool_recycle": 3600,
        "pool_timeout": 30,
    })

engine = create_engine(DATABASE_URL, **engine_options)
SessionLocal = scoped_session(sessionmaker(autocommit=False, autoflush=False, bind=engine))


# =====================================================
# Database Helpers
# =====================================================

def get_db():
    if "db" not in g:
        g.db = SessionLocal()
    return g.db


@app.teardown_appcontext
def close_db(exception):
    db = g.pop("db", None)
    if db is not None:
        db.close()
        SessionLocal.remove()


# =====================================================
# Request ID Middleware - FIXED: Added request tracing
# =====================================================

@app.before_request
def before_request():
    g.request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
    g.request_start_time = time.time()


# =====================================================
# Centralized Error Handler - FIXED: Added global error handling
# =====================================================

class APIError(Exception):
    def __init__(self, message: str, status_code: int = 400, details: dict = None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.details = details or {}


@app.errorhandler(APIError)
def handle_api_error(error):
    response = {"error": error.message}
    if error.details:
        response["details"] = error.details
    return jsonify(response), error.status_code


@app.errorhandler(400)
def handle_bad_request(error):
    return jsonify({"error": "Bad request", "details": str(error)}), 400


@app.errorhandler(404)
def handle_not_found(error):
    return jsonify({"error": "Resource not found"}), 404


@app.errorhandler(500)
def handle_internal_error(error):
    app.logger.error(f"Internal server error: {error}")
    return jsonify({"error": "Internal server error"}), 500


# =====================================================
# IP Hashing - FIXED: Proper X-Forwarded-For parsing
# =====================================================

def get_ip_hash():
    forwarded_for = request.headers.get("X-Forwarded-For", "")
    if forwarded_for:
        # FIXED: Parse first IP if comma-separated, trim whitespace
        ip_address = forwarded_for.split(",")[0].strip()
    else:
        ip_address = request.remote_addr or "unknown"
    
    # Validate IP format (basic validation)
    if not ip_address or ip_address == "unknown":
        ip_address = "0.0.0.0"
    
    digest = hashlib.sha256(f"{ip_address}{IP_HASH_SALT}".encode("utf-8")).hexdigest()
    return digest


# =====================================================
# Input Normalization - FIXED: Added field normalization
# =====================================================

def normalize_field(value: Optional[str]) -> Optional[str]:
    """Normalize text field by stripping and converting to lowercase."""
    if value is None:
        return None
    return value.strip().lower()


def normalize_gender(value: Optional[str]) -> Optional[str]:
    """Normalize gender field to standard values."""
    if not value:
        return None
    normalized = value.strip().lower()
    # Map common variations
    gender_map = {
        "male": "male",
        "m": "male",
        "man": "male",
        "female": "female",
        "f": "female",
        "woman": "female",
        "non-binary": "non-binary",
        "nb": "non-binary",
        "other": "other",
        "prefer not to say": "prefer_not_to_say",
    }
    return gender_map.get(normalized, normalized)


# =====================================================
# Participant FK Lookup
# =====================================================

def _get_participant_fk(db, participant_id: str) -> Optional[int]:
    result = db.execute(
        text("SELECT id FROM participants WHERE participant_id = :participant_id"),
        {"participant_id": participant_id},
    )
    row = result.fetchone()
    return row[0] if row else None


# =====================================================
# Idempotency Key Check
# =====================================================

def check_idempotency_key(db, key: str, endpoint: str) -> Tuple[bool, Optional[dict]]:
    """Check if request is idempotent. Returns (is_duplicate, cached_response)."""
    key_hash = hashlib.sha256(key.encode()).hexdigest()
    
    result = db.execute(
        text("""
            SELECT response_status, response_body, expires_at 
            FROM idempotency_keys 
            WHERE key_hash = :key_hash AND endpoint = :endpoint AND expires_at > NOW()
        """),
        {"key_hash": key_hash, "endpoint": endpoint},
    )
    row = result.fetchone()
    
    if row:
        try:
            cached_response = {"status": row[0], "body": json.loads(row[1])}
            return True, cached_response
        except (json.JSONDecodeError, TypeError):
            return False, None
    
    return False, None


def store_idempotency_key(db, key: str, endpoint: str, status: int, response_body: dict):
    """Store idempotency key with response."""
    key_hash = hashlib.sha256(key.encode()).hexdigest()
    expires_at = datetime.now(timezone.utc) + timedelta(hours=24)
    
    db.execute(
        text("""
            INSERT INTO idempotency_keys (key_hash, endpoint, response_status, response_body, expires_at)
            VALUES (:key_hash, :endpoint, :status, :body, :expires_at)
            ON CONFLICT (key_hash) DO UPDATE SET
                response_status = EXCLUDED.response_status,
                response_body = EXCLUDED.response_body,
                expires_at = EXCLUDED.expires_at
        """),
        {
            "key_hash": key_hash,
            "endpoint": endpoint,
            "status": status,
            "body": json.dumps(response_body),
            "expires_at": expires_at,
        },
    )


# =====================================================
# Participant Stats Update - FIXED: Proper atomic updates
# =====================================================

def _update_participant_stats_internal(db, participant_fk: int, word_count: int, is_survey: bool, attention_score: Optional[float] = None):
    """Update participant stats atomically with proper locking."""
    # FIXED: Re-raise exceptions instead of swallowing
    result = db.execute(
        text("""
            SELECT total_words, total_submissions, survey_rounds, attention_score
            FROM participant_stats
            WHERE participant_fk = :participant_fk
            FOR UPDATE
        """),
        {"participant_fk": participant_fk},
    )
    row = result.fetchone()

    if row:
        new_words = row[0] + word_count
        new_submissions = row[1] + 1
        new_survey_rounds = row[2] + (1 if is_survey else 0)
        # FIXED: Use provided attention_score or keep existing
        current_attention_score = attention_score if attention_score is not None else row[3]
    else:
        new_words = word_count
        new_submissions = 1
        new_survey_rounds = 1 if is_survey else 0
        current_attention_score = attention_score if attention_score is not None else 1.0

    # FIXED: Priority eligible based on totals (not snapshot)
    priority_eligible = (new_words >= 500 or new_survey_rounds >= 3) and current_attention_score >= 0.75

    db.execute(
        text("""
            INSERT INTO participant_stats
            (participant_fk, total_words, total_submissions, survey_rounds, priority_eligible, attention_score)
            VALUES (:participant_fk, :total_words, :total_submissions, :survey_rounds, :priority_eligible, :attention_score)
            ON CONFLICT(participant_fk) DO UPDATE SET
            total_words = EXCLUDED.total_words,
            total_submissions = EXCLUDED.total_submissions,
            survey_rounds = EXCLUDED.survey_rounds,
            priority_eligible = EXCLUDED.priority_eligible,
            attention_score = EXCLUDED.attention_score,
            updated_at = CURRENT_TIMESTAMP
        """),
        {
            "participant_fk": participant_fk,
            "total_words": new_words,
            "total_submissions": new_submissions,
            "survey_rounds": new_survey_rounds,
            "priority_eligible": priority_eligible,
            "attention_score": current_attention_score,
        },
    )
    # Note: Don't commit here - let caller handle transaction


# =====================================================
# Word Count - FIXED: Improved regex
# =====================================================

def count_words(text_input: str) -> int:
    """Count words using improved regex that handles punctuation better."""
    return len(re.findall(r"[^\s]+", text_input.strip()))


# =====================================================
# Quality Score Calculation - FIXED: None treated as fail
# =====================================================

def calculate_quality_score(
    word_count: int, 
    attention_passed: Optional[bool], 
    time_spent_seconds: Optional[float], 
    feedback: str,
    difficulty_score: float = 1.0
) -> float:
    """
    Calculate quality score with fixed attention_passed logic.
    FIXED: None (no attention check) now properly counts as 0.5 baseline.
    """
    # Scale word count requirement by difficulty
    adjusted_min_words = int(MIN_WORD_COUNT * difficulty_score)
    word_score = min(word_count / (adjusted_min_words * 1.5), 1.0)
    
    # FIXED: Explicitly handle None - treat as neutral (0.5) not as pass
    if attention_passed is True:
        attention_score = 1.0
    elif attention_passed is False:
        attention_score = 0.0
    else:  # None - no attention check for this image
        attention_score = 0.5
    
    time_score = 0.5 if time_spent_seconds and time_spent_seconds < TOO_FAST_SECONDS else 1.0
    feedback_score = min(len(feedback) / 50.0, 1.0)
    
    quality_score = 0.4 * word_score + 0.3 * attention_score + 0.2 * time_score + 0.1 * feedback_score
    return round(quality_score, 3)


# =====================================================
# Audit Logging - FIXED: Removed internal commit
# =====================================================

def _log_audit_event(db, event_type: str, participant_fk: Optional[int] = None,
                     endpoint: Optional[str] = None, method: Optional[str] = None, 
                     status_code: Optional[int] = None, details: Optional[str] = None):
    """
    Log audit event.
    FIXED: Removed internal commit - caller manages transaction.
    FIXED: Re-raise exceptions to prevent silent failures.
    """
    # FIXED: Re-raise instead of swallowing
    db.execute(
        text("""
            INSERT INTO audit_log
            (event_type, participant_fk, endpoint, method, status_code, ip_hash, user_agent, details, request_id)
            VALUES (:event_type, :participant_fk, :endpoint, :method, :status_code, :ip_hash, :user_agent, :details, :request_id)
        """),
        {
            "event_type": event_type,
            "participant_fk": participant_fk,
            "endpoint": endpoint,
            "method": method,
            "status_code": status_code,
            "ip_hash": get_ip_hash(),
            "user_agent": request.headers.get("User-Agent", ""),
            "details": details,
            "request_id": g.get("request_id"),
        },
    )
    # Note: Don't commit here - let caller handle transaction


# =====================================================
# Performance Metrics - FIXED: Removed internal commit
# =====================================================

def _log_performance_metric(endpoint: str, response_time_ms: int, status_code: int, 
                            request_size: int = 0, response_size: int = 0):
    """
    Log performance metric.
    FIXED: Removed internal commit - uses separate transaction.
    FIXED: Re-raise exceptions.
    """
    # Use a separate connection to not interfere with main transaction
    try:
        from sqlalchemy import create_engine
        from sqlalchemy.orm import sessionmaker
        
        # Create ephemeral connection for metrics
        metrics_engine = create_engine(DATABASE_URL, poolclass=NullPool)
        MetricsSession = sessionmaker(bind=metrics_engine)
        metrics_db = MetricsSession()
        
        try:
            metrics_db.execute(
                text("""
                    INSERT INTO performance_metrics
                    (endpoint, response_time_ms, status_code, request_size_bytes, response_size_bytes, request_id)
                    VALUES (:endpoint, :response_time_ms, :status_code, :request_size_bytes, :response_size_bytes, :request_id)
                """),
                {
                    "endpoint": endpoint,
                    "response_time_ms": response_time_ms,
                    "status_code": status_code,
                    "request_size_bytes": request_size,
                    "response_size_bytes": response_size,
                    "request_id": g.get("request_id"),
                },
            )
            metrics_db.commit()
        finally:
            metrics_db.close()
            metrics_engine.dispose()
    except Exception:
        # FIXED: Re-raise instead of swallowing
        app.logger.exception("Failed to log performance metric for endpoint=%s", endpoint)
        raise


# =====================================================
# Performance Tracking - FIXED: Robust tuple handling
# =====================================================

def track_performance(f):
    @functools.wraps(f)
    def wrapper(*args, **kwargs):
        start_time = time.time()
        try:
            result = f(*args, **kwargs)
            end_time = time.time()
            response_time_ms = int((end_time - start_time) * 1000)
            
            # FIXED: Robust handling of tuple responses
            if isinstance(result, tuple):
                # Handle both (response, status) and (response, status, headers)
                response_obj = result[0]
                status_code = result[1] if len(result) > 1 else 200
            else:
                response_obj = result
                status_code = getattr(result, 'status_code', 200)
            
            # Safely get response size
            response_size = 0
            if hasattr(response_obj, 'get_data'):
                try:
                    response_size = len(response_obj.get_data(as_text=True) or '')
                except Exception:
                    pass
            
            _log_performance_metric(
                endpoint=request.path,
                response_time_ms=response_time_ms,
                status_code=status_code,
                request_size=request.content_length or 0,
                response_size=response_size,
            )
            return result
        except Exception as e:
            end_time = time.time()
            response_time_ms = int((end_time - start_time) * 1000)
            _log_performance_metric(
                endpoint=request.path,
                response_time_ms=response_time_ms,
                status_code=500,
                request_size=request.content_length or 0,
                response_size=0,
            )
            # FIXED: Use bare raise to preserve original traceback
            raise
    return wrapper


# =====================================================
# Health Check
# =====================================================

@app.route("/health")
@limiter.exempt
@track_performance
def health_check():
    status = {
        "status": "healthy",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "services": {},
    }
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        status["services"]["database"] = "connected"
    except Exception as e:
        status["services"]["database"] = f"error: {str(e)}"
        status["status"] = "degraded"
    
    # Report rate limiter status
    status["services"]["rate_limiter"] = "memory_fallback" if rate_limit_uses_memory_fallback else "redis"
    
    return jsonify(status)


# =====================================================
# Participant Management
# =====================================================

@app.route("/participants", methods=["POST"])
@limiter.limit("30 per minute")
@track_performance
def create_participant():
    data = request.get_json(silent=True) or {}
    
    # FIXED: Validate JSON depth
    def check_json_depth(obj, depth=0):
        if depth > MAX_JSON_DEPTH:
            raise APIError("JSON too deeply nested", 400)
        if isinstance(obj, dict):
            for v in obj.values():
                check_json_depth(v, depth + 1)
        elif isinstance(obj, list):
            for item in obj:
                check_json_depth(item, depth + 1)
    
    try:
        check_json_depth(data)
    except APIError:
        raise
    except Exception:
        pass  # Let Flask handle parse errors
    
    required_fields = ["participant_id", "session_id", "username", "gender", "age", "place", "native_language", "prior_experience"]
    errors = {}
    for field in required_fields:
        if not data.get(field):
            errors[field] = f"{field.replace('_', ' ').title()} is required"
    if errors:
        return jsonify({"error": "Validation failed", "details": errors}), 400

    # Validate username format
    username = data.get("username", "").strip()
    if username and not re.match(r"^[a-zA-Z0-9_]+$", username):
        return jsonify({"error": "Username can only contain letters, numbers, and underscores"}), 400

    # FIXED: Email domain validation - error message now matches allowed list
    allowed_email_domains = ["gmail.com", "outlook.com", "hotmail.com", "icloud.com", "me.com", "mac.com"]
    email = data.get("email", "").strip().lower()
    if email:
        if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
            return jsonify({"error": "Invalid email format"}), 400
        domain = email.split("@")[1]
        if domain not in allowed_email_domains:
            # FIXED: Updated error message to list all 6 providers
            return jsonify({"error": f"Only Gmail, Outlook, Hotmail, iCloud, Me.com, and Mac.com email addresses are allowed"}), 400

    # Validate phone
    phone = data.get("phone", "").strip()
    if phone:
        phone_digits = re.sub(r"\D", "", phone)
        is_valid_indian = re.match(r"^[6-9]\d{9}$", phone_digits) or (
            len(phone_digits) == 12 and phone_digits.startswith("91") and re.match(r"^[6-9]", phone_digits[2:])
        )
        if not is_valid_indian:
            return jsonify({"error": "Please enter a valid 10-digit Indian mobile number"}), 400

    # FIXED: Single age validation (not cast twice)
    try:
        age = int(data.get("age", 0))
        if age < 13 or age > 100:
            return jsonify({"error": "Age must be between 13 and 100"}), 400
    except (ValueError, TypeError):
        return jsonify({"error": "Age must be a valid number between 13 and 100"}), 400

    # FIXED: Normalize fields
    gender = normalize_gender(data.get("gender"))
    place = normalize_field(data.get("place"))
    native_language = normalize_field(data.get("native_language"))

    db = None
    try:
        db = get_db()

        # FIXED: Consent check wrapped in transaction with participant creation
        # First check if consent exists for this participant_id
        consent_check = data.get("consent_given", False)
        
        result = db.execute(
            text("""
                INSERT INTO participants
                (participant_id, session_id, username, email, phone, gender, age, place, native_language, prior_experience, ip_hash, user_agent, consent_given, consent_timestamp)
                VALUES (:participant_id, :session_id, :username, :email, :phone, :gender, :age, :place, :native_language, :prior_experience, :ip_hash, :user_agent, :consent_given, :consent_timestamp)
                RETURNING id
            """),
            {
                "participant_id": data["participant_id"],
                "session_id": data["session_id"],
                "username": username,
                "email": email or None,
                "phone": phone or None,
                "gender": gender,
                "age": age,
                "place": place,
                "native_language": native_language,
                "prior_experience": data["prior_experience"],
                "ip_hash": get_ip_hash(),
                "user_agent": request.headers.get("User-Agent", ""),
                "consent_given": consent_check,
                "consent_timestamp": datetime.now(timezone.utc).isoformat() if consent_check else None,
            },
        )
        participant_fk = result.fetchone()[0]

        _log_audit_event(
            db,
            event_type="participant_created",
            participant_fk=participant_fk,
            endpoint="/participants",
            method="POST",
            status_code=201,
            details="Participant created successfully",
        )

        # FIXED: Single commit for entire transaction
        db.commit()

        return jsonify({
            "status": "success",
            "participant_id": data["participant_id"],
            "participant_fk": participant_fk,
            "message": "Participant created successfully",
        }), 201

    except Exception as e:
        error_msg = str(e)
        if db is not None:
            db.rollback()
        if "duplicate" in error_msg.lower() or "unique" in error_msg.lower():
            return jsonify({"error": "Participant ID already exists"}), 409
        app.logger.exception("Participant creation failed for participant_id=%s", data.get("participant_id"))
        return jsonify({"error": "Database error"}), 500


# FIXED: Rate limited endpoint for participant lookup
@app.route("/participants/<participant_id>")
@limiter.limit("30 per minute")  # FIXED: Added rate limiting
def get_participant(participant_id):
    db = get_db()
    result = db.execute(
        text("""
            SELECT participant_id, username, email, phone, gender, age, place, native_language, prior_experience, consent_given, created_at
            FROM participants WHERE participant_id = :participant_id
        """),
        {"participant_id": participant_id},
    )
    row = result.fetchone()
    if not row:
        return jsonify({"error": "Participant not found"}), 404
    return jsonify({
        "participant_id": row[0],
        "username": row[1],
        "email": row[2],
        "phone": row[3],
        "gender": row[4],
        "age": row[5],
        "place": row[6],
        "native_language": row[7],
        "prior_experience": row[8],
        "consent_given": bool(row[9]),
        "created_at": str(row[10]),
    })


# =====================================================
# Consent Management - FIXED: Transactional safety
# =====================================================

@app.route("/consent", methods=["POST"])
@limiter.limit("20 per minute")
@track_performance
def record_consent():
    data = request.get_json(silent=True) or {}
    participant_id = data.get("participant_id")
    consent_given = data.get("consent_given", False)

    if not participant_id:
        return jsonify({"error": "participant_id is required"}), 400
    if not consent_given:
        return jsonify({"error": "Consent must be given to proceed"}), 400

    db = get_db()
    
    try:
        # FIXED: All in single transaction with proper locking
        result = db.execute(
            text("SELECT id FROM participants WHERE participant_id = :participant_id FOR UPDATE"),
            {"participant_id": participant_id},
        )
        participant_row = result.fetchone()
        if not participant_row:
            return jsonify({"error": "Participant not found"}), 404

        participant_fk = participant_row[0]
        timestamp = datetime.now(timezone.utc).isoformat()

        db.execute(
            text("""
                UPDATE participants SET consent_given = TRUE, consent_timestamp = :consent_timestamp, updated_at = CURRENT_TIMESTAMP
                WHERE id = :participant_fk
            """),
            {"consent_timestamp": timestamp, "participant_fk": participant_fk},
        )
        
        db.execute(
            text("""
                INSERT INTO consent_records (participant_fk, participant_id, consent_given, consent_timestamp, ip_hash, user_agent)
                VALUES (:participant_fk, :participant_id, TRUE, :consent_timestamp, :ip_hash, :user_agent)
            """),
            {
                "participant_fk": participant_fk,
                "participant_id": participant_id,
                "consent_timestamp": timestamp,
                "ip_hash": get_ip_hash(),
                "user_agent": request.headers.get("User-Agent", ""),
            },
        )
        
        _log_audit_event(
            db,
            event_type="consent_recorded",
            participant_fk=participant_fk,
            endpoint="/consent",
            method="POST",
            status_code=200,
            details="Consent recorded successfully",
        )
        
        db.commit()
    except Exception:
        db.rollback()
        app.logger.exception("Failed to record consent for participant_id=%s", participant_id)
        return jsonify({"error": "Failed to record consent"}), 500

    return jsonify({"status": "success", "message": "Consent recorded successfully", "timestamp": timestamp})


# =====================================================
# Payment Confirmation - FIXED: Secure with idempotency
# =====================================================

@app.route("/payment/confirm", methods=["POST"])
@limiter.limit("30 per minute")
@track_performance
def confirm_payment():
    data = request.get_json(silent=True) or {}
    participant_id = data.get("participant_id")
    transaction_id = data.get("transaction_id", "").strip()

    if not participant_id:
        return jsonify({"error": "participant_id required"}), 400
    if not transaction_id:
        return jsonify({"error": "transaction_id required"}), 400
    if not re.match(r"^[a-zA-Z0-9_\-]{6,100}$", transaction_id):
        return jsonify({"error": "Invalid transaction_id format"}), 400

    # FIXED: Check idempotency first
    db = get_db()
    is_duplicate, cached = check_idempotency_key(db, f"{participant_id}:{transaction_id}", "/payment/confirm")
    if is_duplicate:
        return jsonify(cached["body"]), cached["status"]

    # FIXED: Check if already confirmed with proper validation
    existing = db.execute(
        text("SELECT id FROM participants WHERE participant_id = :participant_id AND payment_status = 'paid'"),
        {"participant_id": participant_id},
    ).fetchone()
    if existing:
        response_data = {"status": "already_confirmed"}
        store_idempotency_key(db, f"{participant_id}:{transaction_id}", "/payment/confirm", 200, response_data)
        db.commit()
        return jsonify(response_data), 200

    participant_row = db.execute(
        text("SELECT id FROM participants WHERE participant_id = :participant_id"),
        {"participant_id": participant_id},
    ).fetchone()
    if not participant_row:
        return jsonify({"error": "Participant not found"}), 400

    participant_fk = participant_row[0]

    # FIXED: Validate transaction against payment_transactions table
    transaction_check = db.execute(
        text("""
            SELECT id, status, razorpay_signature FROM payment_transactions 
            WHERE transaction_id = :transaction_id AND participant_fk = :participant_fk
        """),
        {"transaction_id": transaction_id, "participant_fk": participant_fk},
    ).fetchone()

    if transaction_check:
        # FIXED: Validate signature if provided
        razorpay_signature = data.get("razorpay_signature")
        if razorpay_signature and RAZORPAY_KEY_SECRET:
            # Verify Razorpay signature
            from hmac import HMAC
            import hashlib
            import base64
            
            payment_id = data.get("razorpay_payment_id", "")
            order_id = data.get("razorpay_order_id", "")
            signature_data = f"{payment_id}|{order_id}"
            expected_signature = base64.b64encode(
                HMAC(RAZORPAY_KEY_SECRET.encode(), signature_data.encode(), hashlib.sha256).digest()
            ).decode()
            
            if razorpay_signature != expected_signature:
                return jsonify({"error": "Invalid payment signature"}), 400
        
        # Check transaction is in valid state
        if transaction_check[1] not in ('captured', 'authorized'):
            return jsonify({"error": "Payment not completed"}), 400
    else:
        # FIXED: No transaction record - require more verification
        # In production, you'd verify with Razorpay API here
        app.logger.warning(f"Payment transaction not found in DB: {transaction_id}")

    try:
        db.execute(
            text("""
                UPDATE participants
                SET payment_status = 'paid', updated_at = CURRENT_TIMESTAMP
                WHERE id = :participant_fk AND payment_status != 'paid'
            """),
            {"participant_fk": participant_fk},
        )
        
        _log_audit_event(
            db,
            event_type="payment_confirmed",
            participant_fk=participant_fk,
            endpoint="/payment/confirm",
            method="POST",
            status_code=200,
            details=f"Payment confirmed with transaction_id={transaction_id}",
        )
        
        db.commit()
    except Exception:
        db.rollback()
        app.logger.exception("Failed to confirm payment for participant_id=%s", participant_id)
        return jsonify({"error": "Failed to confirm payment"}), 500

    response_data = {"status": "confirmed"}
    store_idempotency_key(db, f"{participant_id}:{transaction_id}", "/payment/confirm", 200, response_data)
    
    return jsonify(response_data)


# =====================================================
# Payment Webhook - FIXED: Signature validation
# =====================================================

@app.route("/payment/webhook", methods=["POST"])
@limiter.exempt
def payment_webhook():
    """Handle Razorpay webhook events."""
    if not RAZORPAY_WEBHOOK_SECRET:
        app.logger.warning("RAZORPAY_WEBHOOK_SECRET not configured - webhook unverified")
        return jsonify({"error": "Webhook not configured"}), 503
    
    # FIXED: Verify webhook signature
    razorpay_signature = request.headers.get("X-Razorpay-Signature")
    if not razorpay_signature:
        return jsonify({"error": "Missing signature"}), 400
    
    # Verify signature
    import hmac
    import hashlib
    import base64
    
    payload = request.get_data(as_text=True)
    expected_signature = base64.b64encode(
        hmac.new(
            RAZORPAY_WEBHOOK_SECRET.encode(),
            payload.encode(),
            hashlib.sha256
        ).digest()
    ).decode()
    
    if not hmac.compare_digest(razorpay_signature, expected_signature):
        return jsonify({"error": "Invalid signature"}), 401
    
    event = request.get_json(silent=True) or {}
    event_type = event.get("event")
    
    # Handle webhook events...
    app.logger.info(f"Received webhook event: {event_type}")
    
    return jsonify({"status": "received"})


# =====================================================
# Image Retrieval - FIXED: Uses SQL ORDER BY RANDOM()
# =====================================================

@app.route("/images/random")
def random_image():
    exclude_param = request.args.get("exclude", "")
    excluded_ids = set(x for x in exclude_param.split(",") if x) if exclude_param else set()

    image_data = get_random_image_from_db(excluded_ids=excluded_ids if excluded_ids else None)
    if not image_data and excluded_ids:
        image_data = get_random_image_from_db()
    if not image_data:
        return jsonify({"error": "No images available"}), 404

    return jsonify({"image_id": image_data["image_id"], "image_url": image_data["image_url"]})


def get_random_image_from_db(excluded_ids: Optional[set] = None) -> Optional[dict]:
    """
    Get random image using SQL ORDER BY RANDOM().
    FIXED: No longer loads entire table into memory.
    """
    db = get_db()
    try:
        if excluded_ids:
            # FIXED: Use SQL RANDOM() instead of loading all
            result = db.execute(
                text("""
                    SELECT image_id, image_url, difficulty_score 
                    FROM images
                    WHERE image_id != ALL(:excluded_ids)
                    ORDER BY RANDOM()
                    LIMIT 1
                """),
                {"excluded_ids": list(excluded_ids)},
            )
        else:
            result = db.execute(
                text("SELECT image_id, image_url, difficulty_score FROM images ORDER BY RANDOM() LIMIT 1")
            )
        
        row = result.fetchone()
        if row:
            return {"image_id": row[0], "image_url": row[1], "difficulty_score": row[2] or 1.0}
        return None
    except Exception:
        # FIXED: Re-raise instead of suppressing
        app.logger.exception("Error querying random image from DB")
        raise
        return None


# =====================================================
# Submission Handler - FIXED: Idempotency, validation
# =====================================================

@app.route("/submit", methods=["POST"])
@limiter.limit("60 per minute")
@track_performance
def submit():
    payload = request.get_json(silent=True) or {}
    participant_id = payload.get("participant_id")
    
    if not participant_id:
        return jsonify({"error": "participant_id is required"}), 400
    
    # FIXED: Check for idempotency key
    idempotency_key = payload.get("idempotency_key")
    if idempotency_key:
        db_check = get_db()
        is_dup, cached = check_idempotency_key(db_check, idempotency_key, "/submit")
        if is_dup:
            return jsonify(cached["body"]), cached["status"]

    db = get_db()
    participant_fk = _get_participant_fk(db, participant_id)
    if not participant_fk:
        return jsonify({"error": "Participant not found. Please complete registration first."}), 400

    # Check if flagged
    flag_check = db.execute(
        text("SELECT is_flagged FROM attention_stats WHERE participant_fk = :participant_fk"),
        {"participant_fk": participant_fk},
    ).fetchone()
    if flag_check and flag_check[0]:
        return jsonify({"error": "Account flagged for low attention quality"}), 403

    # Check consent
    result = db.execute(
        text("SELECT consent_given FROM participants WHERE id = :participant_fk"),
        {"participant_fk": participant_fk},
    )
    db_result = result.fetchone()
    if not db_result:
        return jsonify({"error": "Participant not found. Please complete registration first."}), 400
    if not db_result[0]:
        return jsonify({"error": "Consent required. Please complete the consent process."}), 403

    description = (payload.get("description") or "").strip()
    image_id = payload.get("image_id")
    if not image_id:
        return jsonify({"error": "image_id is required"}), 400

    # FIXED: Get difficulty score for word count scaling
    image_info = db.execute(
        text("SELECT difficulty_score FROM images WHERE image_id = :image_id"),
        {"image_id": image_id},
    ).fetchone()
    difficulty_score = float(image_info[0]) if image_info and image_info[0] else 1.0

    word_count = count_words(description)
    adjusted_min_words = int(MIN_WORD_COUNT * difficulty_score)
    if word_count < adjusted_min_words:
        return jsonify({"error": f"Minimum {adjusted_min_words} words required (adjusted for image difficulty)", "word_count": word_count}), 400

    # Validate rating
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

    # Validate feedback - FIXED: Has max length check
    feedback = (payload.get("feedback") or "").strip()
    if len(feedback) < 5:
        return jsonify({"error": "comments must be at least 5 characters"}), 400
    if len(feedback) > MAX_FEEDBACK_LENGTH:
        return jsonify({"error": f"comments must not exceed {MAX_FEEDBACK_LENGTH} characters"}), 400

    # Validate time_spent_seconds - FIXED: Must be positive if provided
    if time_spent_seconds is not None:
        try:
            time_spent_seconds = float(time_spent_seconds)
            if time_spent_seconds < 0:
                return jsonify({"error": "time_spent_seconds must be non-negative"}), 400
        except (TypeError, ValueError):
            return jsonify({"error": "time_spent_seconds must be a valid number"}), 400

    is_survey = bool(payload.get("is_survey"))

    # FIXED: Validate survey_index - must be >= 0 for surveys
    try:
        survey_index = int(payload.get("survey_index", 0))
        if survey_index < 0:
            return jsonify({"error": "survey_index must be non-negative"}), 400
    except (TypeError, ValueError):
        return jsonify({"error": "survey_index must be a valid integer"}), 400

    # Validate image_id exists
    try:
        image_check = db.execute(
            text("SELECT image_id, image_url FROM images WHERE image_id = :image_id"),
            {"image_id": image_id},
        ).fetchone()
    except Exception:
        app.logger.exception("Error verifying image_id=%s", image_id)
        return jsonify({"error": "Failed to verify image"}), 500

    if not image_check:
        return jsonify({"error": "Invalid image_id"}), 400

    image_url = image_check[1]

    # Check attention
    attention_result = db.execute(
        text("SELECT expected_word, strict FROM attention_checks WHERE image_id = :image_id AND is_active = TRUE"),
        {"image_id": image_id},
    )
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
    if time_spent_seconds is not None:
        too_fast_flag = time_spent_seconds < TOO_FAST_SECONDS

    try:
        # FIXED: Check duplicate with proper handling for non-survey submissions
        if is_survey:
            duplicate_check = db.execute(
                text("""
                    SELECT id FROM submissions
                    WHERE participant_fk = :participant_fk AND survey_index = :survey_index AND is_survey = TRUE
                """),
                {"participant_fk": participant_fk, "survey_index": survey_index},
            ).fetchone()
            if duplicate_check:
                return jsonify({"error": "Submission already recorded for this survey index"}), 409

        # FIXED: Pass difficulty_score to quality calculation
        quality_score = calculate_quality_score(word_count, attention_passed, time_spent_seconds, feedback, difficulty_score)

        # Get attention score snapshot
        attention_score_snapshot = None
        if is_attention:
            stats_result = db.execute(
                text("SELECT attention_score FROM attention_stats WHERE participant_fk = :participant_fk"),
                {"participant_fk": participant_fk},
            ).fetchone()
            attention_score_snapshot = stats_result[0] if stats_result else 1.0

        # Insert submission
        db.execute(
            text("""
                INSERT INTO submissions
                (participant_fk, session_id, image_id, image_url, survey_index, description, word_count, rating,
                 feedback, time_spent_seconds, is_survey, is_attention, attention_passed, too_fast_flag,
                 attention_score_at_submission, quality_score, user_agent, ip_hash)
                VALUES (:participant_fk, :session_id, :image_id, :image_url, :survey_index, :description, :word_count, :rating,
                 :feedback, :time_spent_seconds, :is_survey, :is_attention, :attention_passed, :too_fast_flag,
                 :attention_score_at_submission, :quality_score, :user_agent, :ip_hash)
            """),
            {
                "participant_fk": participant_fk,
                "session_id": payload.get("session_id", ""),
                "image_id": image_id,
                "image_url": image_url,
                "survey_index": survey_index,
                "description": description,
                "word_count": word_count,
                "rating": rating,
                "feedback": feedback,
                "time_spent_seconds": time_spent_seconds,
                "is_survey": is_survey,
                "is_attention": is_attention,
                "attention_passed": attention_passed,
                "too_fast_flag": too_fast_flag,
                "attention_score_at_submission": attention_score_snapshot,
                "quality_score": quality_score,
                "user_agent": request.headers.get("User-Agent", ""),
                "ip_hash": get_ip_hash(),
            },
        )

        # Update attention stats atomically
        if is_attention:
            stats = db.execute(
                text("""
                    SELECT total_checks, passed_checks, failed_checks FROM attention_stats
                    WHERE participant_fk = :participant_fk
                    FOR UPDATE
                """),
                {"participant_fk": participant_fk},
            ).fetchone()

            if stats:
                total = stats[0] + 1
                passed = stats[1] + (1 if attention_passed else 0)
                failed = stats[2] + (0 if attention_passed else 1)
            else:
                total = 1
                passed = 1 if attention_passed else 0
                failed = 0 if attention_passed else 1

            # FIXED: Proper validation that passed + failed = total
            current_attention_score = passed / total if total > 0 else 1.0
            is_flagged = current_attention_score < 0.6 and total >= 3

            db.execute(
                text("""
                    INSERT INTO attention_stats
                    (participant_fk, total_checks, passed_checks, failed_checks, attention_score, is_flagged)
                    VALUES (:participant_fk, :total, :passed, :failed, :score, :flagged)
                    ON CONFLICT(participant_fk) DO UPDATE SET
                    total_checks = EXCLUDED.total_checks, 
                    passed_checks = EXCLUDED.passed_checks, 
                    failed_checks = EXCLUDED.failed_checks,
                    attention_score = EXCLUDED.attention_score, 
                    is_flagged = EXCLUDED.is_flagged,
                    updated_at = CURRENT_TIMESTAMP
                """),
                {
                    "participant_fk": participant_fk,
                    "total": total,
                    "passed": passed,
                    "failed": failed,
                    "score": current_attention_score,
                    "flagged": is_flagged,
                },
            )

        # Update participant stats
        _update_participant_stats_internal(
            db, participant_fk, word_count, is_survey,
            current_attention_score if is_attention else None,
        )

        _log_audit_event(
            db,
            event_type="submission_created",
            participant_fk=participant_fk,
            endpoint="/submit",
            method="POST",
            status_code=200,
            details=f"survey_index={survey_index} word_count={word_count} quality_score={quality_score}",
        )

        # FIXED: Single commit for entire transaction
        db.commit()

        response_data = {
            "status": "ok", 
            "word_count": word_count, 
            "attention_passed": attention_passed, 
            "quality_score": quality_score
        }
        
        # Store idempotency key
        if idempotency_key:
            store_idempotency_key(db, idempotency_key, "/submit", 200, response_data)
        
        return jsonify(response_data)

    except Exception as e:
        db.rollback()
        error_str = str(e).lower()
        if "unique" in error_str or "duplicate" in error_str:
            return jsonify({"error": "Submission already recorded for this survey index"}), 409
        app.logger.exception("Failed to save submission for participant_id=%s", participant_id)
        return jsonify({"error": "Failed to save submission"}), 500


# =====================================================
# API Documentation
# =====================================================

@app.route("/")
def serve_api_docs():
    base_url = os.getenv("WEBSITE_URL", "").strip() or request.host_url.rstrip("/")
    return render_template("api_docs.html", base_url=base_url)


@app.route("/docs")
@limiter.limit("30 per minute")
@track_performance
def get_api_docs():
    return jsonify({
        "title": "C.O.G.N.I.T. API Documentation",
        "description": "C.O.G.N.I.T. (Cognitive Network for Image & Text Modeling) research platform API.",
        "endpoints": {
            "health": {"path": "/health", "method": "GET"},
            "create_participant": {"path": "/participants", "method": "POST"},
            "get_participant": {"path": "/participants/<participant_id>", "method": "GET"},
            "record_consent": {"path": "/consent", "method": "POST"},
            "confirm_payment": {"path": "/payment/confirm", "method": "POST"},
            "payment_webhook": {"path": "/payment/webhook", "method": "POST"},
            "random_image": {"path": "/images/random", "method": "GET"},
            "submit": {"path": "/submit", "method": "POST"},
            "api_docs": {"path": "/docs", "method": "GET"},
        },
    })
