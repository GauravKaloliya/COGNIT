import json

from app.config import (
    PRIORITY_QUEUE_MIN_TOTAL_WORDS,
    PRIORITY_QUEUE_MIN_ROUNDS,
    PRIORITY_MIN_SUBMISSIONS,
    REWARD_MAX_AVG_TIME_SECONDS,
    REWARD_MIN_AVG_FEEDBACK_LENGTH,
    REWARD_MIN_AVG_RATING,
    REWARD_MIN_AVG_QUALITY_SCORE,
)
from app.constants.event_constants import DOMAIN_EVENT_PRIORITY_QUALIFIED, DOMAIN_EVENT_REWARD_SELECTED
from app.constants.participant_constants import PARTICIPANT_PAYMENT_STATUS_PAID
from app.constants.reward_constants import (
    REWARD_REASON_PRIORITY_LAYER_TWO_PASSED,
    REWARD_STATUS_CANCELLED,
    REWARD_STATUS_EXPIRED,
    REWARD_STATUS_PENDING,
)
from app.services.domain_event_service import emit_domain_event
from app.services.reward_query_service import (
    QUERY_FETCH_REWARD_METRICS,
    QUERY_FETCH_REWARD_PARTICIPANT,
    QUERY_TOUCH_PARTICIPANT_REWARD_CHECK,
    QUERY_UPSERT_PRIORITY_PARTICIPANT,
    QUERY_UPSERT_REWARD_WINNER,
)


def evaluate_priority_and_rewards(db, participant_id: int, correlation_id: str = None):
    db.execute(QUERY_TOUCH_PARTICIPANT_REWARD_CHECK, {"pid": participant_id})

    participant = db.execute(QUERY_FETCH_REWARD_PARTICIPANT, {"pid": participant_id}).fetchone()
    if not participant:
        return

    consent_given, is_deleted, participant_payment_status = participant

    metrics = db.execute(QUERY_FETCH_REWARD_METRICS, {"pid": participant_id}).fetchone()

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
        and (participant_payment_status == PARTICIPANT_PAYMENT_STATUS_PAID)
        and int(total_words or 0) >= PRIORITY_QUEUE_MIN_TOTAL_WORDS
        and int(max_round or 0) >= PRIORITY_QUEUE_MIN_ROUNDS
        and int(survey_count or 0) >= PRIORITY_MIN_SUBMISSIONS
        and int(total_tab_switch or 0) == 0
        and int(total_page_close or 0) == 0
        and int(total_network_disconnect or 0) == 0
    )

    queue_reason = "layer_one_passed" if layer_one_pass else "layer_one_failed"

    db.execute(QUERY_UPSERT_PRIORITY_PARTICIPANT, {
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
                    "min_submissions": PRIORITY_MIN_SUBMISSIONS,
            }
        }),
    })

    if not layer_one_pass:
        return

    emit_domain_event(
        db,
        event_type=DOMAIN_EVENT_PRIORITY_QUALIFIED,
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

    db.execute(QUERY_UPSERT_REWARD_WINNER, {
        "participant_id": participant_id,
        "reason_code": REWARD_REASON_PRIORITY_LAYER_TWO_PASSED,
        "pending_status": REWARD_STATUS_PENDING,
        "cancelled_status": REWARD_STATUS_CANCELLED,
        "expired_status": REWARD_STATUS_EXPIRED,
        "notes": (
            f"avg_time={float(avg_time_spent or 0):.2f}, "
            f"avg_feedback={float(avg_feedback_length or 0):.2f}, "
            f"avg_rating={float(avg_rating or 0):.2f}, "
            f"avg_quality={float(avg_quality_score or 0):.4f}"
        )[:2000],
    })
    emit_domain_event(
        db,
        event_type=DOMAIN_EVENT_REWARD_SELECTED,
        correlation_id=correlation_id,
        participant_id=participant_id,
        payload={
            "reason_code": REWARD_REASON_PRIORITY_LAYER_TWO_PASSED,
            "avg_time_spent_seconds": float(avg_time_spent or 0),
            "avg_feedback_length": float(avg_feedback_length or 0),
            "avg_rating": float(avg_rating or 0),
            "avg_quality_score": float(avg_quality_score or 0),
        },
    )
