import json
from typing import Optional

from sqlalchemy import text

from app.constants.event_constants import AUDIT_EVENT_PAYMENT_STATUS_TRANSITION
from app.services.payment_workflow_service import (
    PAYMENT_STATUS_TRANSITIONS,
    SUBMISSION_WORKFLOW_ALLOWED_STAGES_BY_PAYMENT,
)
from app.services.payment_query_service import sync_participant_from_payment_status
from app.utils.runtime_cache import invalidate_payment_status_cache_by_id


class StateTransitionError(ValueError):
    pass


def ensure_payment_status_transition(current_status: str, target_status: str) -> None:
    current = (current_status or "").strip().lower()
    target = (target_status or "").strip().lower()

    if not current or not target:
        raise StateTransitionError("Payment status transition requires both current and target status.")
    if current == target:
        return
    allowed = PAYMENT_STATUS_TRANSITIONS.get(current)
    if allowed is None:
        raise StateTransitionError(f"Unknown payment status: {current_status}")
    if target not in allowed:
        raise StateTransitionError(
            f"Invalid payment status transition from '{current_status}' to '{target_status}'"
        )


def ensure_submission_workflow_state(payment_status: str, current_stage: str) -> None:
    normalized_status = (payment_status or "").strip().lower()
    normalized_stage = (current_stage or "").strip().lower()
    allowed_stages = SUBMISSION_WORKFLOW_ALLOWED_STAGES_BY_PAYMENT.get(normalized_status)
    if not allowed_stages:
        raise StateTransitionError(f"Submission not allowed when payment_status='{payment_status}'")
    if normalized_stage not in allowed_stages:
        raise StateTransitionError(f"Submission not allowed at participant stage='{current_stage}'")


def transition_payment_status(
    db,
    *,
    payment_id: int,
    from_status: str,
    to_status: str,
    request_id: Optional[str] = None,
    details: Optional[dict] = None,
) -> None:
    """
    Validate and persist a payment status transition with an audit trail.
    """
    ensure_payment_status_transition(from_status, to_status)
    result = db.execute(
        text(
            """
            UPDATE payments
            SET status = :to_status,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = :pid AND status = :from_status
            """
        ),
        {
            "pid": int(payment_id),
            "to_status": str(to_status),
            "from_status": str(from_status),
        },
    )
    if int(getattr(result, "rowcount", 0) or 0) != 1:
        raise StateTransitionError(
            f"Payment status transition rejected by database: {from_status}->{to_status}"
        )
    participant_id = db.execute(
        text("SELECT participant_id FROM payments WHERE id = :pid"),
        {"pid": int(payment_id)},
    ).scalar()
    if participant_id:
        sync_participant_from_payment_status(db, participant_id=int(participant_id), status=str(to_status))
    invalidate_payment_status_cache_by_id(payment_id)
    db.execute(
        text(
            """
            INSERT INTO payment_audit_log (
                event_type, payment_id, details, request_data, response_data
            ) VALUES (
                :event_type, :payment_id, :details, CAST(:request_data AS jsonb), CAST(:response_data AS jsonb)
            )
            """
        ),
        {
            "event_type": AUDIT_EVENT_PAYMENT_STATUS_TRANSITION,
            "payment_id": int(payment_id),
            "details": f"{from_status}->{to_status}",
            "request_data": '{"request_id": "%s"}' % (request_id or ""),
            "response_data": json.dumps(details or {}),
        },
    )
