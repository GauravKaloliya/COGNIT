"""
Submission routes module for C.O.G.N.I.T. backend.
Handles survey submissions and engagement tracking.
"""

import json
import re
from datetime import datetime, timezone

from flask import jsonify, request, current_app
from sqlalchemy import text

from app.config import (
    MIN_DESCRIPTION_LENGTH,
    MAX_DESCRIPTION_LENGTH,
    MIN_FEEDBACK_LENGTH,
    MAX_FEEDBACK_LENGTH,
    MIN_RATING,
    MAX_RATING,
    MIN_WORD_COUNT,
    TOO_FAST_SECONDS,
    ATTENTION_FLAG_THRESHOLD,
    ATTENTION_FLAG_MIN_CHECKS,
    PRIORITY_WORD_THRESHOLD,
    PRIORITY_ROUNDS_THRESHOLD,
    PRIORITY_ATTENTION_THRESHOLD,
)
from app.extensions import limiter
from app.database import get_db
from app.utils.helpers import (
    get_ip_hash,
    count_words,
    calculate_quality_score,
    log_audit,
    create_error_response,
)
from app.utils.decorators import track_performance


# ────────────────────────────────────────────────
# Blueprint Setup
# ────────────────────────────────────────────────

from flask import Blueprint
submission_bp = Blueprint('submission', __name__)


# Import middleware if available
try:
    from middleware import require_payment_completed
except ImportError:
    def require_payment_completed(f):
        return f


# ────────────────────────────────────────────────
# Routes
# ────────────────────────────────────────────────

@submission_bp.route("/submit", methods=["POST"])
@require_payment_completed
@limiter.limit("60 per minute")
@track_performance
def submit():
    """Submit an image description or survey response."""
    d = request.json or {}
    public_id = d.get("public_id")
    if not public_id:
        return create_error_response("MISSING_FIELDS", {"fields": ["public_id"]})

    image_id_str = d.get("image_id")
    if not image_id_str:
        return create_error_response("MISSING_FIELDS", {"fields": ["image_id"]})

    description = (d.get("description") or "").strip()
    if len(description) < MIN_DESCRIPTION_LENGTH or len(description) > MAX_DESCRIPTION_LENGTH:
        return create_error_response("DESCRIPTION_LENGTH")

    feedback = (d.get("feedback") or "").strip()
    if len(feedback) < MIN_FEEDBACK_LENGTH or len(feedback) > MAX_FEEDBACK_LENGTH:
        return create_error_response("FEEDBACK_LENGTH")

    try:
        rating = int(d["rating"])
        if not MIN_RATING <= rating <= MAX_RATING:
            raise ValueError
    except:
        return create_error_response("RATING_INVALID")

    word_count = count_words(description)
    if word_count < MIN_WORD_COUNT:
        return create_error_response("WORD_COUNT", {"actual": word_count})

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
            return create_error_response("INVALID_FORMAT", {"field": "survey_index", "message": "survey_index must be >= 0"})

    iph = get_ip_hash()
    ua = request.headers.get("User-Agent", "")[:512]

    try:
        db = get_db()
        p_row = db.execute(text("""
            SELECT id, consent_given, is_deleted
            FROM participants
            WHERE public_id = :pub
        """), {"pub": public_id}).fetchone()

        if not p_row or p_row[2]:
            return create_error_response("PARTICIPANT_NOT_FOUND")
        if not p_row[1]:
            return create_error_response("CONSENT_REQUIRED")

        participant_id = p_row[0]

        flagged = db.execute(text("""
            SELECT is_flagged FROM participant_attention_stats
            WHERE participant_id = :pid
        """), {"pid": participant_id}).scalar()
        if flagged:
            return create_error_response("FLAGGED_ACCOUNT")

        img_row = db.execute(text("SELECT id FROM images WHERE image_id = :iid"), {"iid": image_id_str}).fetchone()
        if not img_row:
            return create_error_response("INVALID_IMAGE_ID")
        image_id_fk = img_row[0]

        if not is_survey:
            dup = db.execute(text("""
                SELECT 1 FROM submissions
                WHERE participant_id = :pid AND image_id = :iid AND is_survey = false
            """), {"pid": participant_id, "iid": image_id_fk}).scalar()
            if dup:
                return create_error_response("DUPLICATE_SUBMISSION")

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
        quality = calculate_quality_score(word_count, attention_passed, ts, len(feedback), False)

        # Get engagement tracking data
        tab_switch_count = d.get("tab_switch_count", 0)
        page_close_attempts = d.get("page_close_attempts", 0)
        network_disconnects = d.get("network_disconnects", 0)

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
        try:
            db.rollback()
        except:
            pass
        if "unique" in str(exc).lower() and "survey_index" in str(exc):
            return create_error_response("SURVEY_EXISTS")
        print(f"[ERROR] submit failed: {exc}", flush=True)
        return create_error_response("DATABASE_ERROR")


# ────────────────────────────────────────────────
# Engagement Tracking
# ────────────────────────────────────────────────

@submission_bp.route("/engagement/track", methods=["POST"])
@limiter.limit("60 per minute")
@track_performance
def track_engagement():
    """Track engagement events: tab switches, page close attempts, network disconnects."""
    data = request.json or {}
    public_id = data.get("public_id")
    event_type = data.get("event_type")
    
    if not public_id:
        return create_error_response("MISSING_FIELDS", {"fields": ["public_id"]})
    
    if not event_type:
        return create_error_response("MISSING_FIELDS", {"fields": ["event_type"]})
    
    # Validate event_type
    allowed_events = ["tab_switch", "page_close_attempt", "network_disconnect"]
    if event_type not in allowed_events:
        return create_error_response("INVALID_FORMAT", {"field": "event_type", "allowed": allowed_events})
    
    try:
        db = get_db()
        
        # Get participant
        row = db.execute(text("""
            SELECT id FROM participants
            WHERE public_id = :pub AND is_deleted = false
        """), {"pub": public_id}).fetchone()
        
        if not row:
            return create_error_response("PARTICIPANT_NOT_FOUND")
        
        participant_id = row[0]

        # Get current metadata
        current_meta = db.execute(text("""
            SELECT extra_metadata FROM participants WHERE id = :pid
        """), {"pid": participant_id}).scalar() or {}
        
        if isinstance(current_meta, str):
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
            "meta": json.dumps(current_meta),
            "pid": participant_id
        })
        
        db.commit()
        
        return jsonify({
            "status": "tracked",
            "event_type": event_type,
            "total_events": current_meta["engagement_tracking"]["total_events"]
        })
        
    except Exception as e:
        try:
            db.rollback()
        except:
            pass
        print(f"[ERROR] track_engagement failed: {e}", flush=True)
        return create_error_response("INTERNAL_ERROR", custom_message="Tracking failed. Please try again.")
