import json
from typing import Any, Dict, Optional

from sqlalchemy import text


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
    status: str = "started",
    detected_app: Optional[str] = "unknown",
    details: Optional[Dict[str, Any]] = None,
) -> Optional[int]:
    try:
        row = db.execute(text("""
            INSERT INTO payment_upload_attempts (
                payment_id,
                participant_id,
                idempotency_key,
                sha256,
                file_extension,
                mime_type,
                file_size,
                image_phash,
                detected_app,
                fraud_score,
                status,
                details
            ) VALUES (
                :payment_id,
                :participant_id,
                :idempotency_key,
                :sha256,
                :file_extension,
                :mime_type,
                :file_size,
                :image_phash,
                :detected_app,
                :fraud_score,
                :status,
                CAST(:details AS jsonb)
            )
            RETURNING id
        """), {
            "payment_id": payment_id,
            "participant_id": participant_id,
            "idempotency_key": idempotency_key,
            "sha256": sha256,
            "file_extension": file_extension,
            "mime_type": mime_type,
            "file_size": file_size,
            "image_phash": image_phash,
            "detected_app": detected_app or "unknown",
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
        db.execute(text("""
            UPDATE payment_upload_attempts
            SET status = :status,
                detected_app = :detected_app,
                failure_reasons = CAST(:failure_reasons AS jsonb),
                fraud_score = COALESCE(:fraud_score, 0),
                details = COALESCE(details, '{}'::jsonb) || CAST(:details AS jsonb),
                completed_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = :attempt_id
        """), {
            "attempt_id": attempt_id,
            "status": status,
            "detected_app": detected_app or "unknown",
            "failure_reasons": json.dumps(failure_reasons or []),
            "fraud_score": fraud_score,
            "details": json.dumps(details or {}),
        })
    except Exception:
        return
