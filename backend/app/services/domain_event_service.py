import json
from typing import Any, Dict, Optional

from app.constants.response_keys import (
    RESPONSE_KEY_DETAILS,
    RESPONSE_KEY_EVENT_TYPE,
    RESPONSE_KEY_PARTICIPANT_ID,
    RESPONSE_KEY_PAYMENT_ID,
)
from app.services.domain_event_query_service import (
    QUERY_INSERT_DOMAIN_AUDIT_LOG,
    QUERY_INSERT_DOMAIN_PAYMENT_AUDIT_LOG,
)
from app.constants.event_constants import HTTP_METHOD_INTERNAL
from app.constants.route_constants import DOMAIN_EVENT_ENDPOINT


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
        RESPONSE_KEY_EVENT_TYPE: event_type,
        "correlation_id": correlation_id,
        "payload": payload or {},
    }

    try:
        with db.begin_nested():
            db.execute(QUERY_INSERT_DOMAIN_AUDIT_LOG, {
                RESPONSE_KEY_EVENT_TYPE: f"domain_{event_type}",
                RESPONSE_KEY_PARTICIPANT_ID: participant_id,
                "endpoint": DOMAIN_EVENT_ENDPOINT,
                "http_method": HTTP_METHOD_INTERNAL,
                RESPONSE_KEY_DETAILS: json.dumps(details)[:8000],
                "request_id": correlation_id,
            })

            if payment_id is not None:
                db.execute(QUERY_INSERT_DOMAIN_PAYMENT_AUDIT_LOG, {
                    RESPONSE_KEY_EVENT_TYPE: f"domain_{event_type}",
                    RESPONSE_KEY_PAYMENT_ID: payment_id,
                    RESPONSE_KEY_PARTICIPANT_ID: participant_id,
                    "request_data": json.dumps(payload or {}),
                    RESPONSE_KEY_DETAILS: json.dumps(details)[:8000],
                })
    except Exception:
        return
