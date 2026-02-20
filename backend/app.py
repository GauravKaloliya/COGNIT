import hashlib
import os
import re
import time
import functools
from datetime import datetime, timezone

from flask import Flask, jsonify, request, g, render_template
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, scoped_session
from sqlalchemy.pool import QueuePool, NullPool


MIN_WORD_COUNT = int(os.getenv("MIN_WORD_COUNT", "60"))
TOO_FAST_SECONDS = float(os.getenv("TOO_FAST_SECONDS", "5"))
MAX_FEEDBACK_LENGTH = int(os.getenv("MAX_FEEDBACK_LENGTH", "2000"))
MIN_FEEDBACK_LENGTH = 5
MAX_DESCRIPTION_LENGTH = 10000
MIN_RATING = 1
MAX_RATING = 10
MIN_AGE = 13
MAX_AGE = 120
ATTENTION_FLAG_THRESHOLD = 0.6
ATTENTION_FLAG_MIN_CHECKS = 3
PRIORITY_WORD_THRESHOLD = 500
PRIORITY_ROUNDS_THRESHOLD = 3
PRIORITY_ATTENTION_THRESHOLD = 0.75
PERFORMANCE_LOG_SAMPLE_RATE = float(os.getenv("PERFORMANCE_LOG_SAMPLE_RATE", "0.1"))

# FIX: Make email domains configurable
ALLOWED_EMAIL_DOMAINS = os.getenv("ALLOWED_EMAIL_DOMAINS", "").strip()
if ALLOWED_EMAIL_DOMAINS:
    ALLOWED_EMAIL_DOMAINS = [domain.strip() for domain in ALLOWED_EMAIL_DOMAINS.split(",") if domain.strip()]
else:
    ALLOWED_EMAIL_DOMAINS = ["gmail.com", "outlook.com", "hotmail.com", "icloud.com", "me.com", "mac.com"]

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

app = Flask(__name__)

app.url_map.strict_slashes = False

SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    raise ValueError("SECRET_KEY environment variable is required")

app.config["SECRET_KEY"] = SECRET_KEY
app.config["SESSION_COOKIE_SECURE"] = True
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["PERMANENT_SESSION_LIFETIME"] = 1800
app.config["MAX_CONTENT_LENGTH"] = 1 * 1024 * 1024
app.config["MAX_CONTENT_JSON_DEPTH"] = 20

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
        "poolclass": QueuePool,
    }


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
            "allow_headers": ["Content-Type", "Authorization", "X-Requested-With"],
            "supports_credentials": False,
            "max_age": 86400,
            "automatic_options": True,
        }
    },
)

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

# Enable ProxyFix in production environments (Vercel or when explicitly set)
# This prevents IP spoofing when behind a reverse proxy
if IS_VERCEL or os.getenv("BEHIND_PROXY", "").lower() in ("true", "1", "yes"):
    from werkzeug.middleware.proxy_fix import ProxyFix
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_port=1)
    app.logger.info("ProxyFix enabled for production environment")

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
    actual_storage_uri = "memory://"


@app.after_request
def add_security_headers(response):
    origin = request.headers.get("Origin")
    allowed_origins = _get_cors_origins()
    if origin and origin in allowed_origins:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-Requested-With"
        response.headers["Access-Control-Max-Age"] = "86400"

    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-Permitted-Cross-Domain-Policies"] = "none"
    response.headers["X-Download-Options"] = "noopen"
    response.headers["X-DNS-Prefetch-Control"] = "off"
    # Build CSP with all required directives
    csp_policy = (
        "default-src 'self'; "
        "script-src 'self'; "
        "style-src 'self'; "
        "img-src 'self' data: https: http:; "
        "font-src 'self'; "
        "connect-src 'self'; "
        "frame-src 'none'; "
        "object-src 'none'; "
        "base-uri 'self'; "
        "form-action 'self'"
    )
    if origin and origin in allowed_origins:
        # Add origin to appropriate CSP directives
        csp_policy = csp_policy.replace("connect-src 'self';", f"connect-src 'self' {origin};")
        csp_policy = csp_policy.replace("script-src 'self';", f"script-src 'self' {origin};")
        csp_policy = csp_policy.replace("style-src 'self';", f"style-src 'self' {origin};")
    response.headers["Content-Security-Policy"] = csp_policy
    if not IS_VERCEL and os.getenv("FLASK_ENV") != "development":
        response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains; preload"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=(), payment=()"
    response.headers["Server"] = "Secure Server"
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, proxy-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


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
        "isolation_level": "READ COMMITTED",
    })

engine = create_engine(DATABASE_URL, **engine_options)
SessionLocal = scoped_session(sessionmaker(autocommit=False, autoflush=False, bind=engine))


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


def get_ip_hash():
    import ipaddress

    forwarded_for = request.headers.get("X-Forwarded-For", "")
    if forwarded_for:
        ip_address = forwarded_for.split(",")[0].strip()
    else:
        ip_address = request.remote_addr or "unknown"

    ip_address = ip_address.strip()
    if not ip_address or ip_address == "unknown":
        return "0" * 64

    try:
        # FIX: Support both IPv4 and IPv6 addresses
        ip_obj = ipaddress.ip_address(ip_address)
        # Normalize IPv6 addresses to their compressed form
        normalized_ip = str(ip_obj)
    except ValueError:
        # Invalid IP address
        return "0" * 64

    digest = hashlib.sha256(f"{normalized_ip}{IP_HASH_SALT}".encode("utf-8")).hexdigest()
    return digest


def _get_participant_fk(db, participant_id):
    result = db.execute(
        text("SELECT id FROM participants WHERE participant_id = :participant_id"),
        {"participant_id": participant_id},
    )
    row = result.fetchone()
    return row[0] if row else None


def _update_participant_stats_internal(db, participant_fk, word_count, is_survey, attention_score=None):
    # Use atomic SQL UPSERT - compute priority eligibility in SQL after increment
    # This eliminates the read-before-write race condition
    survey_rounds_increment = 1 if is_survey else 0
    db.execute(
        text("""
            INSERT INTO participant_stats
            (participant_fk, total_words, total_submissions, survey_rounds, priority_eligible, attention_score)
            VALUES (:participant_fk, :total_words, :total_submissions, :survey_rounds, FALSE, COALESCE(:attention_score, 1.0))
            ON CONFLICT(participant_fk) DO UPDATE SET
            total_words = participant_stats.total_words + EXCLUDED.total_words,
            total_submissions = participant_stats.total_submissions + 1,
            survey_rounds = participant_stats.survey_rounds + EXCLUDED.survey_rounds,
            attention_score = CASE
                WHEN EXCLUDED.attention_score IS NOT NULL THEN EXCLUDED.attention_score
                ELSE participant_stats.attention_score
            END,
            priority_eligible = ((participant_stats.total_words + EXCLUDED.total_words) >= :word_threshold
                OR (participant_stats.survey_rounds + EXCLUDED.survey_rounds) >= :rounds_threshold)
                AND COALESCE(EXCLUDED.attention_score, participant_stats.attention_score) >= :attention_threshold
        """),
        {
            "participant_fk": participant_fk,
            "total_words": word_count,
            "total_submissions": 1,
            "survey_rounds": survey_rounds_increment,
            "attention_score": attention_score,
            "word_threshold": PRIORITY_WORD_THRESHOLD,
            "rounds_threshold": PRIORITY_ROUNDS_THRESHOLD,
            "attention_threshold": PRIORITY_ATTENTION_THRESHOLD,
        },
    )


def count_words(text_input: str):
    # Count alphabetic tokens including accented characters and Unicode text
    # Supports multilingual input including Indian languages and accented characters
    # \w includes word characters from all languages in Unicode mode
    words = re.findall(r"\b\w+\b", text_input.strip(), flags=re.UNICODE)
    # Filter to only include strings that contain at least one letter character
    words = [w for w in words if re.search(r"[^\W\d_]", w, flags=re.UNICODE)]
    return len(words)


def detect_bot_like_content(description: str, word_count: int) -> tuple[bool, str]:
    """
    Detect potential bot-generated content patterns.
    More lenient thresholds to avoid false positives for ESL participants.
    Returns (is_bot_suspected, reason)
    """
    if word_count == 0:
        return True, "No words detected"

    # Extract words using Unicode-aware pattern (same as count_words)
    words = re.findall(r"\b\w+\b", description.lower(), flags=re.UNICODE)
    words = [w for w in words if re.search(r"[^\W\d_]", w, flags=re.UNICODE)]

    # Check for excessive repetition of the same word
    # Increased from 30% to 50% to be more lenient
    if len(words) > 10:
        word_freq = {}
        for word in words:
            word_freq[word] = word_freq.get(word, 0) + 1
        max_freq = max(word_freq.values())
        if max_freq / len(words) > 0.5:
            return True, f"Excessive word repetition detected"

    # Check for repeated word sequences (n-gram based)
    # Increased from 50% to 70% to be more lenient
    if len(words) > 20:
        trigrams = [tuple(words[i:i+3]) for i in range(len(words)-2)]
        if len(trigrams) > 5:
            unique_trigrams = len(set(trigrams))
            if unique_trigrams < len(trigrams) * 0.3:
                return True, f"Repeated word sequences detected"

    # Check for low lexical diversity (unique words / total words)
    # Increased from 30% to 20% to be more lenient for ESL participants
    if len(words) > 20:
        unique_ratio = len(set(words)) / len(words)
        if unique_ratio < 0.2:
            return True, f"Low lexical diversity detected"

    # Check for suspicious character patterns
    # Increased from 5 to 8 consecutive same characters
    if re.search(r"(.)\1{7,}", description):
        return True, f"Suspicious character repetition detected"

    return False, ""


def calculate_quality_score(word_count: int, attention_passed, time_spent_seconds: float, feedback: str, is_bot_suspected: bool = False) -> float:
    word_score = min(word_count / 150.0, 1.0)
    # attention_passed can be None for non-attention submissions - treat as neutral
    if attention_passed is None:
        attention_score = 1.0
    else:
        attention_score = 1.0 if attention_passed else 0.0
    time_score = 0.5 if time_spent_seconds and time_spent_seconds < TOO_FAST_SECONDS else 1.0
    feedback_score = min(len(feedback) / 50.0, 1.0)
    quality_score = 0.4 * word_score + 0.3 * attention_score + 0.2 * time_score + 0.1 * feedback_score
    # Significantly reduce quality score for bot-like content
    if is_bot_suspected:
        quality_score *= 0.3
    return round(quality_score, 3)


def _log_audit_event(db, event_type, participant_fk=None, participant_id=None, user_id=None,
                     endpoint=None, method=None, status_code=None, details=None):
    db.execute(
        text("""
            INSERT INTO audit_log
            (event_type, user_id, participant_fk, participant_id, endpoint, method, status_code, ip_hash, user_agent, details)
            VALUES (:event_type, :user_id, :participant_fk, :participant_id, :endpoint, :method, :status_code, :ip_hash, :user_agent, :details)
        """),
        {
            "event_type": event_type,
            "user_id": user_id,
            "participant_fk": participant_fk,
            "participant_id": participant_id,
            "endpoint": endpoint,
            "method": method,
            "status_code": status_code,
            "ip_hash": get_ip_hash(),
            "user_agent": request.headers.get("User-Agent", ""),
            "details": details,
        },
    )


def _log_performance_metric(endpoint, response_time_ms, status_code, request_size=0, response_size=0):
    # FIX: Use separate DB connection to ensure performance logs are always committed
    # even if the main transaction rolls back
    separate_conn = engine.connect()
    try:
        separate_conn.execute(
            text("""
                INSERT INTO performance_metrics
                (endpoint, response_time_ms, status_code, request_size_bytes, response_size_bytes)
                VALUES (:endpoint, :response_time_ms, :status_code, :request_size_bytes, :response_size_bytes)
            """),
            {
                "endpoint": endpoint,
                "response_time_ms": response_time_ms,
                "status_code": status_code,
                "request_size_bytes": request_size,
                "response_size_bytes": response_size,
            },
        )
        separate_conn.commit()
    except Exception as e:
        # Don't fail the request if performance logging fails
        app.logger.error(f"Failed to log performance metric: {e}")
    finally:
        separate_conn.close()


def track_performance(f):
    @functools.wraps(f)
    def wrapper(*args, **kwargs):
        start_time = time.time()
        try:
            result = f(*args, **kwargs)
            end_time = time.time()
            response_time_ms = int((end_time - start_time) * 1000)

            status_code = 200
            response_size = 0

            if isinstance(result, tuple):
                if len(result) >= 2:
                    response_obj = result[0]
                    status_code = result[1] if isinstance(result[1], int) else 200
                    if hasattr(response_obj, "get_data"):
                        try:
                            response_size = len(response_obj.get_data())
                        except Exception:
                            response_size = 0
                    elif hasattr(response_obj, "status_code"):
                        status_code = response_obj.status_code
                else:
                    response_obj = result[0]
                    if hasattr(response_obj, "status_code"):
                        status_code = response_obj.status_code
                    if hasattr(response_obj, "get_data"):
                        try:
                            response_size = len(response_obj.get_data())
                        except Exception:
                            response_size = 0
            else:
                response_obj = result
                if hasattr(response_obj, "status_code"):
                    status_code = response_obj.status_code
                if hasattr(response_obj, "get_data"):
                    try:
                        response_size = len(response_obj.get_data())
                    except Exception:
                        response_size = 0

            # FIX: Sample performance logs to reduce DB write amplification
            import random
            if random.random() < PERFORMANCE_LOG_SAMPLE_RATE:
                _log_performance_metric(
                    endpoint=request.path,
                    response_time_ms=response_time_ms,
                    status_code=status_code,
                    request_size=request.content_length or 0,
                    response_size=response_size,
                )
            return result
        except Exception:
            end_time = time.time()
            response_time_ms = int((end_time - start_time) * 1000)
            # FIX: Always log errors regardless of sample rate
            _log_performance_metric(
                endpoint=request.path,
                response_time_ms=response_time_ms,
                status_code=500,
                request_size=request.content_length or 0,
                response_size=0,
            )
            raise
    return wrapper


@app.errorhandler(400)
def bad_request(error):
    return jsonify({"error": "Bad request", "message": str(error.description)}), 400


@app.errorhandler(404)
def not_found(error):
    return jsonify({"error": "Not found", "message": str(error.description)}), 404


@app.errorhandler(409)
def conflict(error):
    return jsonify({"error": "Conflict", "message": str(error.description)}), 409


@app.errorhandler(413)
def request_entity_too_large(error):
    return jsonify({"error": "Request entity too large", "message": "Uploaded data exceeds maximum size limit"}), 413


@app.errorhandler(429)
def ratelimit_error(error):
    return jsonify({"error": "Rate limit exceeded", "message": "Too many requests. Please try again later."}), 429


@app.errorhandler(500)
def internal_server_error(error):
    app.logger.exception("Internal server error")
    return jsonify({"error": "Internal server error", "message": "An unexpected error occurred"}), 500


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
    return jsonify(status)


@app.route("/participants", methods=["POST"])
@limiter.limit("30 per minute")
@track_performance
def create_participant():
    data = request.get_json(silent=True) or {}
    required_fields = ["participant_id", "session_id", "username", "gender", "age", "place", "native_language", "prior_experience"]
    errors = {}
    for field in required_fields:
        if not data.get(field):
            errors[field] = f"{field.replace('_', ' ').title()} is required"
    if errors:
        return jsonify({"error": "Validation failed", "details": errors}), 400

    username = data.get("username", "").strip()
    if not username:
        return jsonify({"error": "Username is required"}), 400
    if not re.match(r"^[a-zA-Z0-9_]{3,50}$", username):
        return jsonify({"error": "Username must be 3-50 characters and contain only letters, numbers, and underscores"}), 400

    # FIX: Add session_id length validation
    session_id = data.get("session_id", "").strip()
    if not session_id:
        return jsonify({"error": "session_id is required"}), 400
    if len(session_id) > 100 or len(session_id) < 10:
        return jsonify({"error": "session_id must be between 10 and 100 characters"}), 400
    if not re.match(r"^[a-zA-Z0-9_-]+$", session_id):
        return jsonify({"error": "session_id can only contain letters, numbers, underscores, and hyphens"}), 400

    email = data.get("email", "").strip().lower()
    if email:
        if not re.match(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$", email):
            return jsonify({"error": "Invalid email format"}), 400
        domain = email.split("@")[1]
        if domain not in ALLOWED_EMAIL_DOMAINS:
            return jsonify({"error": f"Only {', '.join(ALLOWED_EMAIL_DOMAINS)} email addresses are allowed"}), 400

    phone = data.get("phone", "").strip()
    if phone:
        phone_digits = re.sub(r"\D", "", phone)
        is_valid_indian = re.match(r"^[6-9]\d{9}$", phone_digits) or (
            len(phone_digits) == 12 and phone_digits.startswith("91") and re.match(r"^[6-9]", phone_digits[2:])
        )
        if not is_valid_indian:
            return jsonify({"error": "Please enter a valid 10-digit Indian mobile number"}), 400

    try:
        age = int(data.get("age", 0))
        if age < MIN_AGE or age > MAX_AGE:
            return jsonify({"error": f"Age must be between {MIN_AGE} and {MAX_AGE}"}), 400
    except (ValueError, TypeError):
        return jsonify({"error": f"Age must be a valid number between {MIN_AGE} and {MAX_AGE}"}), 400

    gender = data.get("gender", "").strip().lower()
    place = data.get("place", "").strip().lower()
    native_language = data.get("native_language", "").strip().lower()
    prior_experience = data.get("prior_experience", "").strip()

    db = get_db()

    try:
        result = db.execute(
            text("""
                INSERT INTO participants
                (participant_id, session_id, username, email, phone, gender, age, place, native_language, prior_experience, ip_hash, user_agent)
                VALUES (:participant_id, :session_id, :username, :email, :phone, :gender, :age, :place, :native_language, :prior_experience, :ip_hash, :user_agent)
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
                "prior_experience": prior_experience,
                "ip_hash": get_ip_hash(),
                "user_agent": request.headers.get("User-Agent", ""),
            },
        )
        participant_fk = result.fetchone()[0]

        _log_audit_event(
            db,
            event_type="participant_created",
            participant_fk=participant_fk,
            participant_id=data["participant_id"],
            endpoint="/participants",
            method="POST",
            status_code=201,
            details="Participant created successfully",
        )

        db.commit()

        return jsonify({
            "status": "success",
            "participant_id": data["participant_id"],
            "participant_fk": participant_fk,
            "message": "Participant created successfully",
        }), 201

    except Exception as e:
        db.rollback()
        error_msg = str(e)
        if "duplicate" in error_msg.lower() or "unique" in error_msg.lower():
            return jsonify({"error": "Participant ID already exists"}), 409
        app.logger.exception("Participant creation failed for participant_id=%s", data.get("participant_id"))
        return jsonify({"error": "Database error"}), 500


@app.route("/participants/<participant_id>")
@limiter.limit("10 per minute")
def get_participant(participant_id):
    if not re.match(r"^[a-zA-Z0-9_\-]{10,100}$", participant_id):
        return jsonify({"error": "Invalid participant_id format"}), 400

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
    timestamp = datetime.now(timezone.utc)

    try:
        result = db.execute(
            text("SELECT id FROM participants WHERE participant_id = :participant_id FOR UPDATE"),
            {"participant_id": participant_id},
        )
        participant_row = result.fetchone()
        if not participant_row:
            db.rollback()
            return jsonify({"error": "Participant not found"}), 404

        participant_fk = participant_row[0]

        db.execute(
            text("""
                UPDATE participants SET consent_given = TRUE, consent_timestamp = :consent_timestamp
                WHERE id = :participant_fk
            """),
            {"consent_timestamp": timestamp, "participant_fk": participant_fk},
        )
        db.execute(
            text("""
                INSERT INTO consent_records (participant_fk, consent_given, consent_timestamp, ip_hash, user_agent)
                VALUES (:participant_fk, TRUE, :consent_timestamp, :ip_hash, :user_agent)
                ON CONFLICT(participant_fk) DO UPDATE SET
                consent_given = TRUE, consent_timestamp = EXCLUDED.consent_timestamp,
                ip_hash = EXCLUDED.ip_hash, user_agent = EXCLUDED.user_agent
            """),
            {
                "participant_fk": participant_fk,
                "consent_timestamp": timestamp,
                "ip_hash": get_ip_hash(),
                "user_agent": request.headers.get("User-Agent", ""),
            },
        )
        db.commit()
    except Exception:
        db.rollback()
        app.logger.exception("Failed to record consent for participant_id=%s", participant_id)
        return jsonify({"error": "Failed to record consent"}), 500

    return jsonify({"status": "success", "message": "Consent recorded successfully", "timestamp": timestamp})


@app.route("/payment/confirm", methods=["POST"])
@limiter.limit("30 per minute")
@track_performance
def confirm_payment():
    data = request.get_json(silent=True) or {}
    participant_id = data.get("participant_id")
    transaction_id = data.get("transaction_id", "").strip()
    amount = data.get("amount")
    gateway = data.get("gateway", "").strip()

    if not participant_id:
        return jsonify({"error": "participant_id required"}), 400
    if not transaction_id:
        return jsonify({"error": "transaction_id required"}), 400
    if not re.match(r"^[a-zA-Z0-9_\-]{10,100}$", transaction_id):
        return jsonify({"error": "Invalid transaction_id format"}), 400
    if amount is not None:
        try:
            amount = float(amount)
            if amount <= 0:
                return jsonify({"error": "amount must be greater than 0"}), 400
        except (ValueError, TypeError):
            return jsonify({"error": "Invalid amount format"}), 400
    if gateway and len(gateway) > 50:
        return jsonify({"error": "Invalid gateway format"}), 400

    db = get_db()

    try:
        # FIX: Only use SELECT FOR UPDATE to avoid race condition
        result = db.execute(
            text("SELECT id, payment_status FROM participants WHERE participant_id = :participant_id FOR UPDATE"),
            {"participant_id": participant_id},
        )
        participant_row = result.fetchone()
        if not participant_row:
            db.rollback()
            return jsonify({"error": "Participant not found"}), 400

        participant_fk = participant_row[0]
        current_status = participant_row[1]

        if current_status == 'paid':
            return jsonify({"status": "already_confirmed"}), 200

        db.execute(
            text("""
                UPDATE participants
                SET payment_status = 'paid'
                WHERE id = :participant_fk AND payment_status != 'paid'
            """),
            {"participant_fk": participant_fk},
        )
        _log_audit_event(
            db,
            event_type="payment_confirmed",
            participant_fk=participant_fk,
            participant_id=participant_id,
            endpoint="/payment/confirm",
            method="POST",
            status_code=200,
            details=f"Payment confirmed with transaction_id={transaction_id}, gateway={gateway}, amount={amount}",
        )
        db.commit()
    except Exception:
        db.rollback()
        app.logger.exception("Failed to confirm payment for participant_id=%s", participant_id)
        return jsonify({"error": "Failed to confirm payment"}), 500

    return jsonify({"status": "confirmed"})


def get_random_image_from_db(excluded_ids=None):
    db = get_db()
    # FIX: Use TABLESAMPLE for better scalability than OFFSET
    # TABLESAMPLE scans a random subset of pages, making it O(1) instead of O(N)
    import random

    if excluded_ids:
        # For excluded IDs, use WHERE clause with TABLESAMPLE
        for _ in range(3):  # Try up to 3 times to get a valid image
            result = db.execute(
                text("""
                    SELECT image_id, image_url FROM images TABLESAMPLE SYSTEM(1)
                    WHERE NOT image_id = ANY(:excluded_ids)
                    LIMIT 1
                """),
                {"excluded_ids": list(excluded_ids)},
            )
            row = result.fetchone()
            if row:
                return {"image_id": row[0], "image_url": row[1]}
    else:
        # No exclusions, simpler query
        for _ in range(3):  # Try up to 3 times to get a valid image
            result = db.execute(
                text("""
                    SELECT image_id, image_url FROM images TABLESAMPLE SYSTEM(1)
                    LIMIT 1
                """)
            )
            row = result.fetchone()
            if row:
                return {"image_id": row[0], "image_url": row[1]}

    # Fallback to ORDER BY RANDOM() if TABLESAMPLE fails to find a result
    # (only happens in edge cases with very few images or large exclusion lists)
    if excluded_ids:
        result = db.execute(
            text("""
                SELECT image_id, image_url FROM images
                WHERE NOT image_id = ANY(:excluded_ids)
                ORDER BY RANDOM()
                LIMIT 1
            """),
            {"excluded_ids": list(excluded_ids)},
        )
    else:
        result = db.execute(
            text("""
                SELECT image_id, image_url FROM images
                ORDER BY RANDOM()
                LIMIT 1
            """)
        )
    row = result.fetchone()
    if row:
        return {"image_id": row[0], "image_url": row[1]}
    return None


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


@app.route("/submit", methods=["POST"])
@limiter.limit("60 per minute")
@track_performance
def submit():
    payload = request.get_json(silent=True) or {}
    participant_id = payload.get("participant_id")
    if not participant_id:
        return jsonify({"error": "participant_id is required"}), 400

    db = get_db()
    participant_fk = _get_participant_fk(db, participant_id)
    if not participant_fk:
        return jsonify({"error": "Participant not found. Please complete registration first."}), 400

    flag_check = db.execute(
        text("SELECT is_flagged FROM attention_stats WHERE participant_fk = :participant_fk"),
        {"participant_fk": participant_fk},
    ).fetchone()
    if flag_check and flag_check[0]:
        return jsonify({"error": "Account flagged for low attention quality"}), 403

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

    if not re.match(r"^[a-zA-Z0-9_\-]{5,50}$", image_id):
        return jsonify({"error": "Invalid image_id format"}), 400

    if not description:
        return jsonify({"error": "description is required"}), 400
    if len(description) > MAX_DESCRIPTION_LENGTH:
        return jsonify({"error": f"description must not exceed {MAX_DESCRIPTION_LENGTH} characters"}), 400

    word_count = count_words(description)
    if word_count < MIN_WORD_COUNT:
        return jsonify({"error": f"Minimum {MIN_WORD_COUNT} words required", "word_count": word_count}), 400

    # FIX: Add bot detection
    is_bot_suspected, bot_reason = detect_bot_like_content(description, word_count)
    if is_bot_suspected:
        app.logger.warning(f"Bot-like content detected from participant_id=%s: %s", participant_id, bot_reason)

    rating = payload.get("rating")
    time_spent_seconds = payload.get("time_spent_seconds")
    if rating is None:
        return jsonify({"error": "rating is required"}), 400
    try:
        rating = int(rating)
        if not MIN_RATING <= rating <= MAX_RATING:
            return jsonify({"error": f"rating must be an integer between {MIN_RATING}-{MAX_RATING}"}), 400
    except (TypeError, ValueError):
        return jsonify({"error": f"rating must be an integer between {MIN_RATING}-{MAX_RATING}"}), 400

    feedback = (payload.get("feedback") or "").strip()
    if len(feedback) < MIN_FEEDBACK_LENGTH:
        return jsonify({"error": f"comments must be at least {MIN_FEEDBACK_LENGTH} characters"}), 400
    if len(feedback) > MAX_FEEDBACK_LENGTH:
        return jsonify({"error": f"comments must not exceed {MAX_FEEDBACK_LENGTH} characters"}), 400

    if time_spent_seconds is not None:
        try:
            time_spent_seconds = float(time_spent_seconds)
            if time_spent_seconds < 0:
                time_spent_seconds = None
        except (TypeError, ValueError):
            time_spent_seconds = None

    is_survey = bool(payload.get("is_survey"))

    try:
        # FIX: survey_index should be NULL for non-survey submissions
        if is_survey:
            survey_index = int(payload.get("survey_index", 0))
            if survey_index < 0 or survey_index > 1000:
                return jsonify({"error": "survey_index must be between 0 and 1000"}), 400
        else:
            survey_index = None
    except (TypeError, ValueError):
        return jsonify({"error": "Invalid survey_index value"}), 400

    image_check = db.execute(
        text("SELECT image_id FROM images WHERE image_id = :image_id"),
        {"image_id": image_id},
    ).fetchone()

    if not image_check:
        return jsonify({"error": "Invalid image_id"}), 400

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
        # FIX: Removed redundant duplicate check - rely on unique index only
        quality_score = calculate_quality_score(word_count, attention_passed, time_spent_seconds, feedback, is_bot_suspected)

        # FIX: Set attention_score_snapshot to None initially
        # Will be updated after stats are updated (below)
        attention_score_snapshot = None
        current_attention_score = None

        # FIX: Removed redundant image_url - it's available via image_id foreign key

        db.execute(
            text("""
                INSERT INTO submissions
                (participant_fk, session_id, image_id, survey_index, description, word_count, rating,
                 feedback, time_spent_seconds, is_survey, is_attention, attention_passed, too_fast_flag,
                 attention_score_at_submission, quality_score, ai_suspected, user_agent, ip_hash)
                VALUES (:participant_fk, :session_id, :image_id, :survey_index, :description, :word_count, :rating,
                 :feedback, :time_spent_seconds, :is_survey, :is_attention, :attention_passed, :too_fast_flag,
                 :attention_score_at_submission, :quality_score, :ai_suspected, :user_agent, :ip_hash)
            """),
            {
                "participant_fk": participant_fk,
                "session_id": payload.get("session_id", ""),
                "image_id": image_id,
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
                "ai_suspected": is_bot_suspected,
                "user_agent": request.headers.get("User-Agent", ""),
                "ip_hash": get_ip_hash(),
            },
        )

        if is_attention:
            # Use atomic SQL UPSERT - no need for SELECT FOR UPDATE
            # Get the updated attention score for the submission record
            result = db.execute(
                text("""
                    INSERT INTO attention_stats
                    (participant_fk, total_checks, passed_checks, failed_checks, attention_score, is_flagged)
                    VALUES (:participant_fk, 1, :passed, :failed, (:passed)::FLOAT, (:passed)::FLOAT < :threshold)
                    ON CONFLICT(participant_fk) DO UPDATE SET
                    total_checks = attention_stats.total_checks + 1,
                    passed_checks = attention_stats.passed_checks + :passed,
                    failed_checks = attention_stats.failed_checks + :failed,
                    attention_score = (attention_stats.passed_checks + :passed)::FLOAT / (attention_stats.total_checks + 1),
                    is_flagged = ((attention_stats.passed_checks + :passed)::FLOAT / (attention_stats.total_checks + 1)) < :threshold
                        AND (attention_stats.total_checks + 1) >= :min_checks
                    RETURNING attention_score
                """),
                {
                    "participant_fk": participant_fk,
                    "passed": 1 if attention_passed else 0,
                    "failed": 0 if attention_passed else 1,
                    "threshold": ATTENTION_FLAG_THRESHOLD,
                    "min_checks": ATTENTION_FLAG_MIN_CHECKS,
                },
            )
            current_attention_score = result.fetchone()[0]
        else:
            current_attention_score = None

        _update_participant_stats_internal(
            db, participant_fk, word_count, is_survey,
            current_attention_score if is_attention else None,
        )

        _log_audit_event(
            db,
            event_type="submission_created",
            participant_fk=participant_fk,
            participant_id=participant_id,
            endpoint="/submit",
            method="POST",
            status_code=200,
            details=f"survey_index={survey_index} word_count={word_count} quality_score={quality_score}",
        )

        db.commit()

        return jsonify({"status": "ok", "word_count": word_count, "attention_passed": attention_passed, "quality_score": quality_score})

    except Exception as e:
        db.rollback()
        if "unique" in str(e).lower() or "duplicate" in str(e).lower():
            return jsonify({"error": "Submission already recorded for this survey index"}), 409
        app.logger.exception("Failed to save submission for participant_id=%s", participant_id)
        return jsonify({"error": "Failed to save submission"}), 500


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
            "confirm_participation": {"path": "/payment/confirm", "method": "POST"},
            "random_image": {"path": "/images/random", "method": "GET"},
            "submit": {"path": "/submit", "method": "POST"},
            "api_docs": {"path": "/docs", "method": "GET"},
        },
    })
