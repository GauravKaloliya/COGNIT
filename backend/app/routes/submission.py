"""
Submission routes module for C.O.G.N.I.T. backend.
Handles survey submissions and survey telemetry capture.
"""

import json
import hashlib
import logging
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from flask import request, g
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
    SUBMIT_RATE_LIMIT,
)
from app.extensions import limiter
from app.database import get_db, engine
from app.utils.helpers import (
    get_ip_hash,
    count_words,
    calculate_quality_score,
    create_error_response,
    success_response,
)
from app.utils.decorators import track_performance, require_idempotency_key
from app.utils.turnstile import verify_turnstile_token
from app.services import (
    build_request_hash,
    load_idempotent_response,
    save_idempotent_response,
    clamp_time_spent_seconds,
    normalize_engagement_counts,
    dynamic_too_fast_threshold as compute_dynamic_too_fast_threshold,
    evaluate_priority_and_rewards,
    ensure_submission_workflow_state,
    StateTransitionError,
    emit_domain_event,
)
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


def _extract_survey_metrics(payload):
    metrics = payload if isinstance(payload, dict) else {}
    def _safe_int(value, default=0):
        try:
            parsed = int(value)
            return parsed if parsed >= 0 else int(default)
        except Exception:
            return int(default)
    return {
        "survey_time_spent_ms": _safe_int(metrics.get("survey_time_spent_ms"), 0),
        "survey_page_views": _safe_int(metrics.get("survey_page_views"), 0),
        "survey_tab_switches": _safe_int(metrics.get("survey_tab_switches"), 0),
        "survey_page_close_attempts": _safe_int(metrics.get("survey_page_close_attempts"), 0),
        "survey_network_disconnects": _safe_int(metrics.get("survey_network_disconnects"), 0),
        "survey_max_scroll_depth_pct": max(0, min(100, _safe_int(metrics.get("survey_max_scroll_depth_pct"), 0))),
        "survey_clicks": _safe_int(metrics.get("survey_clicks"), 0),
        "survey_keypresses": _safe_int(metrics.get("survey_keypresses"), 0),
    }


# ────────────────────────────────────────────────
# Blueprint Setup
# ────────────────────────────────────────────────

from flask import Blueprint
submission_bp = Blueprint('submission', __name__)
logger = logging.getLogger(__name__)
_SUBMIT_POST_COMMIT_EXECUTOR = ThreadPoolExecutor(max_workers=2, thread_name_prefix="submit-post-commit")


def _enqueue_submit_post_commit_tasks(
    *,
    participant_id: int,
    submission_id: int,
    image_id_str: str,
    is_survey: bool,
    is_attention: bool,
    survey_index,
    quality: float,
    word_count: int,
):
    """Run non-critical side effects outside the request transaction."""
    def _run():
        try:
            with engine.begin() as conn:
                conn.execute(text("""
                    INSERT INTO audit_log (
                        event_type, participant_id, endpoint, http_method, status_code,
                        ip_hash, user_agent, details, request_id
                    ) VALUES (
                        :ev, :pid, :ep, :meth, :st, :iph, :ua, :det, :rid
                    )
                """), {
                    "ev": "submission",
                    "pid": participant_id,
                    "ep": "/submit",
                    "meth": "POST",
                    "st": 200,
                    "iph": "0" * 64,
                    "ua": "",
                    "det": f"wc={word_count} q={quality:.3f} survey={is_survey}",
                    "rid": None,
                })
                emit_domain_event(
                    conn,
                    event_type="submission_saved",
                    correlation_id="",
                    participant_id=participant_id,
                    payload={
                        "submission_id": int(submission_id),
                        "image_id": image_id_str,
                        "is_survey": bool(is_survey),
                        "is_attention_check": bool(is_attention),
                        "survey_index": survey_index,
                        "quality_score": float(quality),
                    },
                )
                evaluate_priority_and_rewards(conn, participant_id, correlation_id="")
        except Exception:
            # Never fail request flow on post-commit side-effect issues.
            pass

    try:
        _SUBMIT_POST_COMMIT_EXECUTOR.submit(_run)
    except Exception:
        pass


# ────────────────────────────────────────────────
# Routes
# ────────────────────────────────────────────────

@submission_bp.route("/submit", methods=["POST"])
@require_payment_completed
@limiter.limit(SUBMIT_RATE_LIMIT)
@track_performance
@require_idempotency_key
def submit():
    """Submit an image description or survey response."""
    d = request.json or {}
    turnstile_token = (d.get("turnstile_token") or "").strip()
    logger.info("submit request_id=%s", getattr(g, "request_id", None))
    idempotency_key = (
        request.headers.get("X-Idempotency-Key")
        or d.get("idempotency_key")
        or ""
    ).strip()[:128]
    public_id = d.get("public_id")
    if not public_id:
        return create_error_response("MISSING_FIELDS", {"fields": ["public_id"]})

    turnstile_ok, _ts_data = verify_turnstile_token(turnstile_token, request.remote_addr)
    if not turnstile_ok:
        return create_error_response("BOT_CHALLENGE_FAILED")

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

    ts = clamp_time_spent_seconds(d.get("time_spent_seconds"))

    # Derive survey/attention behavior from selected image, not client defaults.
    is_survey = False
    survey_index = None

    iph = get_ip_hash()
    ua = request.headers.get("User-Agent", "")[:512]
    request_hash = build_request_hash({
        "public_id": public_id,
        "image_id": image_id_str,
        "description": description,
        "feedback": feedback,
        "rating": rating,
        "time_spent_seconds": ts,
        "tab_switch_count": d.get("tab_switch_count"),
        "page_close_attempts": d.get("page_close_attempts"),
        "network_disconnects": d.get("network_disconnects"),
    })
    survey_metrics = _extract_survey_metrics({
        "survey_time_spent_ms": d.get("survey_time_spent_ms"),
        "survey_page_views": d.get("survey_page_views"),
        "survey_tab_switches": d.get("survey_tab_switches"),
        "survey_page_close_attempts": d.get("survey_page_close_attempts"),
        "survey_network_disconnects": d.get("survey_network_disconnects"),
        "survey_max_scroll_depth_pct": d.get("survey_max_scroll_depth_pct"),
        "survey_clicks": d.get("survey_clicks"),
        "survey_keypresses": d.get("survey_keypresses"),
    })

    try:
        db = get_db()
        _idem, replay = load_idempotent_response(
            db,
            endpoint="/submit",
            idempotency_key=idempotency_key,
            participant_public_id=public_id,
            request_hash=request_hash,
        )
        if replay:
            payload, status_code = replay
            return success_response(payload), status_code

        p_row = db.execute(text("""
            SELECT
                p.id,
                p.consent_given,
                p.is_deleted,
                p.extra_metadata,
                p.payment_status,
                p.current_stage,
                COALESCE(pas.is_flagged, false) AS is_flagged
            FROM participants p
            LEFT JOIN participant_attention_stats pas ON pas.participant_id = p.id
            WHERE p.public_id = :pub
        """), {"pub": public_id}).fetchone()

        if not p_row or p_row[2]:
            return create_error_response("PARTICIPANT_NOT_FOUND")
        if not p_row[1]:
            return create_error_response("CONSENT_REQUIRED")
        try:
            ensure_submission_workflow_state(p_row[4], p_row[5])
        except StateTransitionError as workflow_err:
            logger.warning(
                "submit blocked by state machine request_id=%s public_id=%s reason=%s",
                getattr(g, "request_id", None),
                public_id,
                workflow_err,
            )
            return create_error_response("PAYMENT_INVALID_STATE")

        participant_id = p_row[0]
        participant_meta = p_row[3] or {}
        if isinstance(participant_meta, str):
            try:
                participant_meta = json.loads(participant_meta)
            except Exception:
                participant_meta = {}

        if p_row[6]:
            return create_error_response("FLAGGED_ACCOUNT")

        img_row = db.execute(text("""
            SELECT
                i.id,
                CASE
                    WHEN i.tags IS NULL THEN true
                    WHEN 'non-survey' = ANY(i.tags) THEN false
                    ELSE true
                END AS is_survey_image
            FROM images i
            WHERE i.image_id = :iid
        """), {"iid": image_id_str}).fetchone()
        if not img_row:
            return create_error_response("INVALID_IMAGE_ID")
        image_id_fk = img_row[0]
        is_survey = bool(img_row[1])

        if is_survey:
            db.execute(text("""
                SELECT id
                FROM participants
                WHERE id = :pid
                FOR UPDATE
            """), {"pid": participant_id})
            next_survey_index = db.execute(text("""
                SELECT COALESCE(MAX(survey_index), 0) + 1
                FROM submissions
                WHERE participant_id = :pid
                  AND is_survey = true
            """), {"pid": participant_id}).scalar()
            survey_index = int(next_survey_index or 1)
        else:
            survey_index = None

            dup = db.execute(text("""
                SELECT 1
                FROM submissions
                WHERE participant_id = :pid
                  AND image_id = :iid
                  AND is_survey = false
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

        dynamic_too_fast_threshold = compute_dynamic_too_fast_threshold(TOO_FAST_SECONDS, word_count)
        too_fast = ts is not None and ts < dynamic_too_fast_threshold
        if is_attention and too_fast:
            attention_passed = False
            attention_failure_reasons.append("too_fast_attention")

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

        engagement = normalize_engagement_counts(d)
        tab_switch_count = engagement["tab_switch_count"]
        page_close_attempts = engagement["page_close_attempts"]
        network_disconnects = engagement["network_disconnects"]
        if survey_metrics["survey_time_spent_ms"] == 0 and ts is not None:
            survey_metrics["survey_time_spent_ms"] = max(0, int(float(ts) * 1000))
        if survey_metrics["survey_page_views"] == 0:
            survey_metrics["survey_page_views"] = 1
        if survey_metrics["survey_tab_switches"] == 0:
            survey_metrics["survey_tab_switches"] = tab_switch_count
        if survey_metrics["survey_page_close_attempts"] == 0:
            survey_metrics["survey_page_close_attempts"] = page_close_attempts
        if survey_metrics["survey_network_disconnects"] == 0:
            survey_metrics["survey_network_disconnects"] = network_disconnects

        quality = calculate_quality_score(
            word_count,
            attention_passed,
            ts,
            len(feedback),
            False,
            distinct_word_count=distinct_word_count,
            tab_switch_count=tab_switch_count,
            page_close_attempts=page_close_attempts,
            network_disconnects=network_disconnects,
            too_fast_threshold=dynamic_too_fast_threshold,
        )

        submission_row = db.execute(text("""
            INSERT INTO submissions (
                participant_id, image_id, survey_index, description, word_count,
                rating, feedback, time_spent_seconds, is_survey, is_attention_check,
                attention_passed, flagged_too_fast, quality_score,
                ip_hash, user_agent, extra_metadata,
                tab_switch_count, page_close_attempts, network_disconnects,
                survey_time_spent_ms, survey_page_views, survey_tab_switches,
                survey_page_close_attempts, survey_network_disconnects,
                survey_max_scroll_depth_pct, survey_clicks, survey_keypresses
            ) VALUES (
                :pid, :iid, :sidx, :desc, :wc, :rt, :fb, :ts, :isv, :isa,
                :ap, :tf, :qs, :iph, :ua, :meta,
                :tsc, :pca, :nd,
                :survey_time_spent_ms, :survey_page_views, :survey_tab_switches,
                :survey_page_close_attempts, :survey_network_disconnects,
                :survey_max_scroll_depth_pct, :survey_clicks, :survey_keypresses
            ) RETURNING id
        """), {
            "pid": participant_id, "iid": image_id_fk, "sidx": survey_index,
            "desc": description, "wc": word_count, "rt": rating, "fb": feedback,
            "ts": ts, "isv": is_survey, "isa": is_attention, "ap": attention_passed,
            "tf": too_fast, "qs": quality, "iph": iph, "ua": ua,
            "meta": json.dumps(submission_meta),
            "tsc": tab_switch_count, "pca": page_close_attempts, "nd": network_disconnects,
            "survey_time_spent_ms": int(survey_metrics["survey_time_spent_ms"]),
            "survey_page_views": int(survey_metrics["survey_page_views"]),
            "survey_tab_switches": int(survey_metrics["survey_tab_switches"]),
            "survey_page_close_attempts": int(survey_metrics["survey_page_close_attempts"]),
            "survey_network_disconnects": int(survey_metrics["survey_network_disconnects"]),
            "survey_max_scroll_depth_pct": int(survey_metrics["survey_max_scroll_depth_pct"]),
            "survey_clicks": int(survey_metrics["survey_clicks"]),
            "survey_keypresses": int(survey_metrics["survey_keypresses"]),
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

        # Link submission to participant's latest successful payment (if any).
        latest_success_payment_id = db.execute(text("""
            SELECT id
            FROM payments
            WHERE participant_id = :pid
              AND status = 'success'
            ORDER BY COALESCE(verified_at, created_at) DESC, id DESC
            LIMIT 1
        """), {"pid": participant_id}).scalar()
        if latest_success_payment_id:
            db.execute(text("""
                INSERT INTO payment_submissions (payment_id, submission_id)
                VALUES (:payment_id, :submission_id)
                ON CONFLICT DO NOTHING
            """), {
                "payment_id": latest_success_payment_id,
                "submission_id": submission_id
            })

        # Release image reservation on successful submission (soft release).
        try:
            db.execute(text("""
                UPDATE image_reservations
                SET released_at = CURRENT_TIMESTAMP
                WHERE image_id = :img
                  AND participant_id = :pid
                  AND released_at IS NULL
            """), {"img": image_id_str, "pid": participant_id})
        except Exception:
            pass

        db.commit()
        _enqueue_submit_post_commit_tasks(
            participant_id=int(participant_id),
            submission_id=int(submission_id),
            image_id_str=str(image_id_str),
            is_survey=bool(is_survey),
            is_attention=bool(is_attention),
            survey_index=survey_index,
            quality=float(quality),
            word_count=int(word_count),
        )
        logger.info(
            "submission accepted request_id=%s participant_id=%s submission_id=%s image_id=%s attention=%s passed=%s",
            getattr(g, "request_id", None),
            participant_id,
            submission_id,
            image_id_str,
            is_attention,
            attention_passed,
        )

        response_payload = {
            "status": "submitted",
            "word_count": word_count,
            "quality_score": quality,
            "attention_passed": attention_passed,
            "flagged_too_fast": too_fast,
            "survey_index": survey_index,
            "is_survey": is_survey,
            "is_attention_check": is_attention,
            "engagement": {
                "tab_switch_count": tab_switch_count,
                "page_close_attempts": page_close_attempts,
                "network_disconnects": network_disconnects,
                "survey_metrics": survey_metrics,
            },
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
        }
        save_idempotent_response(
            db,
            endpoint="/submit",
            idempotency_key=idempotency_key,
            participant_public_id=public_id,
            request_hash=request_hash,
            response_body=response_payload,
            status_code=200,
        )
        try:
            db.commit()
        except Exception:
            pass
        return success_response(response_payload)

    except Exception as exc:
        try:
            db.rollback()
        except:
            pass
        if "unique" in str(exc).lower() and "survey_index" in str(exc):
            return create_error_response("SURVEY_EXISTS")
        logger.error("submit failed request_id=%s public_id=%s error=%s", getattr(g, "request_id", None), public_id, exc)
        return create_error_response("DATABASE_ERROR")
