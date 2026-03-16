import json
from typing import Any, Dict, Optional

from app.constants.payment_constants import PAYMENT_DETECTED_APP_UNKNOWN, VERIFY_ATTEMPT_STATUS_STARTED
from app.services.payment_attempt_query_service import (
    QUERY_FINALIZE_PAYMENT_UPLOAD_ATTEMPT,
    QUERY_INSERT_PAYMENT_UPLOAD_ATTEMPT,
)


def create_payment_upload_attempt(
    db,
    *,
    payment_id: int,
    participant_id: int,
    idempotency_key: Optional[str],
    sha256: str,
    file_extension: Optional[str] = None,
    mime_type: Optional[str] = None,
    file_size: Optional[int] = None,
    image_phash: Optional[str] = None,
    status: str = VERIFY_ATTEMPT_STATUS_STARTED,
    detected_app: Optional[str] = PAYMENT_DETECTED_APP_UNKNOWN,
    details: Optional[Dict[str, Any]] = None,
) -> Optional[int]:
    try:
        row = db.execute(QUERY_INSERT_PAYMENT_UPLOAD_ATTEMPT, {
            "payment_id": payment_id,
            "participant_id": participant_id,
            "idempotency_key": idempotency_key,
            "sha256": sha256,
            "file_extension": file_extension,
            "mime_type": mime_type,
            "file_size": file_size,
            "image_phash": image_phash,
            "detected_app": detected_app or PAYMENT_DETECTED_APP_UNKNOWN,
            "fraud_score": 0.0,
            "status": status,
            "details": json.dumps(details or {}),
        }).fetchone()
        return int(row[0]) if row else None
    except Exception:
        return None


def finalize_payment_upload_attempt(
    db,
    *,
    attempt_id: Optional[int],
    status: str,
    detected_app: Optional[str] = None,
    failure_reasons=None,
    fraud_score: Optional[float] = None,
    details: Optional[Dict[str, Any]] = None,
) -> None:
    if not attempt_id:
        return

    try:
        db.execute(QUERY_FINALIZE_PAYMENT_UPLOAD_ATTEMPT, {
            "attempt_id": attempt_id,
            "status": status,
            "detected_app": detected_app or PAYMENT_DETECTED_APP_UNKNOWN,
            "failure_reasons": json.dumps(failure_reasons or []),
            "fraud_score": fraud_score,
            "details": json.dumps(details or {}),
        })
    except Exception:
        return
