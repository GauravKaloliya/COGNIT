"""Shared SQL query helpers for image services."""

import json

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

QUERY_FETCH_ACTIVE_PARTICIPANT_RESERVATION = text("""
    SELECT
        i.image_id,
        i.url,
        NOT EXISTS (
            SELECT 1
            FROM attention_checks ac
            WHERE ac.image_id = i.id AND ac.is_active = true
        ) AS is_survey,
        EXISTS (
            SELECT 1
            FROM attention_checks ac
            WHERE ac.image_id = i.id AND ac.is_active = true
        ) AS is_attention
    FROM image_reservations ir
    JOIN images i ON i.image_id = ir.image_public_id
    WHERE ir.participant_id = :pid
      AND ir.released_at IS NULL
      AND ir.expires_at > CURRENT_TIMESTAMP
      AND NOT EXISTS (
          SELECT 1
          FROM submissions s
          JOIN images si ON si.id = s.image_id
          WHERE s.participant_id = :pid
            AND si.image_id = ir.image_public_id
      )
    ORDER BY ir.reserved_at DESC
    LIMIT 1
""")

QUERY_RESERVE_IMAGE = text("""
    INSERT INTO image_reservations (
        image_public_id, participant_id, reserved_at, expires_at, released_at
    ) VALUES (
        :iid,
        :pid,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP + INTERVAL '15 minutes',
        NULL
    )
    ON CONFLICT (image_public_id) DO UPDATE SET
        participant_id = EXCLUDED.participant_id,
        reserved_at = EXCLUDED.reserved_at,
        expires_at = EXCLUDED.expires_at,
        released_at = NULL
    WHERE image_reservations.released_at IS NOT NULL
    RETURNING image_public_id
""")

QUERY_CLEANUP_STALE_RESERVATIONS = text("""
    UPDATE image_reservations
    SET released_at = CURRENT_TIMESTAMP
    WHERE released_at IS NULL
      AND expires_at <= CURRENT_TIMESTAMP
""")

QUERY_RELEASE_PARTICIPANT_RESERVATIONS = text("""
    UPDATE image_reservations
    SET released_at = CURRENT_TIMESTAMP
    WHERE participant_id = :pid
      AND released_at IS NULL
      AND (:keep_image_id IS NULL OR image_public_id <> :keep_image_id)
""")

QUERY_ENSURE_IMAGE_POOL_ALLOCATION_STATE = text("""
    INSERT INTO image_pool_allocation_state (
        pool_type, batch_number, next_index, batch_size, image_order
    ) VALUES (
        :pool_type, 0, 0, 0, '[]'::jsonb
    )
    ON CONFLICT (pool_type) DO NOTHING
""")

QUERY_LOCK_IMAGE_POOL_ALLOCATION_STATE = text("""
    SELECT
        pool_type,
        batch_number,
        next_index,
        batch_size,
        image_order
    FROM image_pool_allocation_state
    WHERE pool_type = :pool_type
    FOR UPDATE
""")

QUERY_UPDATE_IMAGE_POOL_ALLOCATION_STATE = text("""
    UPDATE image_pool_allocation_state
    SET
        batch_number = :batch_number,
        next_index = :next_index,
        batch_size = :batch_size,
        image_order = CAST(:image_order AS JSONB)
    WHERE pool_type = :pool_type
""")


def serialize_image_order(image_order: list[str]) -> str:
    """Serialize image order for JSONB writes."""
    return json.dumps(list(image_order), separators=(",", ":"), ensure_ascii=True)
