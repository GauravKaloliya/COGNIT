"""Shared SQL query helpers for email OTP verification."""

from sqlalchemy import text

QUERY_SELECT_PARTICIPANT_BY_PUBLIC_EMAIL = text("""
    SELECT id, email, email_verified
    FROM participants
    WHERE public_id = :pub
      AND email = :em
      AND is_deleted = false
    LIMIT 1
""")

QUERY_SELECT_PARTICIPANT_BY_PUBLIC_ID = text("""
    SELECT id, email, email_verified
    FROM participants
    WHERE public_id = :pub
      AND is_deleted = false
    LIMIT 1
""")

QUERY_EMAIL_IN_USE_BY_OTHER = text("""
    SELECT 1
    FROM participants
    WHERE email = :em
      AND public_id <> :pub
      AND is_deleted = false
    LIMIT 1
""")

QUERY_MARK_EXISTING_EMAIL_OTPS_USED = text("""
    UPDATE email_otps
    SET is_used = true
    WHERE public_id = :pub
      AND email = :em
      AND is_used = false
""")

QUERY_INSERT_EMAIL_OTP = text("""
    INSERT INTO email_otps (
        public_id, email, otp_hash, attempts, is_used, expires_at
    ) VALUES (
        :pub, :em, :hash, 0, false, :exp
    )
    RETURNING id
""")

QUERY_FETCH_LATEST_EMAIL_OTP = text("""
    SELECT id, otp_hash, attempts, is_used, expires_at
    FROM email_otps
    WHERE public_id = :pub
      AND email = :em
    ORDER BY created_at DESC
    LIMIT 1
""")

QUERY_INCREMENT_OTP_ATTEMPTS = text("""
    UPDATE email_otps
    SET attempts = attempts + 1
    WHERE id = :id
""")

QUERY_MARK_OTP_USED = text("""
    UPDATE email_otps
    SET is_used = true,
        verified_at = COALESCE(verified_at, CURRENT_TIMESTAMP)
    WHERE id = :id
""")

QUERY_MARK_PARTICIPANT_EMAIL_VERIFIED = text("""
    UPDATE participants
    SET email_verified = true,
        email_verified_at = CURRENT_TIMESTAMP
    WHERE id = :pid
""")

QUERY_UPDATE_PARTICIPANT_EMAIL = text("""
    UPDATE participants
    SET email = :em,
        email_verified = false,
        email_verified_at = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = :pid
""")
