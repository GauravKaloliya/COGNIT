"""Support helpers for payment verification scoring and OCR fallback handling."""

from __future__ import annotations

from app.constants.audit_details import AUDIT_DETAIL_PAYMENT_AUTO_REJECTED_MISSING_OCR
from app.constants.event_constants import AUDIT_EVENT_PAYMENT_OCR_UNAVAILABLE
from app.constants.payment_constants import FRAUD_REASON_OCR_UNAVAILABLE
from app.constants.payment_constants import (
    VERIFY_DETAIL_KEY_EXTRACTED_TEXT_LENGTH,
    VERIFY_DETAIL_KEY_FAILURE_REASONS,
    VERIFY_DETAIL_KEY_OCR_CONFIDENCE,
    VERIFY_DETAIL_KEY_UPLOADED_SHA256,
)
from app.utils.helpers import log_audit


def calculate_fraud_score(*, failures, confidence, fraud_score_weights, unknown_reason_weight, max_fraud_score, log_confidence_parse_error) -> float:
    if not failures:
        return 0.0

    unique_failures = set(failures or [])
    score = sum(float(fraud_score_weights.get(failure, unknown_reason_weight)) for failure in unique_failures)
    if len(unique_failures) >= 3:
        score += 10.0

    if confidence is not None:
        try:
            parsed_confidence = float(confidence)
            if parsed_confidence < 50:
                score += 10.0
            elif parsed_confidence < 70:
                score += 5.0
        except Exception:
            log_confidence_parse_error()

    capped = min(float(max_fraud_score), float(score))
    return min(100.0, max(0.0, capped))


def is_ocr_unavailable(error: Exception) -> bool:
    error_name = type(error).__name__
    error_text = str(error).lower()
    return (
        error_name in {"OCRServiceUnavailableError", "TesseractNotFoundError", "OCRServiceError"}
        or "ocr unavailable" in error_text
        or "textract client" in error_text
        or "textract api error" in error_text
        or "aws credentials" in error_text
        or "rate limited" in error_text
        or "connection error" in error_text
    )


def reject_for_ocr_unavailable(
    *,
    db,
    payment_id: int,
    participant_id: int,
    sha256_hash: str | None,
    calculate_score,
    set_payment_ocr_unavailable,
    record_upi_result,
    insert_payment_fraud_signals,
):
    failures = [FRAUD_REASON_OCR_UNAVAILABLE]
    verification_details = {
        VERIFY_DETAIL_KEY_OCR_CONFIDENCE: 0,
        VERIFY_DETAIL_KEY_FAILURE_REASONS: failures,
        VERIFY_DETAIL_KEY_EXTRACTED_TEXT_LENGTH: 0,
    }
    if sha256_hash:
        verification_details[VERIFY_DETAIL_KEY_UPLOADED_SHA256] = sha256_hash

    fraud_score = calculate_score(failures=failures, confidence=0)
    set_payment_ocr_unavailable(
        db,
        payment_id=payment_id,
        sha256_hash=sha256_hash,
        fraud_score=fraud_score,
        verification_details=verification_details,
    )
    record_upi_result(db, payment_id=payment_id, result_status="FAILURE")
    insert_payment_fraud_signals(db, payment_id=payment_id, failures=failures, score=100)
    log_audit(
        db,
        AUDIT_EVENT_PAYMENT_OCR_UNAVAILABLE,
        participant_id=participant_id,
        details=AUDIT_DETAIL_PAYMENT_AUTO_REJECTED_MISSING_OCR.format(payment_id=payment_id),
    )
    db.commit()
    return verification_details, failures
