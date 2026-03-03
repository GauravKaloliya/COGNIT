"""
Submission routes module for C.O.G.N.I.T. backend.
Handles survey submissions and engagement tracking.
"""

import json
import hashlib
import logging
import re
from datetime import datetime, timezone

from flask import jsonify, request, g
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
    ATTENTION_HARD_FLAG_CONSEC_FAILS,
    ATTENTION_MIN_DISTINCT_WORDS,
    ATTENTION_MIN_CHAR_LENGTH,
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
from middleware.payment_flow import require_payment_completed

ATTN_TOKEN_SPLIT_RE = re.compile(r"[|,;/]+")


def _normalize_for_attention(text: str) -> str:
    """Normalize text for robust attention keyword matching."""
    normalized = re.sub(r"[^a-z0-9]+", " ", (text or "").lower())
    return re.sub(r"\s+", " ", normalized).strip()


def _extract_expected_terms(raw_expected: str):
    """Allow multiple attention terms in DB using separators like | , ; /."""
    tokens = [t.strip() for t in ATTN_TOKEN_SPLIT_RE.split((raw_expected or "").strip())]
    clean = [_normalize_for_attention(t) for t in tokens if t.strip()]
    return [t for t in clean if t]


def _match_attention_terms(description: str, expected_terms, strict: bool):
    """Return list of expected terms found in description."""
    norm_desc = _normalize_for_attention(description)
    if not norm_desc or not expected_terms:
        return []

    matched = []
    for term in expected_terms:
        if strict:
            if re.search(rf"\b{re.escape(term)}\b", norm_desc):
                matched.append(term)
        elif term in norm_desc:
            matched.append(term)
    return matched


def _alphabetic_tokens(text: str):
    return re.findall(r"\b[a-z]{2,}\b", _normalize_for_attention(text))


# ────────────────────────────────────────────────
# Blueprint Setup
# ────────────────────────────────────────────────

from flask import Blueprint
submission_bp = Blueprint('submission', __name__)
logger = logging.getLogger(__name__)


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
    logger.info("submit request_id=%s", getattr(g, "request_id", None))
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
            SELECT id, consent_given, is_deleted, extra_metadata
            FROM participants
            WHERE public_id = :pub
        """), {"pub": public_id}).fetchone()

        if not p_row or p_row[2]:
            return create_error_response("PARTICIPANT_NOT_FOUND")
        if not p_row[1]:
            return create_error_response("CONSENT_REQUIRED")

        participant_id = p_row[0]
        participant_meta = p_row[3] or {}
        if isinstance(participant_meta, str):
            try:
                participant_meta = json.loads(participant_meta)
            except Exception:
                participant_meta = {}

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
        attention_expected_terms = []
        attention_matched_terms = []
        attention_failure_reasons = []
        description_fingerprint = hashlib.sha256(_normalize_for_attention(description).encode("utf-8")).hexdigest()
        distinct_word_count = len(set(_alphabetic_tokens(description)))
        if is_attention:
            expected = ac_row[0].strip().lower()
            strict = ac_row[1]
            attention_expected_terms = _extract_expected_terms(expected) or [_normalize_for_attention(expected)]
            attention_matched_terms = _match_attention_terms(description, attention_expected_terms, strict)
            attention_passed = len(attention_matched_terms) > 0
            if not attention_passed:
                attention_failure_reasons.append("missing_expected_keyword")

            if len(description.strip()) < ATTENTION_MIN_CHAR_LENGTH:
                attention_passed = False
                attention_failure_reasons.append("attention_too_short")

            if distinct_word_count < ATTENTION_MIN_DISTINCT_WORDS:
                attention_passed = False
                attention_failure_reasons.append("low_distinct_word_count")

            copied = db.execute(text("""
                SELECT 1
                FROM attention_events ae
                WHERE ae.image_id = :img_id
                  AND ae.content_fingerprint = :fp
                  AND ae.participant_id <> :pid
                LIMIT 1
            """), {
                "img_id": image_id_fk,
                "fp": description_fingerprint,
                "pid": participant_id
            }).scalar()
            if copied:
                attention_passed = False
                attention_failure_reasons.append("copied_attention_pattern")

        too_fast = ts is not None and ts < TOO_FAST_SECONDS
        if is_attention and too_fast:
            attention_passed = False
            attention_failure_reasons.append("too_fast_attention")
        quality = calculate_quality_score(word_count, attention_passed, ts, len(feedback), False)

        submission_meta = {}
        if is_attention:
            submission_meta["attention"] = {
                "strict": bool(ac_row[1]),
                "expected_terms": attention_expected_terms,
                "matched_terms": attention_matched_terms,
                "failure_reasons": attention_failure_reasons,
                "distinct_word_count": distinct_word_count,
                "content_fingerprint": description_fingerprint
            }

        # Get engagement tracking data
        tab_switch_count = d.get("tab_switch_count", 0)
        page_close_attempts = d.get("page_close_attempts", 0)
        network_disconnects = d.get("network_disconnects", 0)

        submission_row = db.execute(text("""
            INSERT INTO submissions (
                participant_id, image_id, survey_index, description, word_count,
                rating, feedback, time_spent_seconds, is_survey, is_attention_check,
                attention_passed, flagged_too_fast, quality_score,
                ip_hash, user_agent, extra_metadata,
                tab_switch_count, page_close_attempts, network_disconnects
            ) VALUES (
                :pid, :iid, :sidx, :desc, :wc, :rt, :fb, :ts, :isv, :isa,
                :ap, :tf, :qs, :iph, :ua, :meta,
                :tsc, :pca, :nd
            ) RETURNING id
        """), {
            "pid": participant_id, "iid": image_id_fk, "sidx": survey_index,
            "desc": description, "wc": word_count, "rt": rating, "fb": feedback,
            "ts": ts, "isv": is_survey, "isa": is_attention, "ap": attention_passed,
            "tf": too_fast, "qs": quality, "iph": iph, "ua": ua,
            "meta": json.dumps(submission_meta),
            "tsc": tab_switch_count, "pca": page_close_attempts, "nd": network_disconnects
        })
        submission_id = submission_row.scalar()

        consecutive_failures = 0
        recent_attention_score = None
        hard_flag_triggered = False

        if is_attention:
            monitor = participant_meta.get("attention_monitor", {})
            recent_results = monitor.get("recent_results", [])
            if not isinstance(recent_results, list):
                recent_results = []
            recent_results = [bool(x) for x in recent_results[-9:]]
            recent_results.append(bool(attention_passed))

            for result in reversed(recent_results):
                if result:
                    break
                consecutive_failures += 1

            recent_attention_score = round(sum(1 for x in recent_results if x) / len(recent_results), 4)
            hard_flag_triggered = consecutive_failures >= ATTENTION_HARD_FLAG_CONSEC_FAILS

            participant_meta["attention_monitor"] = {
                "recent_results": recent_results,
                "consecutive_failures": consecutive_failures,
                "recent_attention_score": recent_attention_score,
                "last_checked_at": datetime.now(timezone.utc).isoformat()
            }

            db.execute(text("""
                UPDATE participants
                SET extra_metadata = :meta, updated_at = CURRENT_TIMESTAMP
                WHERE id = :pid
            """), {
                "meta": json.dumps(participant_meta),
                "pid": participant_id
            })

            db.execute(text("""
                INSERT INTO attention_events (
                    participant_id,
                    submission_id,
                    image_id,
                    expected_terms,
                    matched_terms,
                    failure_reasons,
                    is_strict,
                    attention_passed,
                    response_seconds,
                    distinct_word_count,
                    content_fingerprint
                ) VALUES (
                    :pid, :sid, :img_id, :expected, :matched, :reasons,
                    :strict, :passed, :resp_secs, :distinct_wc, :fingerprint
                )
            """), {
                "pid": participant_id,
                "sid": submission_id,
                "img_id": image_id_fk,
                "expected": attention_expected_terms,
                "matched": attention_matched_terms,
                "reasons": attention_failure_reasons,
                "strict": bool(ac_row[1]),
                "passed": bool(attention_passed),
                "resp_secs": ts,
                "distinct_wc": distinct_word_count,
                "fingerprint": description_fingerprint
            })

            db.execute(text("""
                UPDATE participant_attention_stats
                SET is_flagged = CASE WHEN :hard_flag THEN true ELSE is_flagged END,
                    last_checked_at = CURRENT_TIMESTAMP
                WHERE participant_id = :pid
            """), {
                "pid": participant_id,
                "hard_flag": hard_flag_triggered,
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
        logger.info(
            "submission accepted request_id=%s participant_id=%s submission_id=%s image_id=%s attention=%s passed=%s",
            getattr(g, "request_id", None),
            participant_id,
            submission_id,
            image_id_str,
            is_attention,
            attention_passed,
        )

        return jsonify({
            "status": "submitted",
            "word_count": word_count,
            "quality_score": quality,
            "attention_passed": attention_passed,
            "flagged_too_fast": too_fast,
            "attention_status": {
                "is_attention_check": is_attention,
                "passed": attention_passed if is_attention else None,
                "expected_terms": attention_expected_terms,
                "matched_terms": attention_matched_terms,
                "failure_reasons": attention_failure_reasons,
                "consecutive_failures": consecutive_failures if is_attention else None,
                "recent_attention_score": recent_attention_score,
                "hard_flag_triggered": hard_flag_triggered
            }
        })

    except Exception as exc:
        try:
            db.rollback()
        except:
            pass
        if "unique" in str(exc).lower() and "survey_index" in str(exc):
            return create_error_response("SURVEY_EXISTS")
        logger.error("submit failed request_id=%s public_id=%s error=%s", getattr(g, "request_id", None), public_id, exc)
        return create_error_response("DATABASE_ERROR")


# ────────────────────────────────────────────────
# Engagement Tracking
# ────────────────────────────────────────────────

@submission_bp.route("/engagement/track", methods=["POST"])
@limiter.limit("60 per minute")
@track_performance
def track_engagement():
    """Track engagement events for all frontend pages."""
    data = request.json or {}
    logger.info("track_engagement request_id=%s", getattr(g, "request_id", None))
    public_id = data.get("public_id")
    event_type = data.get("event_type")
    event_data = data.get("event_data") or {}
    
    if not public_id:
        return create_error_response("MISSING_FIELDS", {"fields": ["public_id"]})
    
    if not event_type:
        return create_error_response("MISSING_FIELDS", {"fields": ["event_type"]})
    
    # Validate event_type
    allowed_events = ["tab_switch", "page_close_attempt", "network_disconnect", "page_view"]
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
                "page_views": 0,
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
        elif event_type == "page_view":
            current_meta["engagement_tracking"]["page_views"] += 1

        current_meta["engagement_tracking"]["total_events"] += 1
        current_meta["engagement_tracking"]["events"].append({
            "type": event_type,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "data": event_data
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
        logger.error("track engagement failed request_id=%s public_id=%s event_type=%s error=%s", getattr(g, "request_id", None), public_id, event_type, e)
        return create_error_response("INTERNAL_ERROR", custom_message="Tracking failed. Please try again.")
