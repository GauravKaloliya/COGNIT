"""Shared SQL query helpers for payment session lifecycle."""

from sqlalchemy import text

QUERY_UPDATE_PAYMENT_WRITE_TOKEN_METADATA = text("""
    UPDATE payments
    SET metadata = COALESCE(metadata, '{}'::jsonb) || CAST(:patch AS jsonb),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = :pid
""")

QUERY_INSERT_PAYMENT_AUDIT_LOG = text("""
    INSERT INTO payment_audit_log (
        event_type, payment_id, participant_id, ip_hash, user_agent,
        device_fingerprint, request_data, response_data, fraud_signals, details
    ) VALUES (
        :event_type, :payment_id, :participant_id, :ip_hash, :user_agent,
        :device_fingerprint, CAST(:request_data AS jsonb), CAST(:response_data AS jsonb), CAST(:fraud_signals AS jsonb), :details
    )
""")

QUERY_GET_PARTICIPANT_SESSION_ID = text("""
    SELECT session_id FROM participants WHERE id = :pid
""")

QUERY_MARK_EXISTING_ACTIVE_PAYMENTS_FAILED = text("""
    UPDATE payments
    SET status = :failed_status,
        updated_at = CURRENT_TIMESTAMP
    WHERE participant_id = :pid
      AND status IN (:pending_status, :processing_status)
""")

QUERY_INSERT_PAYMENT_RECORD = text("""
    INSERT INTO payments (
        participant_id, public_id, upi_account_id, upi_vpa, upi_name,
        amount, signature, expires_at, timer_activated_at, detected_app, metadata
    ) VALUES (
        :pid, :pub_id, :upi_account_id, :upi_vpa, :upi_name,
        :amt, :sig, :exp, :timer_time, :detected_app,
        '{}'::jsonb
    )
    RETURNING id, public_id
""")

QUERY_FETCH_ACTIVE_PAYMENT_FOR_REUSE = text("""
    SELECT id, public_id, amount, expires_at, signature, upi_account_id, upi_vpa, upi_name
    FROM payments
    WHERE participant_id = :pid
      AND status IN (:pending_status, :processing_status)
    ORDER BY created_at DESC
    LIMIT 1
""")

QUERY_FETCH_PAYMENT_STATUS_ROW = text("""
    SELECT p.id, p.participant_id, p.status, p.expires_at, p.amount, p.verified_at, p.verification_details, p.detected_app, p.auto_rejected, p.verification_attempts, p.signature, pr.session_id
    FROM payments p
    JOIN participants pr ON pr.id = p.participant_id
    WHERE p.public_id = :pid
""")

QUERY_EXPIRE_PAYMENT_IF_NEEDED = text("""
    UPDATE payments
    SET status = :expired_status, updated_at = CURRENT_TIMESTAMP
    WHERE id = :pid
""")

QUERY_FETCH_TOKEN_MINT_ROW = text("""
    SELECT p.id, p.participant_id, p.status, p.expires_at, p.signature, pr.session_id
    FROM payments p
    JOIN participants pr ON pr.id = p.participant_id
    WHERE p.public_id = :pid
      AND pr.public_id = :pub
      AND pr.session_id = :sid
    LIMIT 1
""")

QUERY_FETCH_PAYMENT_REFRESH_ROW = text("""
    SELECT p.id, p.participant_id, p.status, p.amount, p.upi_account_id, pr.session_id
    FROM payments p
    JOIN participants pr ON pr.id = p.participant_id
    WHERE p.public_id = :pid
      AND pr.public_id = :pub
      AND pr.session_id = :sid
    LIMIT 1
    FOR UPDATE
""")
