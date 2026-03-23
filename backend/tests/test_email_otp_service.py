import unittest
from contextlib import contextmanager
from unittest.mock import MagicMock, patch

from test_env import ensure_test_env

ensure_test_env()

from app.services.email_otp_service import EmailOtpSendError, enqueue_email_otp  # noqa: E402


class EmailOtpServiceTests(unittest.TestCase):
    def test_enqueue_marks_otp_used_when_async_send_fails(self):
        conn = MagicMock()

        @contextmanager
        def fake_begin():
            yield conn

        with patch("app.services.email_otp_service.send_email_otp", side_effect=EmailOtpSendError(kind="timeout")), \
             patch("app.services.email_otp_service.engine.begin", side_effect=fake_begin), \
             patch("app.services.email_otp_service.EMAIL_OTP_EXECUTOR.submit", side_effect=lambda fn: fn()):
            enqueue_email_otp({"to": "user@example.com"}, otp_id=123, request_id="req_1")

        self.assertTrue(conn.execute.called)
        self.assertEqual(conn.execute.call_args[0][1]["id"], 123)
