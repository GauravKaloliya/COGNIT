import hashlib
import os
import random
import re
import time
import functools
from datetime import datetime, timezone
from pathlib import Path
from contextlib import contextmanager

from flask import Flask, jsonify, request, send_from_directory, abort, g, render_template
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from sqlalchemy import create_engine, text, event, Column, Integer, String, Boolean, Float, TIMESTAMP, CheckConstraint, ForeignKey
from sqlalchemy.orm import sessionmaker, scoped_session, declarative_base
from sqlalchemy.pool import QueuePool, NullPool

BASE_DIR = Path(__file__).resolve().parent
IMAGES_DIR = BASE_DIR / "images"
DATA_DIR = BASE_DIR / "data"

MIN_WORD_COUNT = int(os.getenv("MIN_WORD_COUNT", "60"))
TOO_FAST_SECONDS = float(os.getenv("TOO_FAST_SECONDS", "5"))
IP_HASH_SALT = os.getenv("IP_HASH_SALT", "local-salt")

RAZORPAY_KEY_ID = os.getenv("RAZORPAY_KEY_ID")
RAZORPAY_KEY_SECRET = os.getenv("RAZORPAY_KEY_SECRET")
RAZORPAY_WEBHOOK_SECRET = os.getenv("RAZORPAY_WEBHOOK_SECRET")

razorpay_client = None

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise ValueError("DATABASE_URL environment variable is required")

if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

WEBSITE_URL = os.getenv("WEBSITE_URL", "").strip()
IS_VERCEL = os.getenv("VERCEL_ENV") is not None

app = Flask(__name__)

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
    if env_origins:
        origins = [origin.strip() for origin in env_origins.split(",") if origin.strip()]
        # Security: Never allow wildcard origins
        if "*" in origins:
            raise ValueError("Wildcard CORS origins ('*') are not allowed. Use specific domains only.")
        return origins
    
    # Default origins - no wildcards allowed
    origins = ["http://localhost:5173", "http://localhost:3000"]
    
    # Add production domain if configured
    if WEBSITE_URL:
        if WEBSITE_URL not in origins:
            origins.append(WEBSITE_URL)
    
    return origins

CORS(app, resources={
    r"/api/*": {
        "origins": _get_cors_origins(),
        "methods": ["GET", "POST", "OPTIONS"],
        "allow_headers": ["Content-Type", "Authorization", "X-Requested-With"],
        "supports_credentials": False,
        "max_age": 86400
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

def get_razorpay_client():
    global razorpay_client
    if razorpay_client is None:
        if RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET:
            try:
                import razorpay
                razorpay_client = razorpay.Client(auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET))
            except Exception as e:
                app.logger.error(f"Failed to initialize Razorpay client: {e}")
                return None
    return razorpay_client

def get_ip_hash():
    ip_address = request.headers.get("X-Forwarded-For", request.remote_addr) or "unknown"
    digest = hashlib.sha256(f"{ip_address}{IP_HASH_SALT}".encode("utf-8")).hexdigest()
    return digest

def generate_receipt(participant_id: str) -> str:
    base = f"{participant_id}_{int(time.time())}"
    short_hash = hashlib.sha256(base.encode()).hexdigest()[:24]
    return f"rcpt_{short_hash}"

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

@app.route("/api/health")
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
    try:
        if IMAGES_DIR.exists():
            status["services"]["images"] = "accessible"
        else:
            status["services"]["images"] = "not found"
            status["status"] = "degraded"
    except Exception as e:
        status["services"]["images"] = f"error: {str(e)}"
        status["status"] = "degraded"
    return jsonify(status)

@app.route("/test-db")
def test_db():
    try:
        db = get_db()
        db.execute(text("SELECT 1"))
        return jsonify({"status": "Database working"})
    except Exception as e:
        return jsonify({"error": str(e)})


@app.route("/api/participants", methods=["POST"])
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
    
    try:
        db = get_db()
        _log_audit_event(db, event_type='participant_creation_attempt', participant_id=data['participant_id'],
                        endpoint='/api/participants', method='POST', status_code=201, details='Participant creation attempt')
        
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
        
        db.commit()
        _log_audit_event(db, event_type='participant_created', participant_fk=participant_fk, participant_id=data['participant_id'],
                        endpoint='/api/participants', method='POST', status_code=201, details='Participant created successfully')
        
        return jsonify({"status": "success", "participant_id": data['participant_id'], "participant_fk": participant_fk,
                       "message": "Participant created successfully"}), 201
    except Exception as e:
        error_msg = str(e)
        if "duplicate" in error_msg.lower() or "unique" in error_msg.lower():
            _log_audit_event(db, event_type='participant_creation_failed', participant_id=data['participant_id'],
                           endpoint='/api/participants', method='POST', status_code=409, details=f'Duplicate participant ID: {error_msg}')
            return jsonify({"error": "Participant ID already exists"}), 409
        _log_audit_event(db, event_type='participant_creation_failed', participant_id=data['participant_id'],
                       endpoint='/api/participants', method='POST', status_code=500, details=f'Database error: {error_msg}')
        return jsonify({"error": "Database error", "details": error_msg}), 500

@app.route("/api/participants/<participant_id>")
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

@app.route("/api/consent", methods=["POST"])
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

@app.route("/api/consent/<participant_id>")
def get_consent(participant_id):
    db = get_db()
    result = db.execute(text('''
        SELECT consent_given, consent_timestamp FROM consent_records WHERE participant_id = :participant_id
    '''), {"participant_id": participant_id})
    row = result.fetchone()
    if not row:
        return jsonify({"participant_id": participant_id, "consent_given": False, "consent_timestamp": None})
    return jsonify({"participant_id": participant_id, "consent_given": bool(row[0]), "consent_timestamp": str(row[1]) if row[1] else None})


@app.route("/api/payment/create-order", methods=["POST"])
@limiter.limit("30 per minute")
@track_performance
def create_order():
    data = request.get_json(silent=True) or {}
    participant_id = data.get("participant_id")
    if not participant_id:
        return jsonify({"error": "participant_id required"}), 400
    if not RAZORPAY_KEY_ID or not RAZORPAY_KEY_SECRET:
        return jsonify({"error": "Payment gateway not configured"}), 500
    client = get_razorpay_client()
    if not client:
        return jsonify({"error": "Payment gateway not configured"}), 500
    
    amount = 100
    db = get_db()
    participant_row = db.execute(text("SELECT id FROM participants WHERE participant_id = :participant_id"),
                                  {"participant_id": participant_id}).fetchone()
    if not participant_row:
        return jsonify({"error": "Participant not found"}), 400
    participant_fk = participant_row[0]
    
    existing_order = db.execute(text("""
        SELECT razorpay_order_id, status FROM payments
        WHERE participant_fk = :participant_fk ORDER BY created_at DESC LIMIT 1
    """), {"participant_fk": participant_fk}).fetchone()
    
    if existing_order and existing_order[1] != 'paid':
        return jsonify({"order_id": existing_order[0], "key": RAZORPAY_KEY_ID, "amount": amount, "currency": "INR"})
    
    try:
        receipt_value = generate_receipt(participant_id)
        order = client.order.create({"amount": amount, "currency": "INR", "receipt": receipt_value, "payment_capture": 1})
    except Exception as e:
        app.logger.error(f"Razorpay order creation failed: {e}")
        return jsonify({"error": "Failed to create payment order", "details": str(e)}), 500
    
    db.execute(text("""
        INSERT INTO payments (participant_fk, participant_id, razorpay_order_id, amount, status)
        VALUES (:participant_fk, :participant_id, :order_id, :amount, 'created')
    """), {"participant_fk": participant_fk, "participant_id": participant_id, "order_id": order["id"], "amount": amount})
    db.commit()
    return jsonify({"order_id": order["id"], "key": RAZORPAY_KEY_ID, "amount": amount, "currency": "INR"})

@app.route("/api/payment/verify", methods=["POST"])
@limiter.limit("60 per minute")
@track_performance
def verify_payment():
    data = request.get_json(silent=True) or {}
    required_fields = ["razorpay_order_id", "razorpay_payment_id", "razorpay_signature"]
    missing_fields = [field for field in required_fields if not data.get(field)]
    if missing_fields:
        return jsonify({"error": "Missing payment fields", "fields": missing_fields}), 400
    
    client = get_razorpay_client()
    if not client:
        return jsonify({"error": "Payment gateway not configured"}), 500
    try:
        import razorpay
        client.utility.verify_payment_signature(data)
    except razorpay.errors.SignatureVerificationError:
        return jsonify({"error": "Invalid signature"}), 400
    
    db = get_db()
    db.execute(text("""
        UPDATE payments SET razorpay_payment_id = :payment_id, razorpay_signature = :signature,
        status = 'paid', paid_at = CURRENT_TIMESTAMP WHERE razorpay_order_id = :order_id
    """), {"payment_id": data["razorpay_payment_id"], "signature": data["razorpay_signature"], "order_id": data["razorpay_order_id"]})
    
    db.execute(text("""
        UPDATE participants SET payment_status = 'paid'
        WHERE id = (SELECT participant_fk FROM payments WHERE razorpay_order_id = :order_id)
    """), {"order_id": data["razorpay_order_id"]})
    db.commit()
    return jsonify({"status": "verified"})

@app.route("/api/payment/webhook", methods=["POST"])
@track_performance
def payment_webhook():
    if not RAZORPAY_WEBHOOK_SECRET:
        return jsonify({"error": "Payment webhook not configured"}), 500
    client = get_razorpay_client()
    if not client:
        return jsonify({"error": "Payment gateway not configured"}), 500
    
    payload = request.get_data()
    signature = request.headers.get("X-Razorpay-Signature")
    if not signature:
        return jsonify({"error": "Missing webhook signature"}), 400
    
    try:
        import razorpay
        client.utility.verify_webhook_signature(payload, signature, RAZORPAY_WEBHOOK_SECRET)
    except razorpay.errors.SignatureVerificationError:
        return jsonify({"error": "Invalid webhook signature"}), 400
    
    event = request.get_json(silent=True) or {}
    if event.get("event") == "payment.captured":
        payment_entity = event.get("payload", {}).get("payment", {}).get("entity", {})
        order_id = payment_entity.get("order_id")
        payment_id = payment_entity.get("id")
        if order_id and payment_id:
            db = get_db()
            result = db.execute(text("""
                UPDATE payments SET status = 'paid', razorpay_payment_id = :payment_id, paid_at = CURRENT_TIMESTAMP
                WHERE razorpay_order_id = :order_id AND status != 'paid'
            """), {"payment_id": payment_id, "order_id": order_id})
            if result.rowcount > 0:
                db.execute(text("""
                    UPDATE participants SET payment_status = 'paid'
                    WHERE id = (SELECT participant_fk FROM payments WHERE razorpay_order_id = :order_id)
                """), {"order_id": order_id})
                db.commit()
    return jsonify({"status": "ok"})

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

@app.route("/api/images/random")
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

@app.route("/api/images/<path:image_id>")
def serve_image(image_id):
    if image_id.endswith('.svg'):
        return send_from_directory(IMAGES_DIR, image_id, mimetype='image/svg+xml')
    return send_from_directory(IMAGES_DIR, image_id)


@app.route("/api/submit", methods=["POST"])
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
                        endpoint='/api/submit', method='POST', status_code=200, details=f'Failed to insert image {image_id}: {str(e)}')
    
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

@app.route("/api/reward/entries")
@limiter.limit("60 per minute")
def get_reward_entries():
    db = get_db()
    result = db.execute(text("SELECT COUNT(*) FROM participants"))
    row = result.fetchone()
    count = int(row[0]) if row else 0
    return jsonify({"count": count})


@app.route("/api/reward/<participant_id>")
def get_reward_status(participant_id):
    db = get_db()
    participant_fk = _get_or_create_participant_fk(db, participant_id)
    if not participant_fk:
        return jsonify({"error": "Participant not found"}), 404
    status = get_reward_eligibility(participant_fk)
    return jsonify(status)

@app.route("/api/reward/select/<participant_id>", methods=["POST"])
@limiter.limit("10 per minute")
def check_reward_winner(participant_id):
    result = select_reward_winner(participant_id)
    return jsonify(result)

@app.route("/api/submissions/<participant_id>")
def get_participant_submissions(participant_id):
    db = get_db()
    participant_fk = _get_or_create_participant_fk(db, participant_id)
    if not participant_fk:
        return jsonify({"error": "Participant not found"}), 404
    
    result = db.execute(text('''
        SELECT id, image_id, survey_index, description, word_count, rating, feedback, 
               time_spent_seconds, is_survey, is_attention, attention_passed, 
               attention_score_at_submission, quality_score, ai_suspected, created_at
        FROM submissions WHERE participant_fk = :participant_fk ORDER BY created_at DESC
    '''), {"participant_fk": participant_fk})
    
    rows = result.fetchall()
    submissions = []
    for row in rows:
        submissions.append({
            "id": row[0], "image_id": row[1], "survey_index": row[2], "description": row[3], "word_count": row[4],
            "rating": row[5], "feedback": row[6], "time_spent_seconds": row[7], "is_survey": bool(row[8]),
            "is_attention": bool(row[9]), "attention_passed": row[10], "attention_score_at_submission": row[11],
            "quality_score": row[12], "ai_suspected": bool(row[13]) if row[13] is not None else False, "created_at": str(row[14])
        })
    return jsonify(submissions)


@app.route("/api/security/info")
@track_performance
def security_info():
    cors_origins = _get_cors_origins()
    return jsonify({
        "security": {
            "version": "4.0.0",
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
        "version": "4.0.0",
        "description": "C.O.G.N.I.T. (Cognitive Network for Image & Text Modeling) research platform API. Version 4.0.0 introduces surrogate key architecture for improved data integrity.",
        "base_url": "/api",
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
            "health": {"path": "/api/health", "method": "GET", "auth_required": False},
            "security_info": {"path": "/api/security/info", "method": "GET", "auth_required": False},
            "create_participant": {"path": "/api/participants", "method": "POST", "auth_required": False},
            "get_participant": {"path": "/api/participants/<participant_id>", "method": "GET", "auth_required": False},
            "record_consent": {"path": "/api/consent", "method": "POST", "auth_required": False},
            "get_consent": {"path": "/api/consent/<participant_id>", "method": "GET", "auth_required": False},
            "create_order": {"path": "/api/payment/create-order", "method": "POST", "auth_required": False},
            "verify_payment": {"path": "/api/payment/verify", "method": "POST", "auth_required": False},
            "payment_webhook": {"path": "/api/payment/webhook", "method": "POST", "auth_required": False},
            "random_image": {"path": "/api/images/random", "method": "GET", "auth_required": False},
            "serve_image": {"path": "/api/images/<image_id>", "method": "GET", "auth_required": False},
            "submit": {"path": "/api/submit", "method": "POST", "auth_required": False},
            "reward_entries": {"path": "/api/reward/entries", "method": "GET", "auth_required": False},
            "get_reward_status": {"path": "/api/reward/<participant_id>", "method": "GET", "auth_required": False},
            "select_reward_winner": {"path": "/api/reward/select/<participant_id>", "method": "POST", "auth_required": False},
            "get_submissions": {"path": "/api/submissions/<participant_id>", "method": "GET", "auth_required": False}
        },
        "changelog": {
            "4.0.0": "Surrogate key migration: All foreign keys now use BIGINT participant_fk referencing participants(id). Standardized ID types to VARCHAR(100). Added range constraints on scores (0-1).",
            "3.6.0": "Added quality_score, attention_score_at_submission, ai_suspected columns; reward_winners table; quality score calculation.",
            "3.5.0": "Migrated from SQLite to PostgreSQL.",
            "3.4.0": "Updated application name to C.O.G.N.I.T.",
            "3.3.0": "Added reward system with participant_stats and reward_winners tables.",
            "3.2.0": "Added images table and survey_index column.",
            "3.1.0": "Updated documentation and improved error handling."
        }
    }

@app.route("/")
def serve_api_docs():
    return render_template("api_docs.html", version="4.0.0", base_url="/api")

@app.route("/api/docs")
@limiter.limit("30 per minute")
@track_performance
def get_api_docs():
    return jsonify(_get_api_documentation())

