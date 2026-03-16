"""Shared SQL query helpers for image services."""

from sqlalchemy import text

QUERY_LOAD_IMAGE_POOL = text("""
    SELECT
        i.image_id,
        i.url,
        EXISTS (
            SELECT 1
            FROM attention_checks ac
            WHERE ac.image_id = i.id AND ac.is_active = true
        ) AS is_attention
    FROM images i
""")

QUERY_RESERVE_IMAGE = text("""
    INSERT INTO image_reservations (
        image_id, participant_id, reserved_at, expires_at, released_at
    ) VALUES (
        :iid, :pid, :now, :now, NULL
    )
    ON CONFLICT (image_id) DO UPDATE SET
        participant_id = EXCLUDED.participant_id,
        reserved_at = EXCLUDED.reserved_at,
        expires_at = EXCLUDED.expires_at,
        released_at = NULL
    WHERE image_reservations.released_at IS NOT NULL
    RETURNING image_id
""")

QUERY_CLEANUP_STALE_RESERVATIONS = text("""
    UPDATE image_reservations
    SET released_at = CURRENT_TIMESTAMP
    WHERE released_at IS NULL
      AND reserved_at <= (CURRENT_TIMESTAMP - (:ttl || ' seconds')::interval)
""")
