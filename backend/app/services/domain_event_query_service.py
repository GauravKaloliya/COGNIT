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

QUERY_INSERT_DOMAIN_PAYMENT_AUDIT_LOG = text("""
    INSERT INTO payment_audit_log (
        event_type,
        payment_id,
        participant_id,
        request_data,
        details
    ) VALUES (
        :event_type,
        :payment_id,
        :participant_id,
        CAST(:request_data AS jsonb),
        :details
    )
""")
