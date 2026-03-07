"""
Structured observability helpers.
"""

import json
import logging
from datetime import datetime, timezone


def log_event(logger: logging.Logger, event: str, level: int = logging.INFO, **fields):
    payload = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "event": event,
    }
    for key, value in fields.items():
        if value is None:
            continue
        payload[key] = value
    logger.log(level, json.dumps(payload, ensure_ascii=True, separators=(",", ":")))
