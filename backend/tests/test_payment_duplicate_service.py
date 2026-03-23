import unittest
from unittest.mock import MagicMock, patch

from flask import Flask

from test_env import ensure_test_env

ensure_test_env()

from app.services.payment_duplicate_service import resolve_duplicate_upload_response  # noqa: E402


class PaymentDuplicateServiceTests(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.ctx = self.app.app_context()
        self.ctx.push()

    def tearDown(self):
        self.ctx.pop()

    def test_duplicate_self_returns_canonical_error(self):
        db = MagicMock()
        finalize_attempt = MagicMock()
        reject_payment_for_fraud = MagicMock(return_value=42.0)

        with patch("app.services.payment_duplicate_service.check_duplicate_screenshot", return_value=(True, 55, True)), \
             patch("app.services.payment_duplicate_service.is_same_person_by_fingerprint", return_value=False):
            response, status_code = resolve_duplicate_upload_response(
                db=db,
                payment_id=10,
                participant_id=20,
                sha256_hash="a" * 64,
                image_hash="b" * 16,
                device_fingerprint="fp",
                device_fingerprint_variants=["fp"],
                payment_audit_logger=None,
                fetch_payment_owner_participant_id=lambda *_args, **_kwargs: 20,
                reject_payment_for_fraud=reject_payment_for_fraud,
                finalize_attempt=finalize_attempt,
            )

        self.assertEqual(status_code, 200)
        self.assertEqual(response.get_json()["error"]["code"], "FRAUD_003_0004")
        db.commit.assert_called_once()
        finalize_attempt.assert_called_once()
