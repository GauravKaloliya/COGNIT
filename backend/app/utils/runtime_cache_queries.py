"""Shared SQL query helpers for runtime cache lookups."""

from sqlalchemy import text

QUERY_RESOLVE_PARTICIPANT_ID = text("""
    SELECT id
    FROM participants
    WHERE public_id = :pub AND is_deleted = false
""")
