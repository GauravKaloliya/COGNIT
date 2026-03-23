import unittest

from test_env import ensure_test_env

ensure_test_env()

from app.services.payment_workflow_service import participant_state_for_payment_status  # noqa: E402
from app.services.state_machine_service import (  # noqa: E402
    StateTransitionError,
    ensure_payment_status_transition,
    ensure_submission_workflow_state,
)


class StateMachineServiceTests(unittest.TestCase):
    def test_allows_valid_payment_transition(self):
        ensure_payment_status_transition("pending", "processing")

    def test_rejects_invalid_payment_transition(self):
        with self.assertRaises(StateTransitionError):
            ensure_payment_status_transition("success", "pending")

    def test_maps_participant_state_from_payment_status(self):
        self.assertEqual(participant_state_for_payment_status("success"), ("paid", "survey"))
        self.assertEqual(participant_state_for_payment_status("rejected_fraud"), ("failed", "payment"))

    def test_submission_gate_requires_paid_survey_flow(self):
        ensure_submission_workflow_state("paid", "survey")
        with self.assertRaises(StateTransitionError):
            ensure_submission_workflow_state("pending", "payment")
