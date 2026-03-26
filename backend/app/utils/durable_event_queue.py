"""
Durable async event queue backed by Postgres.
"""

from __future__ import annotations

import json
import logging
import threading
import time
from typing import Any

from sqlalchemy import text

from app.config import (
    DURABLE_EVENT_QUEUE_BASE_BACKOFF_MS,
    DURABLE_EVENT_QUEUE_BUSY_SLEEP_MS,
    DURABLE_EVENT_QUEUE_IDLE_SLEEP_MS,
    DURABLE_EVENT_QUEUE_MAX_ATTEMPTS,
    DURABLE_EVENT_QUEUE_MAX_BACKOFF_MS,
    DURABLE_EVENT_QUEUE_MIN_BACKOFF_MS,
    DURABLE_EVENT_QUEUE_POLL_MS,
    ENABLE_DURABLE_EVENT_QUEUE,
)
from app.database import engine
from app.utils.observability import log_event

logger = logging.getLogger(__name__)

QUERY_ENQUEUE_EVENT = text("""
    INSERT INTO durable_event_queue (
        event_type,
        payload,
        status,
        attempt_count,
        max_attempts,
        next_attempt_at
    ) VALUES (
        :event_type,
        CAST(:payload AS jsonb),
        'queued',
        0,
        :max_attempts,
        CURRENT_TIMESTAMP
    )
""")

QUERY_CLAIM_EVENT = text("""
    WITH next_event AS (
        SELECT id
        FROM durable_event_queue
        WHERE status IN ('queued', 'retry')
          AND next_attempt_at <= CURRENT_TIMESTAMP
          AND attempt_count < max_attempts
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
    )
    UPDATE durable_event_queue q
    SET status = 'processing',
        attempt_count = q.attempt_count + 1,
        updated_at = CURRENT_TIMESTAMP
    FROM next_event
    WHERE q.id = next_event.id
    RETURNING q.id, q.event_type, q.payload, q.attempt_count, q.max_attempts
""")

QUERY_MARK_DONE = text("""
    UPDATE durable_event_queue
    SET status = 'done',
        processed_at = CURRENT_TIMESTAMP,
        last_error = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = :id
""")

QUERY_MARK_RETRY = text("""
    UPDATE durable_event_queue
    SET status = CASE WHEN attempt_count >= max_attempts THEN 'dead' ELSE 'retry' END,
        next_attempt_at = CURRENT_TIMESTAMP + (:delay_ms || ' milliseconds')::interval,
        last_error = :error_text,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = :id
""")

_stop_event = threading.Event()
_worker_thread: threading.Thread | None = None


def enqueue_durable_event(
    event_type: str,
    payload: dict[str, Any] | None = None,
    *,
    max_attempts: int | None = None,
    idempotency_key: str | None = None,
) -> None:
    if not ENABLE_DURABLE_EVENT_QUEUE:
        return
    event_name = str(event_type or "").strip()[:120]
    if not event_name:
        return
    safe_payload = payload if isinstance(payload, dict) else {}
    if idempotency_key:
        safe_payload["idempotency_key"] = str(idempotency_key).strip()[:128]
    try:
        with engine.begin() as conn:
            conn.execute(QUERY_ENQUEUE_EVENT, {
                "event_type": event_name,
                "payload": json.dumps(safe_payload, ensure_ascii=True),
                "max_attempts": int(max_attempts or DURABLE_EVENT_QUEUE_MAX_ATTEMPTS),
            })
    except Exception as exc:
        log_event(
            logger,
            "durable_queue_enqueue_failed",
            level=logging.WARNING,
            event_type=event_name,
            error=str(exc),
        )


def _process_event(event_type: str, payload: dict[str, Any]) -> None:
    # Keep processing side effects lightweight and deterministic.
    safe_payload = dict(payload or {})
    level = safe_payload.pop("level", logging.INFO)
    try:
        if isinstance(level, str):
            level = getattr(logging, level.strip().upper(), logging.INFO)
    except Exception:
        level = logging.INFO
    log_event(logger, event_type, level=level, **safe_payload)


def _run_worker() -> None:
    while not _stop_event.is_set():
        handled = False
        try:
            with engine.begin() as conn:
                row = conn.execute(QUERY_CLAIM_EVENT).fetchone()
                if not row:
                    row = None
            if row is None:
                time.sleep(max(DURABLE_EVENT_QUEUE_IDLE_SLEEP_MS / 1000.0, DURABLE_EVENT_QUEUE_POLL_MS / 1000.0))
                continue
            handled = True
            queue_id = int(row[0])
            event_type = str(row[1] or "")
            raw_payload = row[2]
            attempt_count = int(row[3] or 1)
            payload = raw_payload if isinstance(raw_payload, dict) else {}
            try:
                _process_event(event_type, payload)
                with engine.begin() as conn:
                    conn.execute(QUERY_MARK_DONE, {"id": queue_id})
            except Exception as exc:
                backoff_ms = min(
                    int(DURABLE_EVENT_QUEUE_MAX_BACKOFF_MS),
                    int(max(DURABLE_EVENT_QUEUE_MIN_BACKOFF_MS, DURABLE_EVENT_QUEUE_BASE_BACKOFF_MS) * (2 ** max(0, attempt_count - 1))),
                )
                with engine.begin() as conn:
                    conn.execute(QUERY_MARK_RETRY, {
                        "id": queue_id,
                        "delay_ms": backoff_ms,
                        "error_text": str(exc)[:2000],
                    })
        except Exception as exc:
            log_event(logger, "durable_queue_worker_failed", level=logging.WARNING, error=str(exc))
            time.sleep(max(DURABLE_EVENT_QUEUE_IDLE_SLEEP_MS / 1000.0, DURABLE_EVENT_QUEUE_POLL_MS / 1000.0))
            continue
        if handled:
            # Keep queue draining fast without starving request handling.
            time.sleep(max(0.001, DURABLE_EVENT_QUEUE_BUSY_SLEEP_MS / 1000.0))


def start_durable_event_worker() -> None:
    global _worker_thread
    if not ENABLE_DURABLE_EVENT_QUEUE:
        return
    if _worker_thread and _worker_thread.is_alive():
        return
    _stop_event.clear()
    _worker_thread = threading.Thread(
        target=_run_worker,
        name="durable-event-worker",
        daemon=True,
    )
    _worker_thread.start()


def stop_durable_event_worker(timeout_seconds: float = 2.0) -> None:
    _stop_event.set()
    if _worker_thread and _worker_thread.is_alive():
        _worker_thread.join(timeout=max(0.1, timeout_seconds))
