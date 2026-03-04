import json
from typing import Any, Dict, Optional

from sqlalchemy import text


def emit_domain_event(
    db,
    *,
    event_type: str,
    correlation_id: Optional[str],
    participant_id: Optional[int] = None,
    payment_id: Optional[int] = None,
    payload: Optional[Dict[str, Any]] = None,
) -> None:
    details = {
        "event_type": event_type,
        "correlation_id": correlation_id,
        "payload": payload or {},
    }

    try:
        with db.begin_nested():
            db.execute(text("""
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
            """), {
                "event_type": f"domain_{event_type}",
                "participant_id": participant_id,
                "endpoint": "domain_event",
                "http_method": "INTERNAL",
                "details": json.dumps(details)[:8000],
                "request_id": correlation_id,
            })

            if payment_id is not None:
                db.execute(text("""
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
                """), {
                    "event_type": f"domain_{event_type}",
                    "payment_id": payment_id,
                    "participant_id": participant_id,
                    "request_data": json.dumps(payload or {}),
                    "details": json.dumps(details)[:8000],
                })
    except Exception:
        return
