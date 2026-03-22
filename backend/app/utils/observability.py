"""
Structured observability helpers.
"""

import json
import logging
from datetime import datetime, timezone

from app.config import ENABLE_ERROR_LOGGING
from app.constants.observability_constants import OBS_FIELD_EVENT, OBS_FIELD_TIMESTAMP
from app.utils.log_sanitizer import sanitize_fields


def log_event(logger: logging.Logger, event: str, level: int = logging.INFO, **fields):
    if level >= logging.ERROR and not ENABLE_ERROR_LOGGING:
        return
    payload = {
        OBS_FIELD_TIMESTAMP: datetime.now(timezone.utc).isoformat(),
        OBS_FIELD_EVENT: event,
    }
    if fields:
        payload.update(sanitize_fields(fields))
    logger.log(level, json.dumps(payload, ensure_ascii=True, separators=(",", ":")))
