import hashlib
import os
import re
import time
import functools
import random
from datetime import datetime, timezone
from flask import Flask, jsonify, request, g, current_app, render_template
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, scoped_session
from sqlalchemy.pool import NullPool
import ipaddress
from collections import Counter

# ────────────────────────────────────────────────
# Constants & Environment
# ────────────────────────────────────────────────

MIN_WORD_COUNT = int(os.getenv("MIN_WORD_COUNT", "60"))
TOO_FAST_SECONDS = float(os.getenv("TOO_FAST_SECONDS", "5.0"))
MAX_DESCRIPTION_LENGTH = int(os.getenv("MAX_DESCRIPTION_LENGTH", "10000"))
MIN_DESCRIPTION_LENGTH = 60
MAX_FEEDBACK_LENGTH = int(os.getenv("MAX_FEEDBACK_LENGTH", "2000"))
MIN_FEEDBACK_LENGTH = 5
MIN_RATING = 1
MAX_RATING = 10
MIN_AGE = 13
MAX_AGE = 120

ATTENTION_FLAG_THRESHOLD = 0.60
ATTENTION_FLAG_MIN_CHECKS = 3
PRIORITY_WORD_THRESHOLD = 500
PRIORITY_ROUNDS_THRESHOLD = 3
PRIORITY_ATTENTION_THRESHOLD = 0.75

PERFORMANCE_LOG_SAMPLE_RATE = float(os.getenv("PERFORMANCE_LOG_SAMPLE_RATE", "0.10"))

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

# ────────────────────────────────────────────────
# CORS
# ────────────────────────────────────────────────

def get_cors_origins():
    env = os.getenv("CORS_ORIGINS", "").strip()
    if not env:
        return ["*"]  # fallback – tighten in production!
    return [o.strip() for o in env.split(",") if o.strip()]

CORS(app, resources={r"/*": {"origins": get_cors_origins()}})

# ────────────────────────────────────────────────
# Rate Limiter
# ────────────────────────────────────────────────

limiter = Limiter(
    app=app,
    key_func=get_remote_address,
    default_limits=["200 per day", "50 per hour"],
    storage_uri=os.getenv("RATELIMIT_STORAGE_URI", "memory://")
)

# ────────────────────────────────────────────────
# Database
# ────────────────────────────────────────────────

engine = create_engine(
    DATABASE_URL,
    poolclass=NullPool,
    pool_pre_ping=True,
    connect_args={"sslmode": "require"} if "sslmode" not in DATABASE_URL else {}
)

SessionFactory = sessionmaker(bind=engine)
SessionLocal = scoped_session(SessionFactory)

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
    forwarded = request.headers.get("X-Forwarded-For", request.remote_addr or "unknown")
    ip = forwarded.split(",")[0].strip()
    if ip in ("", "unknown"):
        return "0" * 64
    try:
        return hashlib.sha256(f"{ipaddress.ip_address(ip)}{IP_HASH_SALT}".encode()).hexdigest()
    except:
        return "0" * 64

def count_words(text: str) -> int:
    if not text.strip():
        return 0
    words = re.findall(r"\b\w+\b", text.strip(), re.UNICODE)
    return len([w for w in words if re.search(r"[^\W\d_]", w, re.UNICODE)])

def detect_bot_like_content(text: str, wc: int) -> tuple[bool, str]:
    if wc == 0:
        return True, "empty"
    lower = text.lower()
    words = [w for w in re.findall(r"\b\w+\b", lower, re.UNICODE) if re.search(r"[^\W\d_]", w)]
    if len(words) > 10:
        top = Counter(words).most_common(1)
        if top and top[0][1] / len(words) > 0.30:
            return True, "repetition"
    if len(words) > 20 and len(set(words)) / len(words) < 0.30:
        return True, "low diversity"
    if re.search(r"(.)\1{5,}", lower):
        return True, "char spam"
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
        "ev": event_type, "pid": participant_id, "ep": request.path,
        "meth": request.method, "iph": get_ip_hash(),
        "ua": request.headers.get("User-Agent", ""), "det": details
    })

# ────────────────────────────────────────────────
# Performance tracking (sampled)
# ────────────────────────────────────────────────

def track_performance(f):
    @functools.wraps(f)
    def wrapper(*args, **kwargs):
        start = time.perf_counter()
        try:
            response = f(*args, **kwargs)
            duration_ms = int((time.perf_counter() - start) * 1000)
            status = 200
            size = 0
            if isinstance(response, tuple) and len(response) > 1:
                status = response[1] if isinstance(response[1], int) else 200
            if hasattr(response, 'data'):
                size = len(response.data) if response.data else 0
            elif isinstance(response, dict):
                size = len(str(response).encode('utf-8'))
            if random.random() < PERFORMANCE_LOG_SAMPLE_RATE:
                db = get_db()
                db.execute(text("""
                    INSERT INTO performance_metrics (
                        endpoint, response_time_ms, status_code,
                        request_size_bytes, response_size_bytes
                    ) VALUES (:ep, :ms, :st, :req, :res)
                """), {
                    "ep": request.path, "ms": duration_ms, "st": status,
                    "req": request.content_length or 0, "res": size
                })
            return response
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
        return jsonify({"error": "missing fields", "fields": missing}), 400

    public_id = str(data["public_id"]).strip()
    if not re.match(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', public_id, re.I):
        return jsonify({"error": "invalid UUID format for public_id"}), 400

    age = int(data["age"])
    if not MIN_AGE <= age <= MAX_AGE:
        return jsonify({"error": f"age must be {MIN_AGE}–{MAX_AGE}"}), 400

    db = get_db()
    try:
        db.execute(text("""
            INSERT INTO participants (
                public_id, session_id, username, email, phone,
                gender_code, age, location, language_code, prior_experience,
                ip_hash, user_agent
            ) VALUES (
                :pub, :sid, :un, :em, :ph, :gc, :age, :loc, :lc, :pe, :iph, :ua
            )
        """), {
            "pub": public_id,
            "sid": str(data["session_id"]).strip(),
            "un": str(data["username"]).strip(),
            "em": data.get("email", "").strip() or None,
            "ph": data.get("phone", "").strip() or None,
            "gc": str(data["gender_code"]).strip().lower(),
            "age": age,
            "loc": str(data["location"]).strip(),
            "lc": str(data["language_code"]).strip().lower(),
            "pe": str(data.get("prior_experience", "")).strip(),
            "iph": get_ip_hash(),
            "ua": request.headers.get("User-Agent", "")
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
        SELECT id, username, email, phone, gender_code, age, location, language_code,
              prior_experience, consent_given, consent_at, payment_status
        FROM participants
        WHERE public_id = :pub AND is_deleted = false
    """), {"pub": public_id}).fetchone()
    if not row:
        return jsonify({"error": "not found"}), 404

    return jsonify({
        "public_id": public_id,
        "username": row[1],
        "email": row[2],
        "phone": row[3],
        "gender_code": row[4],
        "age": row[5],
        "location": row[6],
        "language_code": row[7],
        "prior_experience": row[8],
        "consent_given": bool(row[9]),
        "consent_at": row[10].isoformat() if row[10] else None,
        "payment_status": row[11]
    })

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
            return jsonify({"error": "not found"}), 404
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

    desc = (d.get("description") or "").strip()
    if len(desc) < MIN_DESCRIPTION_LENGTH or len(desc) > MAX_DESCRIPTION_LENGTH:
        return jsonify({"error": f"description length must be {MIN_DESCRIPTION_LENGTH}–{MAX_DESCRIPTION_LENGTH}"}), 400

    wc = count_words(desc)
    if wc < MIN_WORD_COUNT:
        return jsonify({"error": f"need ≥ {MIN_WORD_COUNT} words", "count": wc}), 400

    bot_sus, bot_reason = detect_bot_like_content(desc, wc)

    try:
        rating = int(d["rating"])
        if not MIN_RATING <= rating <= MAX_RATING:
            raise ValueError
    except:
        return jsonify({"error": f"rating {MIN_RATING}–{MAX_RATING}"}), 400

    fb = (d.get("feedback") or "").strip()
    if len(fb) < MIN_FEEDBACK_LENGTH or len(fb) > MAX_FEEDBACK_LENGTH:
        return jsonify({"error": f"feedback {MIN_FEEDBACK_LENGTH}–{MAX_FEEDBACK_LENGTH} chars"}), 400

    ts = d.get("time_spent_seconds")
    if ts is not None:
        try:
            ts = float(ts)
            if ts < 0: ts = None
        except:
            ts = None

    is_survey = bool(d.get("is_survey"))
    survey_idx = None
    if is_survey:
        try:
            survey_idx = int(d["survey_index"])
            if survey_idx < 0: raise ValueError
        except:
            return jsonify({"error": "invalid survey_index"}), 400

    db = get_db()

    p_row = db.execute(text("""
        SELECT p.id, p.consent_given, p.is_deleted, s.is_flagged
        FROM participants p
        LEFT JOIN participant_attention_stats s ON s.participant_id = p.id
        WHERE p.public_id = :pub
    """), {"pub": public_id}).fetchone()

    if not p_row or p_row[2]:
        return jsonify({"error": "participant not found / deleted"}), 404
    if p_row[3]:
        return jsonify({"error": "flagged – low attention"}), 403
    if not p_row[1]:
        return jsonify({"error": "consent required"}), 403

    participant_id = p_row[0]

    img_row = db.execute(text("SELECT id FROM images WHERE image_id = :iid"), {"iid": image_id_str}).fetchone()
    if not img_row:
        return jsonify({"error": "invalid image_id"}), 400
    image_fk = img_row[0]

    ac = db.execute(text("""
        SELECT expected_word, is_strict
        FROM attention_checks
        WHERE image_id = :iid AND is_active = true
    """), {"iid": image_fk}).fetchone()

    is_ac = ac is not None
    att_passed = None
    if is_ac:
        exp = ac[0].strip().lower()
        strict = ac[1]
        dlow = desc.lower()
        att_passed = bool(re.search(rf"\b{re.escape(exp)}\b", dlow)) if strict else (exp in dlow)

    too_fast = ts is not None and ts < TOO_FAST_SECONDS
    quality = calculate_quality_score(wc, att_passed, ts, len(fb), bot_sus)

    try:
        db.execute(text("""
            INSERT INTO submissions (
                participant_id, image_id, survey_index, description, word_count,
                rating, feedback, time_spent_seconds, is_survey, is_attention_check,
                attention_passed, flagged_too_fast, quality_score, ai_suspected,
                ip_hash, user_agent
            ) VALUES (
                :pid, :iid, :sidx, :desc, :wc, :rt, :fb, :ts, :isv, :isa,
                :ap, :tf, :qs, :ais, :iph, :ua
            )
        """), {
            "pid": participant_id, "iid": image_fk, "sidx": survey_idx,
            "desc": desc, "wc": wc, "rt": rating, "fb": fb, "ts": ts,
            "isv": is_survey, "isa": is_ac, "ap": att_passed, "tf": too_fast,
            "qs": quality, "ais": bot_sus, "iph": get_ip_hash(),
            "ua": request.headers.get("User-Agent", "")
        })

        if is_ac:
            p_count = 1 if att_passed else 0
            f_count = 0 if att_passed else 1
            db.execute(text("""
                INSERT INTO participant_attention_stats (
                    participant_id, total_checks, passed_checks, failed_checks,
                    attention_score, is_flagged, last_checked_at
                ) VALUES (
                    :pid, 1, :p, :f, :sc, :fl, CURRENT_TIMESTAMP
                ) ON CONFLICT (participant_id) DO UPDATE SET
                    total_checks    = participant_attention_stats.total_checks + 1,
                    passed_checks   = participant_attention_stats.passed_checks + :p,
                    failed_checks   = participant_attention_stats.failed_checks + :f,
                    attention_score = (participant_attention_stats.passed_checks + :p)::numeric /
                                      (participant_attention_stats.total_checks + 1),
                    is_flagged      = (
                        (participant_attention_stats.passed_checks + :p)::numeric /
                        (participant_attention_stats.total_checks + 1)
                    ) < :thresh
                    AND (participant_attention_stats.total_checks + 1) >= :minc,
                    last_checked_at = CURRENT_TIMESTAMP
            """), {
                "pid": participant_id,
                "p": p_count,
                "f": f_count,
                "sc": 1.0 if att_passed else 0.0,
                "fl": False,
                "thresh": ATTENTION_FLAG_THRESHOLD,
                "minc": ATTENTION_FLAG_MIN_CHECKS
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
            "pid": participant_id, "w": wc, "sr": 1 if is_survey else 0,
            "wth": PRIORITY_WORD_THRESHOLD, "rth": PRIORITY_ROUNDS_THRESHOLD,
            "ath": PRIORITY_ATTENTION_THRESHOLD
        })

        log_audit(db, "submission", participant_id=participant_id,
                  details=f"wc={wc} q={quality:.3f} survey={is_survey}")

        db.commit()

        return jsonify({
            "status": "submitted",
            "word_count": wc,
            "quality_score": quality,
            "attention_passed": att_passed,
            "flagged_too_fast": too_fast,
            "ai_suspected": bot_sus
        })

    except Exception as exc:
        db.rollback()
        if "unique" in str(exc) and "survey_index" in str(exc):
            return jsonify({"error": "survey round already submitted"}), 409
        current_app.logger.exception("submit failed")
        return jsonify({"error": "database error"}), 500

# ────────────────────────────────────────────────
# Payment & Reward Endpoints
# ────────────────────────────────────────────────

@app.route("/participant/<public_id>/payment_status", methods=["GET"])
@limiter.limit("10 per minute")
@track_performance
def get_payment_status(public_id):
    db = get_db()
    row = db.execute(text("""
        SELECT payment_status
        FROM participants
        WHERE public_id = :pub AND is_deleted = false
    """), {"pub": public_id}).fetchone()

    if not row:
        return jsonify({"error": "participant not found"}), 404

    return jsonify({"payment_status": row[0]})


@app.route("/rewards/eligibility", methods=["GET"])
@limiter.limit("5 per minute")
@track_performance
def check_reward_eligibility():
    public_id = request.args.get("public_id")
    if not public_id:
        return jsonify({"error": "public_id required (query param)"}), 400

    db = get_db()
    row = db.execute(text("""
        SELECT 
            p.id,
            p.payment_status,
            COALESCE(a.priority_eligible, false) AS priority_eligible,
            COALESCE(a.total_words, 0) AS total_words,
            COALESCE(a.survey_rounds, 0) AS survey_rounds,
            COALESCE(s.attention_score, 1.0) AS attention_score
        FROM participants p
        LEFT JOIN participant_activity_stats a ON a.participant_id = p.id
        LEFT JOIN participant_attention_stats s ON s.participant_id = p.id
        WHERE p.public_id = :pub AND p.is_deleted = false
    """), {"pub": public_id}).fetchone()

    if not row:
        return jsonify({"error": "participant not found"}), 404

    pid, pay_status, prio, words, rounds, att_score = row

    eligible = (
        prio and
        pay_status == 'pending' and
        words >= PRIORITY_WORD_THRESHOLD and
        rounds >= PRIORITY_ROUNDS_THRESHOLD and
        att_score >= PRIORITY_ATTENTION_THRESHOLD
    )

    return jsonify({
        "eligible": eligible,
        "priority_eligible": prio,
        "total_words": int(words),
        "survey_rounds": int(rounds),
        "attention_score": float(att_score),
        "payment_status": pay_status
    })


@app.route("/rewards/claim", methods=["POST"])
@limiter.limit("3 per minute")
@track_performance
def claim_reward():
    data = request.json or {}
    public_id = data.get("public_id")
    if not public_id:
        return jsonify({"error": "public_id required"}), 400

    db = get_db()
    row = db.execute(text("""
        SELECT 
            p.id,
            p.payment_status,
            COALESCE(a.priority_eligible, false) AS priority_eligible,
            COALESCE(a.total_words, 0) AS total_words,
            COALESCE(a.survey_rounds, 0) AS survey_rounds,
            COALESCE(s.attention_score, 1.0) AS attention_score
        FROM participants p
        LEFT JOIN participant_activity_stats a ON a.participant_id = p.id
        LEFT JOIN participant_attention_stats s ON s.participant_id = p.id
        WHERE p.public_id = :pub AND p.is_deleted = false
    """), {"pub": public_id}).fetchone()

    if not row:
        return jsonify({"error": "participant not found"}), 404

    pid, pay_status, prio, words, rounds, att_score = row

    if not (prio and pay_status == 'pending' and words >= PRIORITY_WORD_THRESHOLD and rounds >= PRIORITY_ROUNDS_THRESHOLD and att_score >= PRIORITY_ATTENTION_THRESHOLD):
        return jsonify({"error": "not eligible for reward"}), 403

    # Placeholder: in real implementation → call payment gateway (Razorpay/Stripe), then insert
    try:
        db.execute(text("""
            INSERT INTO reward_winners (
                participant_id, reward_amount, reason_code, status
            ) VALUES (
                :pid, 500, 'priority_eligible', 'pending'
            )
        """), {"pid": pid})

        # Optional: update participant payment_status if you want to mark as 'reward_pending' or similar
        # db.execute(text("UPDATE participants SET payment_status = 'reward_pending' WHERE id = :pid"), {"pid": pid})

        db.commit()
        log_audit(db, "reward_claim_requested", participant_id=pid)
        return jsonify({"status": "reward claim queued", "amount": 500}), 202

    except Exception as e:
        db.rollback()
        if "unique" in str(e).lower():
            return jsonify({"error": "reward already claimed"}), 409
        current_app.logger.exception("reward claim failed")
        return jsonify({"error": "server error"}), 500

@app.route("/")
@limiter.limit("30 per minute")
@track_performance
def serve_api_docs():
    base_url = os.getenv("WEBSITE_URL", "").strip() or request.host_url.rstrip("/")
    return render_template("api_docs.html", base_url=base_url)

@app.route("/docs")
@limiter.limit("30 per minute")
@track_performance
def api_docs():
    base_url = os.getenv("WEBSITE_URL", "").strip() or request.host_url.rstrip("/")
    docs = {
        "title": "C.O.G.N.I.T. API",
        "description": "Cognitive Image & Text Research Platform backend API. Collects high-quality image descriptions with attention checks and anti-abuse measures.",
        "version": "1.0.0",
        "base_url": base_url,
        "authentication": "None (public_id based participant isolation via RLS)",
        "endpoints": [
            {"path": "/health", "method": "GET", "description": "Server and database health check", "rate_limit": "exempt"},
            {"path": "/participants", "method": "POST", "description": "Register new participant", "rate_limit": "30/min"},
            {"path": "/participants/{public_id}", "method": "GET", "description": "Get participant profile", "rate_limit": "10/min"},
            {"path": "/consent", "method": "POST", "description": "Record consent", "rate_limit": "20/min"},
            {"path": "/images/random", "method": "GET", "description": "Get random image", "rate_limit": "default"},
            {"path": "/submit", "method": "POST", "description": "Submit description/survey", "rate_limit": "60/min"},
            {"path": "/", "method": "GET", "description": "API documentation (HTML)", "rate_limit": "30/min"},
            {"path": "/docs", "method": "GET", "description": "API documentation (JSON)", "rate_limit": "30/min"},
            {"path": "/participant/{public_id}/payment_status", "method": "GET", "description": "Get payment status", "rate_limit": "10/min"},
            {"path": "/rewards/eligibility", "method": "GET", "description": "Check if eligible for reward", "rate_limit": "5/min"},
            {"path": "/rewards/claim", "method": "POST", "description": "Claim reward (placeholder)", "rate_limit": "3/min"},
        ],
    }
    return jsonify(docs)
