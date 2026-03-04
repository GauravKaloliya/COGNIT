from typing import Dict, Set


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
