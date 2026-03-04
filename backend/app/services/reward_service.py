import json

from sqlalchemy import text

from app.config import (
    PRIORITY_QUEUE_MIN_TOTAL_WORDS,
    PRIORITY_QUEUE_MIN_ROUNDS,
    REWARD_MAX_AVG_TIME_SECONDS,
    REWARD_MIN_AVG_FEEDBACK_LENGTH,
    REWARD_MIN_AVG_RATING,
    REWARD_MIN_AVG_QUALITY_SCORE,
)
from app.services.domain_event_service import emit_domain_event


def evaluate_priority_and_rewards(db, participant_id: int, correlation_id: str = None):
    db.execute(text("""
        INSERT INTO participant_activity_stats (
            participant_id, last_reward_check
        ) VALUES (
            :pid, CURRENT_TIMESTAMP
        )
        ON CONFLICT (participant_id) DO UPDATE SET
            last_reward_check = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
    """), {"pid": participant_id})

    participant = db.execute(text("""
        SELECT consent_given, is_deleted, payment_status
        FROM participants
        WHERE id = :pid
    """), {"pid": participant_id}).fetchone()
    if not participant:
        return

    consent_given, is_deleted, payment_status = participant

    metrics = db.execute(text("""
        SELECT
            COALESCE(SUM(s.word_count), 0) AS total_words,
            COALESCE(MAX(s.survey_index), 0) AS max_round,
            COALESCE(COUNT(*) FILTER (WHERE s.is_survey = true), 0) AS survey_count,
            COALESCE(SUM(s.tab_switch_count), 0) AS total_tab_switch,
            COALESCE(SUM(s.page_close_attempts), 0) AS total_page_close,
            COALESCE(SUM(s.network_disconnects), 0) AS total_network_disconnect,
            AVG(COALESCE(s.time_spent_seconds, 0)) AS avg_time_spent,
            AVG(length(COALESCE(s.feedback, ''))) AS avg_feedback_length,
            AVG(COALESCE(s.rating, 0)) AS avg_rating,
            AVG(COALESCE(s.quality_score, 0)) AS avg_quality_score
        FROM submissions s
        WHERE s.participant_id = :pid
          AND s.is_survey = true
    """), {"pid": participant_id}).fetchone()

    if not metrics:
        return

    (
        total_words,
        max_round,
        survey_count,
        total_tab_switch,
        total_page_close,
        total_network_disconnect,
        avg_time_spent,
        avg_feedback_length,
        avg_rating,
        avg_quality_score,
    ) = metrics

    layer_one_pass = (
        bool(consent_given)
        and not bool(is_deleted)
        and (payment_status == "paid")
        and int(total_words or 0) >= PRIORITY_QUEUE_MIN_TOTAL_WORDS
        and int(max_round or 0) >= PRIORITY_QUEUE_MIN_ROUNDS
        and int(survey_count or 0) >= PRIORITY_QUEUE_MIN_ROUNDS
        and int(total_tab_switch or 0) == 0
        and int(total_page_close or 0) == 0
        and int(total_network_disconnect or 0) == 0
    )

    queue_reason = "layer_one_passed" if layer_one_pass else "layer_one_failed"

    db.execute(text("""
        INSERT INTO priority_participants (
            participant_id,
            total_words,
            completed_rounds,
            total_tab_switch,
            total_page_close_attempts,
            total_network_disconnects,
            avg_time_spent_seconds,
            avg_feedback_length,
            avg_rating,
            avg_quality_score,
            is_eligible,
            reason_code,
            metadata,
            last_evaluated_at
        ) VALUES (
            :participant_id,
            :total_words,
            :completed_rounds,
            :total_tab_switch,
            :total_page_close_attempts,
            :total_network_disconnects,
            :avg_time_spent_seconds,
            :avg_feedback_length,
            :avg_rating,
            :avg_quality_score,
            :is_eligible,
            :reason_code,
            CAST(:metadata AS jsonb),
            CURRENT_TIMESTAMP
        )
        ON CONFLICT (participant_id) DO UPDATE SET
            total_words = EXCLUDED.total_words,
            completed_rounds = EXCLUDED.completed_rounds,
            total_tab_switch = EXCLUDED.total_tab_switch,
            total_page_close_attempts = EXCLUDED.total_page_close_attempts,
            total_network_disconnects = EXCLUDED.total_network_disconnects,
            avg_time_spent_seconds = EXCLUDED.avg_time_spent_seconds,
            avg_feedback_length = EXCLUDED.avg_feedback_length,
            avg_rating = EXCLUDED.avg_rating,
            avg_quality_score = EXCLUDED.avg_quality_score,
            is_eligible = EXCLUDED.is_eligible,
            reason_code = EXCLUDED.reason_code,
            metadata = EXCLUDED.metadata,
            last_evaluated_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
    """), {
        "participant_id": participant_id,
        "total_words": int(total_words or 0),
        "completed_rounds": int(max_round or 0),
        "total_tab_switch": int(total_tab_switch or 0),
        "total_page_close_attempts": int(total_page_close or 0),
        "total_network_disconnects": int(total_network_disconnect or 0),
        "avg_time_spent_seconds": float(avg_time_spent or 0),
        "avg_feedback_length": float(avg_feedback_length or 0),
        "avg_rating": float(avg_rating or 0),
        "avg_quality_score": float(avg_quality_score or 0),
        "is_eligible": layer_one_pass,
        "reason_code": queue_reason,
        "metadata": json.dumps({
            "thresholds": {
                "min_total_words": PRIORITY_QUEUE_MIN_TOTAL_WORDS,
                "min_rounds": PRIORITY_QUEUE_MIN_ROUNDS,
            }
        }),
    })

    if not layer_one_pass:
        return

    emit_domain_event(
        db,
        event_type="priority_qualified",
        correlation_id=correlation_id,
        participant_id=participant_id,
        payload={
            "total_words": int(total_words or 0),
            "completed_rounds": int(max_round or 0),
            "avg_quality_score": float(avg_quality_score or 0),
        },
    )

    layer_two_pass = (
        float(avg_time_spent or 0) <= REWARD_MAX_AVG_TIME_SECONDS
        and float(avg_feedback_length or 0) >= REWARD_MIN_AVG_FEEDBACK_LENGTH
        and float(avg_rating or 0) >= REWARD_MIN_AVG_RATING
        and float(avg_quality_score or 0) >= REWARD_MIN_AVG_QUALITY_SCORE
    )

    if not layer_two_pass:
        return

    db.execute(text("""
        INSERT INTO reward_winners (
            participant_id,
            reason_code,
            is_selected,
            selected_at,
            status,
            notes
        ) VALUES (
            :participant_id,
            :reason_code,
            true,
            CURRENT_TIMESTAMP,
            'pending',
            :notes
        )
        ON CONFLICT (participant_id) DO UPDATE SET
            reason_code = EXCLUDED.reason_code,
            is_selected = true,
            status = CASE
                WHEN reward_winners.status IN ('cancelled', 'expired') THEN reward_winners.status
                ELSE 'pending'
            END,
            notes = EXCLUDED.notes,
            updated_at = CURRENT_TIMESTAMP
    """), {
        "participant_id": participant_id,
        "reason_code": "priority_layer_two_passed",
        "notes": (
            f"avg_time={float(avg_time_spent or 0):.2f}, "
            f"avg_feedback={float(avg_feedback_length or 0):.2f}, "
            f"avg_rating={float(avg_rating or 0):.2f}, "
            f"avg_quality={float(avg_quality_score or 0):.4f}"
        )[:2000],
    })
    emit_domain_event(
        db,
        event_type="reward_selected",
        correlation_id=correlation_id,
        participant_id=participant_id,
        payload={
            "reason_code": "priority_layer_two_passed",
            "avg_time_spent_seconds": float(avg_time_spent or 0),
            "avg_feedback_length": float(avg_feedback_length or 0),
            "avg_rating": float(avg_rating or 0),
            "avg_quality_score": float(avg_quality_score or 0),
        },
    )
