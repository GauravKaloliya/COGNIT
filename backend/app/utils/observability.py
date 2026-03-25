"""
Structured observability helpers.
"""

import json
import logging
import time
import hashlib
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from app.config import (
    ENABLE_ERROR_LOGGING,
    ASYNC_EXECUTOR_WORKERS_OBSERVABILITY,
    OBS_ASYNC_MAX_ATTEMPTS,
    OBS_ASYNC_BASE_BACKOFF_MS,
)
from app.constants.observability_constants import OBS_FIELD_EVENT, OBS_FIELD_TIMESTAMP
from app.utils.log_sanitizer import sanitize_fields

_OBS_EXECUTOR = ThreadPoolExecutor(
    max_workers=ASYNC_EXECUTOR_WORKERS_OBSERVABILITY,
    thread_name_prefix="obs-events",
)


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


def log_event_async(logger: logging.Logger, event: str, level: int = logging.INFO, **fields):
    idempotency_key = str(fields.get("idempotency_key") or "").strip()
    if not idempotency_key:
        idempotency_key = hashlib.sha256(
            f"{event}|{level}|{json.dumps(sanitize_fields(fields), sort_keys=True, ensure_ascii=True)}".encode("utf-8")
        ).hexdigest()[:32]
    fields["idempotency_key"] = idempotency_key

    def _run_with_retry():
        attempts = max(1, int(OBS_ASYNC_MAX_ATTEMPTS))
        for attempt in range(1, attempts + 1):
            try:
                log_event(logger, event, level, **fields)
                return
            except Exception:
                if attempt >= attempts:
                    return
                delay_ms = int(OBS_ASYNC_BASE_BACKOFF_MS) * (2 ** max(0, attempt - 1))
                time.sleep(max(0.02, min(5000, delay_ms) / 1000.0))

    try:
        _OBS_EXECUTOR.submit(_run_with_retry)
    except Exception:
        # Fall back to inline logging if queueing fails.
        log_event(logger, event, level, **fields)
