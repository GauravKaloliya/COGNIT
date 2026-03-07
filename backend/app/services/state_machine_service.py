import json
from typing import Dict, Set, Optional

from sqlalchemy import text


PAYMENT_STATUS_TRANSITIONS: Dict[str, Set[str]] = {
    "pending": {"processing", "expired", "failed", "rejected_fraud"},
    "processing": {"success", "rejected_fraud", "failed"},
    "success": set(),
    "rejected_fraud": set(),
    "expired": set(),
    "failed": set(),
    "refunded": set(),
}

SUBMISSION_WORKFLOW_ALLOWED_STAGES_BY_PAYMENT: Dict[str, Set[str]] = {
    "paid": {"survey", "finished"},
}


class StateTransitionError(ValueError):
    pass


def ensure_payment_status_transition(current_status: str, target_status: str) -> None:
    current = (current_status or "").strip().lower()
    target = (target_status or "").strip().lower()

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
    p_status = (payment_status or "").strip().lower()
    stage = (current_stage or "").strip().lower()

    if p_status not in SUBMISSION_WORKFLOW_ALLOWED_STAGES_BY_PAYMENT:
        raise StateTransitionError(
            f"Submission not allowed when payment_status='{payment_status}'"
        )

    allowed_stages = SUBMISSION_WORKFLOW_ALLOWED_STAGES_BY_PAYMENT[p_status]
    if stage not in allowed_stages:
        raise StateTransitionError(
            f"Submission not allowed at participant stage='{current_stage}'"
        )


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
    db.execute(
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
            "event_type": "payment_status_transition",
            "payment_id": int(payment_id),
            "details": f"{from_status}->{to_status}",
            "request_data": '{"request_id": "%s"}' % (request_id or ""),
            "response_data": json.dumps(details or {}),
        },
    )
