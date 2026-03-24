"""Shared SQL query helpers for domain event persistence."""

from sqlalchemy import text

QUERY_INSERT_DOMAIN_AUDIT_LOG = text("""
    INSERT INTO audit_log (
        event_type,
        participant_id,
        endpoint,
        http_method,
        details,
        request_id
    ) VALUES (
        :event_type,
        :participant_id,
        :endpoint,
        :http_method,
        :details,
        :request_id
    )
""")
