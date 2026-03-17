"""Shared SQL helpers for payment verification flows."""

from __future__ import annotations

import json
from typing import Iterable

from sqlalchemy import text

from app.config import FRAUD_SUCCESS_MAX_SCORE
from app.constants.payment_constants import (
    PAYMENT_DETECTED_APP_UNKNOWN,
    PAYMENT_STATUS_EXPIRED,
    PAYMENT_STATUS_FAILED,
    PAYMENT_STATUS_REJECTED_FRAUD,
    PAYMENT_STATUS_SUCCESS,
)

QUERY_FETCH_PAYMENT_FOR_VERIFY = text("""
    SELECT id, participant_id, status, expires_at, timer_activated_at, verification_attempts, amount
    FROM payments
    WHERE public_id = :pid
    FOR UPDATE
""")

QUERY_FETCH_PAYMENT_OWNER = text("""
    SELECT participant_id
    FROM payments
    WHERE id = :pid
""")

QUERY_FETCH_PAYMENT_FOR_INTERNAL_VERIFY = text("""
    SELECT p.id, p.participant_id, p.amount, p.status, f.object_key, f.sha256
    FROM payments p
    JOIN payment_files f ON f.payment_id = p.id
    WHERE p.public_id = :pid
    FOR UPDATE
""")

QUERY_INCREMENT_VERIFICATION_ATTEMPTS = text("""
    UPDATE payments
    SET verification_attempts = COALESCE(verification_attempts, 0) + 1,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = :pid
""")

QUERY_SET_PAYMENT_STATUS = text("""
    UPDATE payments
    SET status = :status, updated_at = CURRENT_TIMESTAMP
    WHERE id = :pid
""")

QUERY_SET_PAYMENT_STATUS_IF_CURRENT = text("""
    UPDATE payments
    SET status = :status, updated_at = CURRENT_TIMESTAMP
    WHERE id = :pid AND status = :current_status
""")

QUERY_APPEND_VERIFICATION_DETAILS = text("""
    UPDATE payments
    SET verification_details = COALESCE(verification_details, '{}'::jsonb) || CAST(:details AS jsonb),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = :pid
""")

QUERY_INSERT_PAYMENT_FILE = text("""
    INSERT INTO payment_files (
        payment_id, bucket_name, object_key, sha256, etag, file_size,
        content_type, uploaded_by_ip_hash, image_phash, image_phash_bits, image_phash_bucket, image_quality_score
    ) VALUES (
        :pid, :bucket_name, :key, :hash, :etag, :file_size,
        :content_type, :uploaded_by_ip_hash, :phash, CAST(:phash_bits AS bit(64)), :phash_bucket, :image_quality_score
    )
""")

QUERY_UPSERT_FRAUD_SIGNALS = text("""
    INSERT INTO payment_fraud_signals (
        payment_id, signal_type, signal_score, details
    ) VALUES (
        :pid, :type, :score, :details
    ) ON CONFLICT DO NOTHING
""")

QUERY_SET_PAYMENT_VERIFICATION_OUTCOME = text("""
    UPDATE payments
    SET extracted_text = :txt,
        uploaded_sha256 = :uploaded_sha256,
        fraud_score = :fs,
        verified_at = CURRENT_TIMESTAMP,
        status = :status,
        detected_app = :app,
        verification_details = :details,
        auto_rejected = :auto_rejected,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = :pid
""")


def fetch_payment_for_verify(db, payment_public_id: str):
    return db.execute(QUERY_FETCH_PAYMENT_FOR_VERIFY, {"pid": payment_public_id}).fetchone()


def fetch_payment_owner_participant_id(db, payment_id: int):
    return db.execute(QUERY_FETCH_PAYMENT_OWNER, {"pid": int(payment_id)}).scalar()


def fetch_payment_for_internal_verify(db, payment_public_id: str):
    return db.execute(QUERY_FETCH_PAYMENT_FOR_INTERNAL_VERIFY, {"pid": payment_public_id}).fetchone()


def increment_verification_attempts(db, payment_id: int):
    db.execute(QUERY_INCREMENT_VERIFICATION_ATTEMPTS, {"pid": int(payment_id)})


def set_payment_status(db, *, payment_id: int, status: str, current_status: str | None = None):
    params = {"pid": int(payment_id), "status": str(status)}
    if current_status is None:
        db.execute(QUERY_SET_PAYMENT_STATUS, params)
    else:
        params["current_status"] = str(current_status)
        db.execute(QUERY_SET_PAYMENT_STATUS_IF_CURRENT, params)


def append_payment_verification_details(db, *, payment_id: int, details: dict):
    db.execute(QUERY_APPEND_VERIFICATION_DETAILS, {
        "pid": int(payment_id),
        "details": json.dumps(details or {}),
    })


def insert_payment_file_record(
    db,
    *,
    payment_id: int,
    bucket_name: str,
    object_key: str,
    sha256_hash: str,
    etag: str | None,
    file_size: int,
    content_type: str | None,
    uploaded_by_ip_hash: str | None,
    image_phash: str | None,
    image_phash_bits,
    image_phash_bucket,
    image_quality_score,
):
    db.execute(QUERY_INSERT_PAYMENT_FILE, {
        "pid": int(payment_id),
        "bucket_name": bucket_name,
        "key": object_key,
        "hash": sha256_hash,
        "etag": etag,
        "file_size": int(file_size),
        "content_type": content_type,
        "uploaded_by_ip_hash": uploaded_by_ip_hash,
        "phash": image_phash,
        "phash_bits": image_phash_bits,
        "phash_bucket": image_phash_bucket,
        "image_quality_score": image_quality_score,
    })


def insert_payment_fraud_signals(db, *, payment_id: int, failures: Iterable[str], score: float, confidence=None):
    rows = [
        {
            "pid": int(payment_id),
            "type": failure,
            "score": float(score),
            "details": json.dumps({"reason": failure, **({"confidence": confidence} if confidence is not None else {})}),
        }
        for failure in (failures or [])
    ]
    if rows:
        db.execute(QUERY_UPSERT_FRAUD_SIGNALS, rows)


def set_payment_ocr_unavailable(
    db,
    *,
    payment_id: int,
    sha256_hash: str | None,
    fraud_score: float,
    verification_details: dict,
):
    db.execute(QUERY_SET_PAYMENT_VERIFICATION_OUTCOME, {
        "pid": int(payment_id),
        "txt": "",
        "uploaded_sha256": sha256_hash,
        "fs": float(fraud_score),
        "status": PAYMENT_STATUS_REJECTED_FRAUD,
        "app": PAYMENT_DETECTED_APP_UNKNOWN,
        "details": json.dumps(verification_details),
        "auto_rejected": True,
    })


def set_payment_verification_outcome(
    db,
    *,
    payment_id: int,
    filtered_text: str,
    sha256_hash: str | None,
    fraud_score: float,
    target_status: str,
    detected_app: str | None,
    verification_details: dict,
    auto_rejected: bool,
):
    normalized_detected_app = detected_app or PAYMENT_DETECTED_APP_UNKNOWN
    if target_status == PAYMENT_STATUS_SUCCESS:
        normalized_score = min(float(FRAUD_SUCCESS_MAX_SCORE), float(fraud_score))
        auto_rejected = False
    elif target_status in (PAYMENT_STATUS_REJECTED_FRAUD, PAYMENT_STATUS_FAILED, PAYMENT_STATUS_EXPIRED):
        normalized_score = float(fraud_score)
    else:
        normalized_score = float(fraud_score)

    db.execute(QUERY_SET_PAYMENT_VERIFICATION_OUTCOME, {
        "pid": int(payment_id),
        "txt": filtered_text,
        "uploaded_sha256": sha256_hash,
        "fs": normalized_score,
        "status": target_status,
        "app": normalized_detected_app,
        "details": json.dumps(verification_details),
        "auto_rejected": bool(auto_rejected),
    })
    return normalized_score
