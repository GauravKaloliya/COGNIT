import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.state_machine_service import (
    PAYMENT_STATUS_TRANSITIONS,
    SUBMISSION_WORKFLOW_ALLOWED_STAGES_BY_PAYMENT,
    StateTransitionError,
    ensure_payment_status_transition,
    ensure_submission_workflow_state,
)


def test_payment_transition_map_is_explicit_and_non_empty():
    assert "pending" in PAYMENT_STATUS_TRANSITIONS
    assert "processing" in PAYMENT_STATUS_TRANSITIONS
    assert PAYMENT_STATUS_TRANSITIONS["pending"]


def test_payment_valid_transitions():
    ensure_payment_status_transition("pending", "processing")
    ensure_payment_status_transition("processing", "success")
    ensure_payment_status_transition("pending", "expired")
    ensure_payment_status_transition("pending", "failed")


def test_payment_invalid_transitions_raise():
    try:
        ensure_payment_status_transition("success", "processing")
        assert False, "expected StateTransitionError"
    except StateTransitionError:
        pass

    try:
        ensure_payment_status_transition("pending", "success")
        assert False, "expected StateTransitionError"
    except StateTransitionError:
        pass


def test_payment_unknown_status_raises():
    try:
        ensure_payment_status_transition("mystery", "processing")
        assert False, "expected StateTransitionError"
    except StateTransitionError:
        pass


def test_submission_workflow_guard_valid_states():
    allowed = SUBMISSION_WORKFLOW_ALLOWED_STAGES_BY_PAYMENT["paid"]
    for stage in allowed:
        ensure_submission_workflow_state("paid", stage)


def test_submission_workflow_guard_rejects_invalid_payment_status():
    for payment_status in ("pending", "failed", "refunded", "cancelled", ""):
        try:
            ensure_submission_workflow_state(payment_status, "survey")
            assert False, "expected StateTransitionError"
        except StateTransitionError:
            pass


def test_submission_workflow_guard_rejects_invalid_stage_for_paid():
    for stage in ("consent", "user-details", "payment", "payment-link", ""):
        try:
            ensure_submission_workflow_state("paid", stage)
            assert False, "expected StateTransitionError"
        except StateTransitionError:
            pass
