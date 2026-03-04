import hashlib
import json
from typing import Any, Dict, Optional, Tuple

from sqlalchemy import text


def build_request_hash(payload: Dict[str, Any]) -> str:
    canonical = json.dumps(payload or {}, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def load_idempotent_response(
    db,
    *,
    endpoint: str,
    idempotency_key: str,
    participant_public_id: Optional[str],
    request_hash: str,
) -> Tuple[Optional[Dict[str, Any]], Optional[Tuple[Any, int]]]:
    if not idempotency_key:
        return None, None

    try:
        row = db.execute(text("""
            SELECT request_hash, status_code, response_body
            FROM idempotency_keys
            WHERE endpoint = :endpoint
              AND idempotency_key = :key
              AND participant_public_id IS NOT DISTINCT FROM :participant_public_id
            ORDER BY created_at DESC
            LIMIT 1
        """), {
            "endpoint": endpoint,
            "key": idempotency_key,
            "participant_public_id": participant_public_id,
        }).fetchone()
    except Exception:
        return None, None

    if not row:
        return None, None

    existing_hash, status_code, response_body = row
    if existing_hash and existing_hash != request_hash:
        return {
            "error": {
                "code": "ERR_IDEMPOTENCY_CONFLICT",
                "message": "Idempotency key reuse with a different request payload is not allowed.",
            }
        }, ({
            "success": False,
            "error": {
                "code": "ERR_IDEMPOTENCY_CONFLICT",
                "message": "Idempotency key reuse with a different request payload is not allowed.",
            }
        }, 409)

    if isinstance(response_body, str):
        try:
            response_body = json.loads(response_body)
        except Exception:
            response_body = {"status": "processed"}

    return {
        "payload": response_body,
        "status_code": int(status_code or 200),
    }, (response_body, int(status_code or 200))


def save_idempotent_response(
    db,
    *,
    endpoint: str,
    idempotency_key: str,
    participant_public_id: Optional[str],
    request_hash: str,
    response_body: Dict[str, Any],
    status_code: int = 200,
) -> None:
    if not idempotency_key:
        return

    try:
        db.execute(text("""
            INSERT INTO idempotency_keys (
                endpoint,
                idempotency_key,
                participant_public_id,
                request_hash,
                response_body,
                status_code
            ) VALUES (
                :endpoint,
                :key,
                :participant_public_id,
                :request_hash,
                CAST(:response_body AS jsonb),
                :status_code
            )
            ON CONFLICT (endpoint, idempotency_key, participant_public_id)
            DO UPDATE SET
                request_hash = EXCLUDED.request_hash,
                response_body = EXCLUDED.response_body,
                status_code = EXCLUDED.status_code,
                updated_at = CURRENT_TIMESTAMP
        """), {
            "endpoint": endpoint,
            "key": idempotency_key,
            "participant_public_id": participant_public_id,
            "request_hash": request_hash,
            "response_body": json.dumps(response_body or {}),
            "status_code": int(status_code or 200),
        })
    except Exception:
        return
