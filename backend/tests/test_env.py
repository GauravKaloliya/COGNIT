import os


def ensure_test_env() -> None:
    defaults = {
        "WEBSITE_URL": "https://example.com",
        "UPI_NAME": "COGNIT",
        "PAYMENT_SECRET": "test-payment-secret",
        "EMAIL_OTP_WEBHOOK_URL": "https://example.com/otp",
        "EMAIL_OTP_SENDER": "noreply@example.com",
        "EMAIL_OTP_SUBJECT": "OTP",
        "EMAIL_OTP_HTML_TEMPLATE": "<p>{otp}</p>",
        "EMAIL_OTP_JWT_SECRET": "jwt-secret",
        "TURNSTILE_VERIFY_URL": "https://example.com/turnstile",
        "DEVICE_FINGERPRINT_SALTS": "test-fingerprint-salt",
        "AWS_ACCESS_KEY_ID": "test-access",
        "AWS_SECRET_ACCESS_KEY": "test-secret",
        "S3_BUCKET_NAME": "test-bucket",
        "IP_HASH_SALT": "salt",
        "DATABASE_URL": "sqlite:///:memory:",
        "SECRET_KEY": "secret",
        "RATELIMIT_STORAGE_URI": "memory://",
    }
    for key, value in defaults.items():
        os.environ.setdefault(key, value)
