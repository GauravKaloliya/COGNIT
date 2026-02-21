import hashlib
import os
import re
import time
import functools
import random
import urllib.parse
import hmac
from io import BytesIO
import base64
from datetime import datetime, timedelta, timezone
from flask import Flask, jsonify, request, g, current_app, render_template
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, scoped_session
from sqlalchemy.pool import NullPool
import qrcode
import pytesseract
from PIL import Image
import boto3

# ────────────────────────────────────────────────
# Constants & Environment
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

PERFORMANCE_LOG_SAMPLE_RATE = float(os.getenv("PERFORMANCE_LOG_SAMPLE_RATE", "0.10"))

# Payment & UPI Configuration
UPI_VPA = os.getenv("UPI_VPA")
if not UPI_VPA:
    raise ValueError("UPI_VPA is required")
UPI_NAME = os.getenv("UPI_NAME")
if not UPI_NAME:
    raise ValueError("UPI_NAME is required")
PAYMENT_SECRET = os.getenv("PAYMENT_SECRET")
if not PAYMENT_SECRET:
    raise ValueError("PAYMENT_SECRET is required")
PAYMENT_EXPIRY_SECONDS = int(os.getenv("PAYMENT_EXPIRY_SECONDS", "300"))

# UPI Screenshot Validation Configuration
ALLOWED_APPS = {
    "gpay": ["gpay", "google pay", "tez"],
    "phonepe": ["phonepe"],
    "paytm": ["paytm"],
    "bhim": ["bhim"],
    "amazonpay": ["amazon pay", "amazonpay"],
    "bharatpe": ["bharatpe"]
}

SUCCESS_KEYWORDS = ["success", "successful", "completed", "paid", "payment successful", "transaction successful"]
FAILURE_KEYWORDS = ["failed", "pending", "declined", "cancelled"]
MIN_OCR_CONFIDENCE = 55
MIN_IMAGE_WIDTH = 600

# S3 Configuration
AWS_ACCESS_KEY_ID = os.getenv("AWS_ACCESS_KEY_ID")
AWS_SECRET_ACCESS_KEY = os.getenv("AWS_SECRET_ACCESS_KEY")
AWS_REGION = os.getenv("AWS_REGION", "ap-south-1")
S3_BUCKET = os.getenv("S3_BUCKET", "cognitapi")

IP_HASH_SALT = os.getenv("IP_HASH_SALT")
if not IP_HASH_SALT:
    raise ValueError("IP_HASH_SALT is required")

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise ValueError("DATABASE_URL is required")
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    raise ValueError("SECRET_KEY is required")

app = Flask(__name__)
app.url_map.strict_slashes = False
app.config["SECRET_KEY"] = SECRET_KEY
app.config["SESSION_COOKIE_SECURE"] = True
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["MAX_CONTENT_LENGTH"] = 1 * 1024 * 1024

cors_origins = os.getenv("CORS_ORIGINS", "*")
if cors_origins != "*":
    cors_origins = [origin.strip() for origin in cors_origins.split(",")]
CORS(app, resources={r"/*": {"origins": cors_origins}})

limiter = Limiter(
    app=app,
    key_func=get_remote_address,
    default_limits=["200 per day", "50 per hour"],
    storage_uri=os.getenv("RATELIMIT_STORAGE_URI", "memory://")
)

engine = create_engine(
    DATABASE_URL,
    poolclass=NullPool,
    pool_pre_ping=True,
    connect_args={"sslmode": "require"} if "sslmode" not in DATABASE_URL else {}
)

SessionLocal = scoped_session(sessionmaker(bind=engine))

# S3 Client Setup
s3 = boto3.client(
    "s3",
    region_name=AWS_REGION,
    aws_access_key_id=AWS_ACCESS_KEY_ID,
    aws_secret_access_key=AWS_SECRET_ACCESS_KEY,
)

def get_db():
    if "db" not in g:
        g.db = SessionLocal()
    return g.db

@app.teardown_appcontext
def teardown_db(exception):
    db = g.pop("db", None)
    if db is not None:
        db.close()
    SessionLocal.remove()

# ────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────

def get_ip_hash():
    ip = (request.headers.get("X-Forwarded-For", request.remote_addr or "unknown")
          .split(",")[0].strip())
    if ip in ("", "unknown"):
        return "0" * 64
    try:
        import ipaddress
        return hashlib.sha256(f"{ipaddress.ip_address(ip)}{IP_HASH_SALT}".encode()).hexdigest()
    except:
        return "0" * 64

def count_words(text: str) -> int:
    if not text.strip():
        return 0
    words = re.findall(r"\b\w+\b", text.strip(), re.UNICODE)
    return len([w for w in words if re.search(r"[^\W\d_]", w, re.UNICODE)])

# AI detection completely removed - using attention checks for quality control only
def detect_bot_like_content(text: str, wc: int) -> tuple[bool, str]:
    # Always return False - AI detection completely disabled
    return False, ""

def calculate_quality_score(wc: int, att: bool | None, ts: float | None, fb_len: int, bot: bool) -> float:
    s_word = min(wc / 150.0, 1.0)
    s_att = 1.0 if att is None else (1.0 if att else 0.0)
    s_time = 0.5 if ts is not None and ts < TOO_FAST_SECONDS else 1.0
    s_fb = min(fb_len / 50.0, 1.0)
    score = 0.4 * s_word + 0.3 * s_att + 0.2 * s_time + 0.1 * s_fb
    if bot:
        score *= 0.3
    return round(score, 4)

def log_audit(db, event_type: str, participant_id: int | None = None, details: str = ""):
    db.execute(text("""
        INSERT INTO audit_log (
            event_type, participant_id, endpoint, http_method,
            ip_hash, user_agent, details
        ) VALUES (:ev, :pid, :ep, :meth, :iph, :ua, :det)
    """), {
        "ev": event_type,
        "pid": participant_id,
        "ep": request.path,
        "meth": request.method,
        "iph": get_ip_hash(),
        "ua": request.headers.get("User-Agent", "")[:512],
        "det": details[:8000]
    })

def set_rls_context(db, participant_id: int):
    db.execute(text("SET LOCAL app.current_participant_id = :pid"), {"pid": participant_id})

# ────────────────────────────────────────────────
# Payment & UPI Helpers
# ────────────────────────────────────────────────

def generate_payment_signature(public_id: str, amount: str, expires_at: str) -> str:
    payload = f"{public_id}:{amount}:{expires_at}"
    return hmac.new(
        PAYMENT_SECRET.encode(),
        payload.encode(),
        hashlib.sha256
    ).hexdigest()

def generate_upi_link(amount: float, note: str):
    params = {
        "pa": UPI_VPA,
        "pn": UPI_NAME,
        "am": f"{amount:.2f}",
        "cu": "INR",
        "tn": note
    }
    return "upi://pay?" + urllib.parse.urlencode(params)

def fetch_s3_image(object_key):
    obj = s3.get_object(Bucket=S3_BUCKET, Key=object_key)
    file_bytes = obj["Body"].read()
    return Image.open(BytesIO(file_bytes))

def extract_text_with_confidence(image):
    """Extract text and calculate OCR confidence score."""
    from pytesseract import Output
    data = pytesseract.image_to_data(image, output_type=Output.DICT)
    words = []
    confidences = []
    for i, word in enumerate(data["text"]):
        try:
            conf = int(data["conf"][i])
        except:
            continue
        if conf > 0 and word.strip():
            words.append(word)
            confidences.append(conf)
    if not words:
        return "", 0
    return " ".join(words), sum(confidences)/len(confidences)

def detect_upi_app(text):
    """Detect which UPI app from allowed whitelist."""
    lower = text.lower()
    for app, keywords in ALLOWED_APPS.items():
        if any(k in lower for k in keywords):
            return app
    return None

def normalize_vpa(text):
    """Normalize VPA for comparison."""
    return re.sub(r'[^a-z0-9@.]', '', text.lower())

def verify_payment_screenshot(image, text, expected_amount, payment_note, confidence):
    """
    Strict validation of UPI payment screenshot.
    Returns: (is_valid, detected_app, failure_reasons)
    """
    failures = []
    lower = text.lower()
    
    # 1. Resolution check
    if image.width < MIN_IMAGE_WIDTH:
        failures.append("low_resolution")
    
    # 2. OCR confidence check
    if confidence < MIN_OCR_CONFIDENCE:
        failures.append("low_ocr_confidence")
    
    # 3. App detection
    detected_app = detect_upi_app(text)
    if not detected_app:
        failures.append("unrecognized_app")
    
    # 4. VPA match
    if normalize_vpa(UPI_VPA) not in normalize_vpa(lower):
        failures.append("vpa_mismatch")
    
    # 5. Note binding - payment note must be in text
    if payment_note and payment_note.lower() not in lower:
        failures.append("note_mismatch")
    
    # 6. Amount match (₹1 with variations)
    if not re.search(r"\b1(\.00)?\b", lower):
        failures.append("amount_mismatch")
    
    # 7. Success keyword required
    if not any(k in lower for k in SUCCESS_KEYWORDS):
        failures.append("missing_success_indicator")
    
    # 8. Failure keywords forbidden
    if any(k in lower for k in FAILURE_KEYWORDS):
        failures.append("failure_indicator_present")
    
    # 9. Transaction ID required
    txn_match = re.search(r"\b[a-zA-Z0-9]{12,30}\b", text)
    if not txn_match:
        failures.append("missing_transaction_id")
    
    return len(failures) == 0, detected_app, failures

def extract_upi_ref(text: str):
    match = re.search(r"\b\d{12,16}\b", text)
    return match.group(0) if match else None

def compute_fraud_score(text: str, expected_amount: float):
    score = 0.0
    lower = text.lower()

    # Missing amount
    if f"{expected_amount:.2f}" not in lower:
        score += 30

    # Suspicious keywords
    if "failed" in lower:
        score += 40
    if "pending" in lower:
        score += 20

    # No transaction ID
    if not extract_upi_ref(text):
        score += 30

    return min(score, 100.0)

# ────────────────────────────────────────────────
# Performance decorator
# ────────────────────────────────────────────────

def track_performance(f):
    @functools.wraps(f)
    def wrapper(*args, **kwargs):
        start = time.perf_counter()
        try:
            resp = f(*args, **kwargs)
            duration_ms = int((time.perf_counter() - start) * 1000)
            status = 200
            if isinstance(resp, tuple) and len(resp) > 1 and isinstance(resp[1], int):
                status = resp[1]

            if random.random() < PERFORMANCE_LOG_SAMPLE_RATE:
                db = get_db()
                db.execute(text("""
                    INSERT INTO performance_metrics (
                        endpoint, response_time_ms, status_code,
                        request_size_bytes, response_size_bytes
                    ) VALUES (:ep, :ms, :st, :req, 0)
                """), {
                    "ep": request.path, "ms": duration_ms, "st": status,
                    "req": request.content_length or 0
                })
            return resp
        except Exception as exc:
            duration_ms = int((time.perf_counter() - start) * 1000)
            if random.random() < PERFORMANCE_LOG_SAMPLE_RATE:
                db = get_db()
                db.execute(text("""
                    INSERT INTO performance_metrics (
                        endpoint, response_time_ms, status_code,
                        request_size_bytes, response_size_bytes
                    ) VALUES (:ep, :ms, 500, :req, 0)
                """), {"ep": request.path, "ms": duration_ms, "req": request.content_length or 0})
            raise exc
    return wrapper

# ────────────────────────────────────────────────
# Routes
# ────────────────────────────────────────────────

@app.route("/health")
@limiter.exempt
@track_performance
def health():
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return jsonify({"status": "healthy", "database": "connected"})
    except Exception as e:
        current_app.logger.error(f"Health check failed: {e}")
        return jsonify({"status": "degraded", "error": str(e)}), 503

@app.route("/participants", methods=["POST"])
@limiter.limit("30 per minute")
@track_performance
def create_participant():
    data = request.json or {}
    required = ["public_id", "session_id", "username", "gender_code", "age", "location", "language_code", "prior_experience"]
    missing = [f for f in required if f not in data or not data[f]]
    if missing:
        return jsonify({"error": "missing required fields", "fields": missing}), 400

    public_id = str(data["public_id"]).strip()
    if not re.match(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', public_id, re.I):
        return jsonify({"error": "invalid UUID format for public_id"}), 400

    db = get_db()
    iph = get_ip_hash()
    ua = request.headers.get("User-Agent", "")[:512]

    try:
        db.execute(text("""
            INSERT INTO participants (
                public_id, session_id, username, email, phone,
                gender_code, age, location, language_code, prior_experience,
                ip_hash, user_agent, extra_metadata
            ) VALUES (
                :pub, :sid, :un, :em, :ph, :gc, :age, :loc, :lc, :pe, :iph, :ua, '{}'
            )
        """), {
            "pub": public_id,
            "sid": str(data["session_id"]).strip()[:128],
            "un": str(data["username"]).strip()[:50],
            "em": data.get("email", "").strip()[:255] or None,
            "ph": data.get("phone", "").strip()[:20] or None,
            "gc": str(data["gender_code"]).strip().lower()[:32],
            "age": int(data["age"]),
            "loc": str(data["location"]).strip()[:120],
            "lc": str(data["language_code"]).strip().lower()[:20],
            "pe": str(data.get("prior_experience", "")).strip()[:120],
            "iph": iph,
            "ua": ua
        })
        db.commit()
        log_audit(db, "participant_created", details=f"public_id={public_id}")
        return jsonify({"status": "created", "public_id": public_id}), 201
    except Exception as e:
        db.rollback()
        if "unique" in str(e).lower():
            return jsonify({"error": "public_id or username conflict"}), 409
        current_app.logger.exception("create_participant failed")
        return jsonify({"error": "database error"}), 500

@app.route("/participants/<public_id>")
@limiter.limit("10 per minute")
@track_performance
def get_participant(public_id):
    db = get_db()
    row = db.execute(text("""
        SELECT username, email, phone, gender_code, age, location, language_code,
               prior_experience, consent_given, consent_at
        FROM participants
        WHERE public_id = :pub AND is_deleted = false
    """), {"pub": public_id}).fetchone()
    if not row:
        return jsonify({"error": "not found or deleted"}), 404

    return jsonify({
        "public_id": public_id,
        "username": row[0],
        "email": row[1],
        "phone": row[2],
        "gender_code": row[3],
        "age": row[4],
        "location": row[5],
        "language_code": row[6],
        "prior_experience": row[7],
        "consent_given": bool(row[8]),
        "consent_at": row[9].isoformat() if row[9] else None
    })

@app.route("/check-username")
@limiter.limit("30 per minute")
@track_performance
def check_username():
    username = request.args.get("username", "").strip()
    if not username:
        return jsonify({"error": "username parameter required"}), 400
    if len(username) < 2:
        return jsonify({"available": True})
    db = get_db()
    exists = db.execute(text("""
        SELECT 1 FROM participants
        WHERE username = :un AND is_deleted = false
        LIMIT 1
    """), {"un": username}).scalar()
    return jsonify({"available": not bool(exists)})


@app.route("/check-email")
@limiter.limit("30 per minute")
@track_performance
def check_email():
    email = request.args.get("email", "").strip().lower()
    if not email:
        return jsonify({"error": "email parameter required"}), 400
    db = get_db()
    exists = db.execute(text("""
        SELECT 1 FROM participants
        WHERE email = :em AND is_deleted = false
        LIMIT 1
    """), {"em": email}).scalar()
    return jsonify({"available": not bool(exists)})


@app.route("/check-phone")
@limiter.limit("30 per minute")
@track_performance
def check_phone():
    phone = request.args.get("phone", "").strip()
    if not phone:
        return jsonify({"error": "phone parameter required"}), 400
    db = get_db()
    exists = db.execute(text("""
        SELECT 1 FROM participants
        WHERE phone = :ph AND is_deleted = false
        LIMIT 1
    """), {"ph": phone}).scalar()
    return jsonify({"available": not bool(exists)})


@app.route("/consent", methods=["POST"])
@limiter.limit("20 per minute")
@track_performance
def record_consent():
    data = request.json or {}
    public_id = data.get("public_id")
    if not public_id:
        return jsonify({"error": "public_id required"}), 400

    db = get_db()
    try:
        row = db.execute(text("""
            SELECT id FROM participants
            WHERE public_id = :pub AND is_deleted = false
            FOR UPDATE
        """), {"pub": public_id}).fetchone()
        if not row:
            return jsonify({"error": "not found or deleted"}), 404
        pid = row[0]

        db.execute(text("""
            UPDATE participants
            SET consent_given = true, consent_at = CURRENT_TIMESTAMP
            WHERE id = :pid
        """), {"pid": pid})
        log_audit(db, "consent_recorded", participant_id=pid)
        db.commit()
        return jsonify({"status": "consent recorded"})
    except Exception:
        db.rollback()
        current_app.logger.exception("consent failed")
        return jsonify({"error": "server error"}), 500

@app.route("/images/random")
@track_performance
def random_image():
    exclude = request.args.get("exclude", "")
    excluded = [x.strip() for x in exclude.split(",") if x.strip()]

    db = get_db()
    where = "WHERE image_id NOT IN :ex" if excluded else ""
    params = {"ex": tuple(excluded)} if excluded else {}

    count = db.execute(text(f"SELECT COUNT(*) FROM images {where}"), params).scalar()
    if count == 0:
        return jsonify({"error": "no images"}), 404

    offset = random.randint(0, count - 1)
    row = db.execute(text(f"""
        SELECT image_id, url
        FROM images
        {where}
        OFFSET :off LIMIT 1
    """), {**params, "off": offset}).fetchone()

    if not row:
        return jsonify({"error": "selection failed"}), 500

    return jsonify({"image_id": row[0], "url": row[1]})

@app.route("/submit", methods=["POST"])
@limiter.limit("60 per minute")
@track_performance
def submit():
    d = request.json or {}
    public_id = d.get("public_id")
    if not public_id:
        return jsonify({"error": "public_id required"}), 400

    image_id_str = d.get("image_id")
    if not image_id_str:
        return jsonify({"error": "image_id required"}), 400

    description = (d.get("description") or "").strip()
    if len(description) < MIN_DESCRIPTION_LENGTH or len(description) > MAX_DESCRIPTION_LENGTH:
        return jsonify({"error": f"description must be {MIN_DESCRIPTION_LENGTH}–{MAX_DESCRIPTION_LENGTH} chars"}), 400

    feedback = (d.get("feedback") or "").strip()
    if len(feedback) < MIN_FEEDBACK_LENGTH or len(feedback) > MAX_FEEDBACK_LENGTH:
        return jsonify({"error": f"feedback must be {MIN_FEEDBACK_LENGTH}–{MAX_FEEDBACK_LENGTH} chars"}), 400

    try:
        rating = int(d["rating"])
        if not MIN_RATING <= rating <= MAX_RATING:
            raise ValueError
    except:
        return jsonify({"error": f"rating must be {MIN_RATING}–{MAX_RATING}"}), 400

    word_count = count_words(description)
    if word_count < MIN_WORD_COUNT:
        return jsonify({"error": f"at least {MIN_WORD_COUNT} words required", "actual": word_count}), 400

    ts = d.get("time_spent_seconds")
    if ts is not None:
        try:
            ts = float(ts)
            if ts < 0:
                ts = None
        except:
            ts = None

    is_survey = bool(d.get("is_survey"))
    survey_index = None
    if is_survey:
        try:
            survey_index = int(d["survey_index"])
            if survey_index < 0:
                raise ValueError
        except:
            return jsonify({"error": "survey_index must be >= 0"}), 400

    db = get_db()
    iph = get_ip_hash()
    ua = request.headers.get("User-Agent", "")[:512]

    p_row = db.execute(text("""
        SELECT p.id, p.consent_given, p.is_deleted, s.is_flagged
        FROM participants p
        LEFT JOIN participant_attention_stats s ON s.participant_id = p.id
        WHERE p.public_id = :pub
    """), {"pub": public_id}).fetchone()

    if not p_row or p_row[2]:
        return jsonify({"error": "participant not found or deleted"}), 404
    if p_row[3]:
        return jsonify({"error": "flagged – low attention"}), 403
    if not p_row[1]:
        return jsonify({"error": "consent required"}), 403

    participant_id = p_row[0]
    set_rls_context(db, participant_id)

    img_row = db.execute(text("SELECT id FROM images WHERE image_id = :iid"), {"iid": image_id_str}).fetchone()
    if not img_row:
        return jsonify({"error": "invalid image_id"}), 400
    image_id_fk = img_row[0]

    if not is_survey:
        dup = db.execute(text("""
            SELECT 1 FROM submissions
            WHERE participant_id = :pid AND image_id = :iid AND is_survey = false
        """), {"pid": participant_id, "iid": image_id_fk}).scalar()
        if dup:
            return jsonify({"error": "already submitted description for this image"}), 409

    ac_row = db.execute(text("""
        SELECT expected_word, is_strict
        FROM attention_checks
        WHERE image_id = :iid AND is_active = true
    """), {"iid": image_id_fk}).fetchone()

    is_attention = ac_row is not None
    attention_passed = None
    if is_attention:
        expected = ac_row[0].strip().lower()
        strict = ac_row[1]
        dlow = description.lower()
        attention_passed = bool(re.search(rf"\b{re.escape(expected)}\b", dlow)) if strict else (expected in dlow)

    too_fast = ts is not None and ts < TOO_FAST_SECONDS
    # AI detection completely removed - using attention check only
    quality = calculate_quality_score(word_count, attention_passed, ts, len(feedback), False)

    # Get engagement tracking data
    tab_switch_count = d.get("tab_switch_count", 0)
    page_close_attempts = d.get("page_close_attempts", 0)
    network_disconnects = d.get("network_disconnects", 0)

    try:
        db.execute(text("""
            INSERT INTO submissions (
                participant_id, image_id, survey_index, description, word_count,
                rating, feedback, time_spent_seconds, is_survey, is_attention_check,
                attention_passed, flagged_too_fast, quality_score,
                ip_hash, user_agent, extra_metadata,
                tab_switch_count, page_close_attempts, network_disconnects
            ) VALUES (
                :pid, :iid, :sidx, :desc, :wc, :rt, :fb, :ts, :isv, :isa,
                :ap, :tf, :qs, :iph, :ua, '{}',
                :tsc, :pca, :nd
            )
        """), {
            "pid": participant_id, "iid": image_id_fk, "sidx": survey_index,
            "desc": description, "wc": word_count, "rt": rating, "fb": feedback,
            "ts": ts, "isv": is_survey, "isa": is_attention, "ap": attention_passed,
            "tf": too_fast, "qs": quality, "iph": iph, "ua": ua,
            "tsc": tab_switch_count, "pca": page_close_attempts, "nd": network_disconnects
        })

        if is_attention:
            passed_inc = 1 if attention_passed else 0
            failed_inc = 1 - passed_inc
            db.execute(text("""
                INSERT INTO participant_attention_stats (
                    participant_id, total_checks, passed_checks, failed_checks,
                    attention_score, is_flagged
                ) VALUES (
                    :pid, 1, :p, :f, :sc, false
                ) ON CONFLICT (participant_id) DO UPDATE SET
                    total_checks    = participant_attention_stats.total_checks + 1,
                    passed_checks   = participant_attention_stats.passed_checks + :p,
                    failed_checks   = participant_attention_stats.failed_checks + :f,
                    attention_score = (participant_attention_stats.passed_checks + :p)::numeric /
                                      (participant_attention_stats.total_checks + 1),
                    is_flagged      = (
                        (participant_attention_stats.passed_checks + :p)::numeric /
                        (participant_attention_stats.total_checks + 1)
                    ) < :thresh AND
                    (participant_attention_stats.total_checks + 1) >= :minc
            """), {
                "pid": participant_id, "p": passed_inc, "f": failed_inc,
                "thresh": ATTENTION_FLAG_THRESHOLD, "minc": ATTENTION_FLAG_MIN_CHECKS
            })

        db.execute(text("""
            INSERT INTO participant_activity_stats (
                participant_id, total_words, total_submissions, survey_rounds
            ) VALUES (:pid, :w, 1, :sr)
            ON CONFLICT (participant_id) DO UPDATE SET
                total_words       = participant_activity_stats.total_words + :w,
                total_submissions = participant_activity_stats.total_submissions + 1,
                survey_rounds     = participant_activity_stats.survey_rounds + :sr,
                priority_eligible = (
                    (participant_activity_stats.total_words + :w) >= :wth OR
                    (participant_activity_stats.survey_rounds + :sr) >= :rth
                ) AND COALESCE(
                    (SELECT attention_score FROM participant_attention_stats WHERE participant_id = :pid),
                    1.0
                ) >= :ath
        """), {
            "pid": participant_id,
            "w": word_count,
            "sr": 1 if is_survey else 0,
            "wth": PRIORITY_WORD_THRESHOLD,
            "rth": PRIORITY_ROUNDS_THRESHOLD,
            "ath": PRIORITY_ATTENTION_THRESHOLD
        })

        log_audit(db, "submission", participant_id=participant_id,
                  details=f"wc={word_count} q={quality:.3f} survey={is_survey}")

        db.commit()

        return jsonify({
            "status": "submitted",
            "word_count": word_count,
            "quality_score": quality,
            "attention_passed": attention_passed,
            "flagged_too_fast": too_fast
        })

    except Exception as exc:
        db.rollback()
        if "unique" in str(exc).lower() and "survey_index" in str(exc):
            return jsonify({"error": "survey round already submitted"}), 409
        current_app.logger.exception("submit failed")
        return jsonify({"error": "database error"}), 500

# ────────────────────────────────────────────────
# Engagement Tracking Routes
# ────────────────────────────────────────────────

@app.route("/engagement/track", methods=["POST"])
@limiter.limit("60 per minute")
@track_performance
def track_engagement():
    """Track engagement events: tab switches, page close attempts, network disconnects."""
    data = request.json or {}
    public_id = data.get("public_id")
    event_type = data.get("event_type")
    
    if not public_id:
        return jsonify({"error": "public_id required"}), 400
    
    if not event_type:
        return jsonify({"error": "event_type required"}), 400
    
    # Validate event_type
    allowed_events = ["tab_switch", "page_close_attempt", "network_disconnect"]
    if event_type not in allowed_events:
        return jsonify({"error": f"invalid event_type. Allowed: {allowed_events}"}), 400
    
    db = get_db()
    
    # Get participant
    row = db.execute(text("""
        SELECT id FROM participants
        WHERE public_id = :pub AND is_deleted = false
    """), {"pub": public_id}).fetchone()
    
    if not row:
        return jsonify({"error": "participant not found"}), 404
    
    participant_id = row[0]
    
    # Store engagement data in extra_metadata JSON field
    try:
        # Get current metadata
        current_meta = db.execute(text("""
            SELECT extra_metadata FROM participants WHERE id = :pid
        """), {"pid": participant_id}).scalar() or {}
        
        if isinstance(current_meta, str):
            import json
            current_meta = json.loads(current_meta)
        
        # Initialize engagement tracking if not exists
        if "engagement_tracking" not in current_meta:
            current_meta["engagement_tracking"] = {
                "tab_switches": 0,
                "page_close_attempts": 0,
                "network_disconnects": 0,
                "total_events": 0,
                "events": []
            }
        
        # Update the specific counter
        if event_type == "tab_switch":
            current_meta["engagement_tracking"]["tab_switches"] += 1
        elif event_type == "page_close_attempt":
            current_meta["engagement_tracking"]["page_close_attempts"] += 1
        elif event_type == "network_disconnect":
            current_meta["engagement_tracking"]["network_disconnects"] += 1
        
        current_meta["engagement_tracking"]["total_events"] += 1
        current_meta["engagement_tracking"]["events"].append({
            "type": event_type,
            "timestamp": datetime.now(timezone.utc).isoformat()
        })
        
        # Keep only last 100 events to prevent unbounded growth
        if len(current_meta["engagement_tracking"]["events"]) > 100:
            current_meta["engagement_tracking"]["events"] = current_meta["engagement_tracking"]["events"][-100:]
        
        db.execute(text("""
            UPDATE participants
            SET extra_metadata = :meta, updated_at = CURRENT_TIMESTAMP
            WHERE id = :pid
        """), {
            "meta": current_meta,
            "pid": participant_id
        })
        
        db.commit()
        
        return jsonify({
            "status": "tracked",
            "event_type": event_type,
            "total_events": current_meta["engagement_tracking"]["total_events"]
        })
        
    except Exception as e:
        db.rollback()
        current_app.logger.exception("track_engagement failed")
        return jsonify({"error": "tracking failed"}), 500

# ────────────────────────────────────────────────
# Payment Routes
# ────────────────────────────────────────────────

@app.route("/payments/create", methods=["POST"])
@limiter.limit("20 per minute")
@track_performance
def create_payment():
    data = request.json or {}
    public_id = data.get("public_id")
    amount = data.get("amount")

    if not public_id or not amount:
        return jsonify({"error": "public_id and amount required"}), 400

    try:
        amount = round(float(amount), 2)
        if amount <= 0:
            raise ValueError
    except:
        return jsonify({"error": "invalid amount"}), 400

    db = get_db()

    row = db.execute(text("""
        SELECT id FROM participants
        WHERE public_id = :pub AND is_deleted = false
    """), {"pub": public_id}).fetchone()

    if not row:
        return jsonify({"error": "participant not found"}), 404

    participant_id = row[0]
    set_rls_context(db, participant_id)

    # Mark any existing pending/processing payments as failed to allow new payment creation
    db.execute(text("""
        UPDATE payments
        SET status = 'failed',
            updated_at = CURRENT_TIMESTAMP
        WHERE participant_id = :pid
          AND status IN ('pending', 'processing')
    """), {"pid": participant_id})

    # Timer starts immediately when payment is created (as requested)
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=PAYMENT_EXPIRY_SECONDS)
    expires_str = expires_at.isoformat()

    signature = generate_payment_signature(public_id, str(amount), expires_str)

    try:
        payment_row = db.execute(text("""
            INSERT INTO payments (
                participant_id, amount, signature, expires_at, timer_activated_at
            ) VALUES (
                :pid, :amt, :sig, :exp, :timer_time
            )
            RETURNING public_id
        """), {
            "pid": participant_id,
            "amt": amount,
            "sig": signature,
            "exp": expires_at,
            "timer_time": datetime.now(timezone.utc)  # Timer starts immediately
        }).fetchone()

        # Generate UPI note and store in database
        upi_note = f"COGNIT {payment_row[0]}"
        db.execute(text("""
            UPDATE payments
            SET upi_note = :note
            WHERE public_id = :pub
        """), {
            "note": upi_note,
            "pub": payment_row[0]
        })

        db.commit()

        # Generate UPI link and QR code
        upi_link = generate_upi_link(amount, upi_note)

        qr = qrcode.make(upi_link)
        buffer = BytesIO()
        qr.save(buffer, format="PNG")
        qr_base64 = base64.b64encode(buffer.getvalue()).decode()

        return jsonify({
            "payment_id": str(payment_row[0]),
            "amount": amount,
            "expires_at": expires_str,
            "signature": signature,
            "upi_link": upi_link,
            "upi_note": upi_note,
            "qr_base64": qr_base64,
            "timer_activated": True,
            "time_remaining_seconds": PAYMENT_EXPIRY_SECONDS
        })

    except Exception:
        db.rollback()
        return jsonify({"error": "payment creation failed"}), 500

@app.route("/payments/<payment_public_id>/upload-url", methods=["POST"])
@limiter.limit("20 per minute")
@track_performance
def generate_upload_url(payment_public_id):
    db = get_db()

    row = db.execute(text("""
        SELECT id, participant_id, status, expires_at
        FROM payments
        WHERE public_id = :pid
    """), {"pid": payment_public_id}).fetchone()

    if not row:
        return jsonify({"error": "payment not found"}), 404

    payment_id, participant_id, status, expires_at = row

    # Check if payment has expired
    if expires_at and datetime.now(timezone.utc) > expires_at:
        # Auto-update expired payment
        db.execute(text("""
            UPDATE payments
            SET status = 'expired', updated_at = CURRENT_TIMESTAMP
            WHERE id = :pid
        """), {"pid": payment_id})
        db.commit()
        return jsonify({"error": "payment expired"}), 410

    if status not in ("pending", "processing"):
        return jsonify({"error": "invalid payment state"}), 400

    set_rls_context(db, participant_id)

    object_key = f"payments/{payment_public_id}.jpg"

    presigned = s3.generate_presigned_url(
        "put_object",
        Params={
            "Bucket": S3_BUCKET,
            "Key": object_key,
            "ContentType": "image/jpeg"
        },
        ExpiresIn=300
    )

    return jsonify({
        "upload_url": presigned,
        "object_key": object_key
    })

@app.route("/payments/<payment_public_id>/finalize", methods=["POST"])
@limiter.limit("20 per minute")
@track_performance
def finalize_payment_upload(payment_public_id):
    data = request.json or {}
    object_key = data.get("object_key")
    sha256_hash = data.get("sha256")

    if not object_key or not sha256_hash:
        return jsonify({"error": "object_key and sha256 required"}), 400

    if not re.match(r"^[a-f0-9]{64}$", sha256_hash):
        return jsonify({"error": "invalid sha256"}), 400

    db = get_db()

    row = db.execute(text("""
        SELECT id, participant_id, status, expires_at
        FROM payments
        WHERE public_id = :pid
        FOR UPDATE
    """), {"pid": payment_public_id}).fetchone()

    if not row:
        return jsonify({"error": "payment not found"}), 404

    payment_id, participant_id, status, expires_at = row

    # Check if payment has expired
    if expires_at and datetime.now(timezone.utc) > expires_at:
        db.execute(text("""
            UPDATE payments
            SET status = 'expired', updated_at = CURRENT_TIMESTAMP
            WHERE id = :pid
        """), {"pid": payment_id})
        db.commit()
        return jsonify({"error": "payment expired"}), 410

    if status != "pending":
        return jsonify({"error": "invalid state"}), 400

    set_rls_context(db, participant_id)

    try:
        db.execute(text("""
            INSERT INTO payment_files (
                payment_id, object_key, sha256
            ) VALUES (
                :pid, :key, :hash
            )
        """), {
            "pid": payment_id,
            "key": object_key,
            "hash": sha256_hash
        })

        db.execute(text("""
            UPDATE payments
            SET status = 'processing'
            WHERE id = :pid
        """), {"pid": payment_id})

        db.commit()

        # Run verification immediately after finalize
        # Fetch payment details again after commit
        try:
            row = db.execute(text("""
                SELECT p.id, p.participant_id, p.amount, f.object_key, p.upi_note
                FROM payments p
                JOIN payment_files f ON f.payment_id = p.id
                WHERE p.public_id = :pid
                FOR UPDATE
            """), {"pid": payment_public_id}).fetchone()

            if row:
                payment_id, participant_id, amount, object_key, payment_note = row

                image = fetch_s3_image(object_key)
                extracted_text, confidence = extract_text_with_confidence(image)

                # Run strict validation
                is_valid, detected_app, failures = verify_payment_screenshot(
                    image, extracted_text, amount, payment_note, confidence
                )

                # Build verification details JSON
                verification_details = {
                    "ocr_confidence": confidence,
                    "failure_reasons": failures,
                    "extracted_text_length": len(extracted_text) if extracted_text else 0
                }

                # Extract transaction ID
                txn_match = re.search(r"\b[a-zA-Z0-9]{12,30}\b", extracted_text)
                upi_ref = txn_match.group(0) if txn_match else None

                new_status = "success" if is_valid else "rejected_fraud"

                db.execute(text("""
                    UPDATE payments
                    SET extracted_text = :txt,
                        upi_txn_ref = :ref,
                        fraud_score = :fs,
                        verified_at = CURRENT_TIMESTAMP,
                        status = :status,
                        detected_app = :app,
                        verification_details = :details
                    WHERE id = :pid
                """), {
                    "txt": extracted_text,
                    "ref": upi_ref,
                    "fs": len(failures) * 10,
                    "status": new_status,
                    "app": detected_app,
                    "details": verification_details,
                    "pid": payment_id
                })

                # Insert fraud signals for each failure reason
                for failure in failures:
                    db.execute(text("""
                        INSERT INTO payment_fraud_signals (
                            payment_id, signal_type, signal_score, details
                        ) VALUES (
                            :pid, :type, :score, :details
                        ) ON CONFLICT DO NOTHING
                    """), {
                        "pid": payment_id,
                        "type": failure,
                        "score": 100,
                        "details": {"reason": failure, "confidence": confidence}
                    })

                db.commit()
        except Exception as e:
            current_app.logger.exception("Verification failed after upload")
            # Don't fail the upload if verification fails - status remains processing

        return jsonify({"status": "uploaded"})

    except Exception:
        db.rollback()
        return jsonify({"error": "duplicate or invalid upload"}), 400

@app.route("/payments/<payment_public_id>/status", methods=["GET"])
@limiter.limit("30 per minute")
@track_performance
def get_payment_status(payment_public_id):
    """Get current payment status including expiry check."""
    db = get_db()

    row = db.execute(text("""
        SELECT p.id, p.participant_id, p.status, p.expires_at, p.amount, p.verified_at, p.verification_details, p.detected_app
        FROM payments p
        WHERE p.public_id = :pid
    """), {"pid": payment_public_id}).fetchone()

    if not row:
        return jsonify({"error": "payment not found"}), 404

    payment_id, participant_id, status, expires_at, amount, verified_at, verification_details, detected_app = row
    set_rls_context(db, participant_id)

    # Check if payment should be marked as expired
    now = datetime.now(timezone.utc)
    is_expired = expires_at and now > expires_at

    if is_expired and status in ("pending", "processing"):
        # Auto-update expired payment
        db.execute(text("""
            UPDATE payments
            SET status = 'expired', updated_at = CURRENT_TIMESTAMP
            WHERE id = :pid
        """), {"pid": payment_id})
        db.commit()
        status = "expired"

    response = {
        "payment_id": payment_public_id,
        "status": status,
        "amount": float(amount) if amount else None,
        "expires_at": expires_at.isoformat() if expires_at else None,
        "is_expired": status == "expired",
        "time_remaining_seconds": max(0, int((expires_at - now).total_seconds())) if expires_at and status in ("pending", "processing") else 0,
        "verified_at": verified_at.isoformat() if verified_at else None
    }

    # Add verification details if present
    if verification_details:
        response["verification_details"] = verification_details
    if detected_app:
        response["detected_app"] = detected_app

    return jsonify(response)

@app.route("/internal/payments/<payment_public_id>/verify", methods=["POST"])
@limiter.exempt
def verify_payment(payment_public_id):
    db = get_db()

    row = db.execute(text("""
        SELECT p.id, p.participant_id, p.amount, f.object_key, p.upi_note
        FROM payments p
        JOIN payment_files f ON f.payment_id = p.id
        WHERE p.public_id = :pid
        FOR UPDATE
    """), {"pid": payment_public_id}).fetchone()

    if not row:
        return jsonify({"error": "not found"}), 404

    payment_id, participant_id, amount, object_key, payment_note = row

    image = fetch_s3_image(object_key)
    extracted_text, confidence = extract_text_with_confidence(image)

    # Run strict validation
    is_valid, detected_app, failures = verify_payment_screenshot(
        image, extracted_text, amount, payment_note, confidence
    )

    # Build verification details JSON
    verification_details = {
        "ocr_confidence": confidence,
        "failure_reasons": failures,
        "extracted_text_length": len(extracted_text) if extracted_text else 0
    }

    # Extract transaction ID
    txn_match = re.search(r"\b[a-zA-Z0-9]{12,30}\b", extracted_text)
    upi_ref = txn_match.group(0) if txn_match else None

    if is_valid:
        new_status = "success"
    else:
        new_status = "rejected_fraud"

    db.execute(text("""
        UPDATE payments
        SET extracted_text = :txt,
            upi_txn_ref = :ref,
            fraud_score = :fs,
            verified_at = CURRENT_TIMESTAMP,
            status = :status,
            detected_app = :app,
            verification_details = :details
        WHERE id = :pid
    """), {
        "txt": extracted_text,
        "ref": upi_ref,
        "fs": len(failures) * 10,  # Convert failure count to score (0-90)
        "status": new_status,
        "app": detected_app,
        "details": verification_details,
        "pid": payment_id
    })

    # Insert fraud signals for each failure reason
    for failure in failures:
        db.execute(text("""
            INSERT INTO payment_fraud_signals (
                payment_id, signal_type, signal_score, details
            ) VALUES (
                :pid, :type, :score, :details
            ) ON CONFLICT DO NOTHING
        """), {
            "pid": payment_id,
            "type": failure,
            "score": 100,
            "details": {"reason": failure, "confidence": confidence}
        })

    db.commit()

    if is_valid:
        return jsonify({
            "status": "success",
            "detected_app": detected_app
        })
    else:
        return jsonify({
            "status": "rejected_fraud",
            "detected_app": detected_app,
            "failure_reasons": failures
        })

@app.route("/")
@limiter.limit("30 per minute")
@track_performance
def root():
    base_url = "https://api.cognit.online"
    return render_template("api_docs.html", base_url=base_url)

@app.route("/docs")
@limiter.limit("30 per minute")
@track_performance
def api_docs():
    base_url = "https://api.cognit.online"

    docs = {
        "title": "C.O.G.N.I.T. API",
        "description": "Cognitive Image & Text Research Platform backend API. Collects high-quality image descriptions with attention checks and anti-abuse measures.",
        "version": "1.0.0",
        "base_url": base_url,
        "authentication": "None (public_id based participant isolation via RLS)",
        "endpoints": [
            {
                "path": "/health",
                "method": "GET",
                "description": "Server and database health check",
                "auth": "None",
                "rate_limit": "exempt"
            },
            {
                "path": "/participants",
                "method": "POST",
                "description": "Register new participant (public_id must be UUID)",
                "body_example": {
                    "public_id": "550e8400-e29b-41d4-a716-446655440000",
                    "session_id": "sess_abc123xyz",
                    "username": "user123",
                    "gender_code": "male",
                    "age": 25,
                    "location": "ahmedabad",
                    "language_code": "en",
                    "prior_experience": "some experience",
                    "email": "optional@example.com",
                    "phone": "optional"
                },
                "rate_limit": "30/min"
            },
            {
                "path": "/participants/{public_id}",
                "method": "GET",
                "description": "Get participant profile (public fields only)",
                "rate_limit": "10/min"
            },
            {
                "path": "/check-username",
                "method": "GET",
                "description": "Check if username is available for registration",
                "query_params": {"username": "string (required)"},
                "rate_limit": "30/min"
            },
            {
                "path": "/check-email",
                "method": "GET",
                "description": "Check if email is already registered",
                "query_params": {"email": "string (required)"},
                "rate_limit": "30/min"
            },
            {
                "path": "/check-phone",
                "method": "GET",
                "description": "Check if phone number is already registered",
                "query_params": {"phone": "string (required)"},
                "rate_limit": "30/min"
            },
            {
                "path": "/consent",
                "method": "POST",
                "description": "Record consent (required before submissions)",
                "body_example": {"public_id": "550e8400-e29b-41d4-a716-446655440000"},
                "rate_limit": "20/min"
            },
            {
                "path": "/images/random",
                "method": "GET",
                "description": "Get random image (exclude=comma,separated,image_ids)",
                "query_params": {"exclude": "img1,img2 (optional)"},
                "rate_limit": "default"
            },
            {
                "path": "/submit",
                "method": "POST",
                "description": "Submit image description / survey response",
                "body_example": {
                    "public_id": "550e8400-...",
                    "image_id": "image-unique-string-123",
                    "description": "Detailed description here at least 60 words...",
                    "rating": 7,
                    "feedback": "My comments here...",
                    "time_spent_seconds": 45.2,
                    "is_survey": False,
                    "survey_index": None
                },
                "rate_limit": "60/min"
            },
            {
                "path": "/docs",
                "method": "GET",
                "description": "This documentation",
                "rate_limit": "30/min"
            },
            {
                "path": "/payments/create",
                "method": "POST",
                "description": "Create a new payment session with expiry timer",
                "body_example": {
                    "public_id": "550e8400-...",
                    "amount": 1.00
                },
                "response": {
                    "payment_id": "uuid",
                    "amount": 1.00,
                    "expires_at": "2024-01-01T12:15:00+00:00",
                    "upi_link": "upi://pay?...",
                    "qr_base64": "base64encoded..."
                },
                "rate_limit": "20/min"
            },
            {
                "path": "/payments/{payment_id}/status",
                "method": "GET",
                "description": "Get payment status and time remaining",
                "response": {
                    "payment_id": "uuid",
                    "status": "pending|processing|expired|success|failed",
                    "is_expired": false,
                    "time_remaining_seconds": 600,
                    "expires_at": "2024-01-01T12:15:00+00:00"
                },
                "rate_limit": "30/min"
            },
            {
                "path": "/payments/{payment_id}/upload-url",
                "method": "POST",
                "description": "Get S3 presigned URL for payment screenshot upload",
                "rate_limit": "20/min"
            },
            {
                "path": "/payments/{payment_id}/finalize",
                "method": "POST",
                "description": "Finalize payment after screenshot upload",
                "body_example": {
                    "object_key": "payments/uuid.jpg",
                    "sha256": "sha256hash"
                },
                "rate_limit": "20/min"
            }
        ],
    }
    return jsonify(docs)
