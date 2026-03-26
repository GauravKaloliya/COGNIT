"""Shared SQL query helpers for idempotency persistence."""

from sqlalchemy import text

QUERY_LOAD_IDEMPOTENCY_RESPONSE = text("""
    SELECT request_hash, status_code, response_body
    FROM idempotency_keys
    WHERE endpoint = :endpoint
      AND idempotency_key = :key
      AND participant_public_id IS NOT DISTINCT FROM :participant_public_id
      AND deleted_at IS NULL
      AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
    ORDER BY created_at DESC
    LIMIT 1
""")

QUERY_SAVE_IDEMPOTENCY_RESPONSE = text("""
    INSERT INTO idempotency_keys (
        endpoint,
        idempotency_key,
        participant_public_id,
        request_hash,
        response_body,
        status_code,
        expires_at
    ) VALUES (
        :endpoint,
        :key,
        :participant_public_id,
        :request_hash,
        CAST(:response_body AS jsonb),
        :status_code,
        CURRENT_TIMESTAMP + (:ttl_seconds || ' seconds')::interval
    )
    ON CONFLICT (endpoint, idempotency_key, participant_public_id)
    DO UPDATE SET
        request_hash = EXCLUDED.request_hash,
        response_body = EXCLUDED.response_body,
        status_code = EXCLUDED.status_code,
        expires_at = EXCLUDED.expires_at,
        updated_at = CURRENT_TIMESTAMP,
        deleted_at = NULL
""")

QUERY_DELETE_EXPIRED_IDEMPOTENCY = text("""
    UPDATE idempotency_keys
    SET deleted_at = CURRENT_TIMESTAMP
    WHERE deleted_at IS NULL
      AND (
          (expires_at IS NOT NULL AND expires_at <= CURRENT_TIMESTAMP)
          OR (
              expires_at IS NULL
              AND created_at < (CURRENT_TIMESTAMP - (:ttl_seconds || ' seconds')::interval)
          )
      )
""")
