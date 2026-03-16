"""Shared SQL query helpers for payment upload attempts."""

from sqlalchemy import text

QUERY_INSERT_PAYMENT_UPLOAD_ATTEMPT = text("""
    INSERT INTO payment_upload_attempts (
        payment_id,
        participant_id,
        idempotency_key,
        sha256,
        file_extension,
        mime_type,
        file_size,
        image_phash,
        detected_app,
        fraud_score,
        status,
        details
    ) VALUES (
        :payment_id,
        :participant_id,
        :idempotency_key,
        :sha256,
        :file_extension,
        :mime_type,
        :file_size,
        :image_phash,
        :detected_app,
        :fraud_score,
        :status,
        CAST(:details AS jsonb)
    )
    RETURNING id
""")

QUERY_FINALIZE_PAYMENT_UPLOAD_ATTEMPT = text("""
    UPDATE payment_upload_attempts
    SET status = :status,
        detected_app = :detected_app,
        failure_reasons = CAST(:failure_reasons AS jsonb),
        fraud_score = COALESCE(:fraud_score, 0),
        details = COALESCE(details, '{}'::jsonb) || CAST(:details AS jsonb),
        completed_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = :attempt_id
""")
