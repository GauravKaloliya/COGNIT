import base64
import hashlib
import json
import re
from datetime import datetime, timezone
from io import BytesIO
from typing import Callable, Optional

from PIL import Image
from flask import jsonify
from sqlalchemy import text

from app.config import (
    S3_BUCKET_NAME,
    UPI_NAME,
    PAYMENT_MAX_IMAGE_MB,
    PAYMENT_AMOUNT,
    FRAUD_SCORE_WEIGHTS,
    FRAUD_UNKNOWN_REASON_WEIGHT,
    FRAUD_REJECT_THRESHOLD,
    FRAUD_SUCCESS_MAX_SCORE,
    PAYMENT_VERIFY_MAX_ATTEMPTS,
)
from app.constants.payment_constants import (
    FRAUD_REASON_DUPLICATE_HASH_OTHER,
    FRAUD_REASON_DUPLICATE_HASH_SELF,
    FRAUD_REASON_MAX_ATTEMPTS_EXCEEDED,
    FRAUD_REASON_NEAR_DUPLICATE_OTHER,
    FRAUD_REASON_NEAR_DUPLICATE_SELF,
    FRAUD_REASON_OCR_SIGNATURE_REPLAY_OTHER,
    FRAUD_REASON_OCR_SIGNATURE_REPLAY_SELF,
    FRAUD_REASON_OCR_UNAVAILABLE,
    FRAUD_REASON_POLICY_RISK_THRESHOLD,
    FRAUD_REASON_REJECTED_REUSE,
    FRAUD_REASON_VERIFICATION_FAILED,
    PAYMENT_DETECTED_APP_UNKNOWN,
    PAYMENT_FILE_FINAL_PREFIX,
    PAYMENT_FILE_STAGE_PREFIX,
    PAYMENT_STATUS_EXPIRED,
    PAYMENT_STATUS_FAILED,
    PAYMENT_STATUS_PENDING,
    PAYMENT_STATUS_PROCESSING,
    PAYMENT_STATUS_REJECTED_FRAUD,
    PAYMENT_STATUS_SUCCESS,
    UPLOAD_SOURCE_FIELD_IMAGE_BASE64,
    UPLOAD_SOURCE_FIELD_OBJECT_KEY,
    VERIFY_ATTEMPT_STATUS_DUPLICATE,
    VERIFY_ATTEMPT_STATUS_ERROR,
    VERIFY_ATTEMPT_STATUS_EXPIRED,
    VERIFY_ATTEMPT_STATUS_INVALID_STATE,
    VERIFY_ATTEMPT_STATUS_REJECTED,
    VERIFY_ATTEMPT_STATUS_STARTED,
    VERIFY_ATTEMPT_STATUS_SUCCESS,
    VERIFY_DETAIL_KEY_DECISION_THRESHOLD,
    VERIFY_DETAIL_KEY_DISTANCE,
    VERIFY_DETAIL_KEY_EXTRACTED_TEXT_LENGTH,
    VERIFY_DETAIL_KEY_FAILURE_REASONS,
    VERIFY_DETAIL_KEY_MAX_ATTEMPTS,
    VERIFY_DETAIL_KEY_OCR_CONFIDENCE,
    VERIFY_DETAIL_KEY_OCR_SIGNATURE,
    VERIFY_DETAIL_KEY_RISK_SCORE,
    VERIFY_DETAIL_KEY_UPLOADED_SHA256,
    PAYMENT_VERIFICATION_ERROR,
)
from app.extensions import s3
from app.utils.helpers import create_error_response, validate_image_extension, log_audit, get_ip_hash
from app.utils.ocr import (
    fetch_s3_image,
    extract_text_with_confidence,
    verify_payment_screenshot,
    sanitize_extracted_text_for_storage,
    compute_ocr_signature,
    OCRServiceUnavailableError,
    TesseractNotFoundError,
    OCRServiceError,
)
from app.utils.fraud import (
    check_duplicate_screenshot,
    check_rejected_screenshot,
    check_near_duplicate_screenshot,
    check_ocr_signature_replay,
    compute_dhash,
    phash_hex_to_bits_and_bucket,
    is_same_person_by_fingerprint,
)
from app.services import (
    build_request_hash,
    load_idempotent_response,
    save_idempotent_response,
    create_payment_upload_attempt,
    finalize_payment_upload_attempt,
    ensure_payment_status_transition,
    transition_payment_status,
    StateTransitionError,
    emit_domain_event,
)
from app.services.payment_query_service import (
    append_payment_verification_details,
    fetch_payment_for_internal_verify,
    fetch_payment_for_verify,
    fetch_payment_owner_participant_id,
    increment_verification_attempts,
    insert_payment_file_record,
    insert_payment_fraud_signals,
    set_payment_ocr_unavailable,
    set_payment_status,
    set_payment_verification_outcome,
)


def _calculate_fraud_score(failures, confidence=None) -> float:
    if not failures:
        return 0.0

    unique_failures = set(failures or [])
    score = sum(float(FRAUD_SCORE_WEIGHTS.get(f, FRAUD_UNKNOWN_REASON_WEIGHT)) for f in unique_failures)

    if len(unique_failures) >= 3:
        score += 10.0

    if confidence is not None:
        try:
            conf = float(confidence)
            if conf < 50:
                score += 10.0
            elif conf < 70:
                score += 5.0
        except Exception:
            pass

    return min(100.0, max(0.0, score))


def _is_ocr_unavailable(error: Exception) -> bool:
    return (
        isinstance(error, (OCRServiceUnavailableError, TesseractNotFoundError, OCRServiceError))
        or "OCRServiceUnavailableError" in type(error).__name__
        or "TesseractNotFoundError" in type(error).__name__
        or "OCRServiceError" in type(error).__name__
        or "ocr unavailable" in str(error).lower()
        or "textract client" in str(error).lower()
        or "textract api error" in str(error).lower()
        or "aws credentials" in str(error).lower()
        or "rate limited" in str(error).lower()
        or "connection error" in str(error).lower()
    )


def _reject_for_ocr_unavailable(db, payment_id: int, participant_id: int, sha256_hash: str = None):
    failures = [FRAUD_REASON_OCR_UNAVAILABLE]
    verification_details = {
        VERIFY_DETAIL_KEY_OCR_CONFIDENCE: 0,
        VERIFY_DETAIL_KEY_FAILURE_REASONS: failures,
        VERIFY_DETAIL_KEY_EXTRACTED_TEXT_LENGTH: 0,
    }
    if sha256_hash:
        verification_details[VERIFY_DETAIL_KEY_UPLOADED_SHA256] = sha256_hash

    fraud_score = _calculate_fraud_score(failures, confidence=0)
    set_payment_ocr_unavailable(
        db,
        payment_id=payment_id,
        sha256_hash=sha256_hash,
        fraud_score=fraud_score,
        verification_details=verification_details,
    )
    insert_payment_fraud_signals(db, payment_id=payment_id, failures=failures, score=100)

    log_audit(
        db,
        "payment_ocr_unavailable",
        participant_id=participant_id,
        details=f"Payment {payment_id} auto-rejected due to missing OCR",
    )
    db.commit()
    return verification_details, failures


def process_verify_upload(
    *,
    db,
    payment_public_id: str,
    data: dict,
    request_id: Optional[str],
    device_fingerprint: Optional[str],
    device_fingerprint_variants: Optional[list[str]] = None,
    idempotency_key_header: Optional[str],
    user_agent: str,
    ip_hash: Optional[str],
    payment_audit_logger: Optional[Callable] = None,
):
    image_base64 = data.get("image_base64")
    upload_object_key = (data.get("upload_object_key") or "").strip()
    file_extension = (data.get("file_extension", "jpg") or "jpg").lower().strip(".")
    sha256_hash = (data.get("sha256") or "").strip().lower()
    mime_type = (data.get("mime_type") or "").strip()[:120]
    original_filename = (data.get("original_filename") or "").strip()[:255]
    client_file_size = data.get("file_size")
    idempotency_key = (idempotency_key_header or data.get("idempotency_key") or "").strip()[:128]

    if not image_base64 and not upload_object_key:
        return create_error_response("MISSING_FIELDS", {"fields": ["upload_object_key"]})
    if not sha256_hash:
        return create_error_response("MISSING_FIELDS", {"fields": ["sha256"]})
    if not re.match(r"^[a-f0-9]{64}$", sha256_hash):
        return create_error_response("INVALID_SHA256")

    is_valid_ext, ext, content_type = validate_image_extension(f"file.{file_extension}")
    if not is_valid_ext:
        return create_error_response("INVALID_IMAGE_TYPE", {"allowed": ["jpg", "jpeg", "png", "webp"]})

    request_hash = build_request_hash({
        "payment_public_id": payment_public_id,
        "sha256": sha256_hash,
        "file_extension": ext,
        "mime_type": mime_type,
        "file_size": client_file_size,
        "upload_object_key": upload_object_key or None,
    })
    _idem, replay = load_idempotent_response(
        db,
        endpoint=f"/payments/{payment_public_id}/verify-upload",
        idempotency_key=idempotency_key,
        participant_public_id=payment_public_id,
        request_hash=request_hash,
    )
    if replay:
        payload, status_code = replay
        return jsonify(payload), status_code

    row = fetch_payment_for_verify(db, payment_public_id)
    if not row:
        return create_error_response("PAYMENT_NOT_FOUND")

    if len(row) >= 7:
        payment_id, participant_id, status, expires_at, timer_activated_at, verification_attempts, amount = row
    else:
        payment_id, participant_id, status, expires_at, timer_activated_at, verification_attempts = row
        amount = None

    try:
        if upload_object_key:
            expected_prefix = f"{PAYMENT_FILE_STAGE_PREFIX}/{payment_public_id}/"
            if not upload_object_key.startswith(expected_prefix):
                return create_error_response("VAL_INVALID_FORMAT", {"field": UPLOAD_SOURCE_FIELD_OBJECT_KEY})
            obj = s3.get_object(Bucket=S3_BUCKET_NAME, Key=upload_object_key)
            image_bytes = obj["Body"].read()
        else:
            if "," in image_base64:
                image_base64 = image_base64.split(",")[1]
            image_bytes = base64.b64decode(image_base64)

        max_bytes = max(1, int(PAYMENT_MAX_IMAGE_MB)) * 1024 * 1024
        if len(image_bytes) > max_bytes:
            return create_error_response(
                "VAL_FILE_TOO_LARGE",
                details={"max_mb": int(PAYMENT_MAX_IMAGE_MB), "reason": "payment_image_too_large"},
                custom_message=f"The file is too large. Please upload an image smaller than {int(PAYMENT_MAX_IMAGE_MB)}MB."
            )
        actual_sha = hashlib.sha256(image_bytes).hexdigest()
        if actual_sha != sha256_hash:
            return create_error_response("PAY_INVALID_SHA256")

        image = Image.open(BytesIO(image_bytes))
    except Exception:
        source_field = UPLOAD_SOURCE_FIELD_OBJECT_KEY if upload_object_key else UPLOAD_SOURCE_FIELD_IMAGE_BASE64
        return create_error_response("INVALID_FORMAT", {"field": source_field, "message": "Invalid image data"})

    try:
        image_hash = compute_dhash(image) or sha256_hash
    except Exception:
        image_hash = sha256_hash
    image_hash_bits, image_hash_bucket = phash_hex_to_bits_and_bucket(image_hash)

    upload_attempt_id = create_payment_upload_attempt(
        db,
        payment_id=payment_id,
        participant_id=participant_id,
        idempotency_key=idempotency_key,
        sha256=sha256_hash,
        file_extension=ext,
        mime_type=mime_type or content_type,
        file_size=int(client_file_size) if isinstance(client_file_size, int) or (isinstance(client_file_size, str) and str(client_file_size).isdigit()) else None,
        image_phash=image_hash,
        status=VERIFY_ATTEMPT_STATUS_STARTED,
        details={
            "original_filename": original_filename or None,
            UPLOAD_SOURCE_FIELD_OBJECT_KEY: upload_object_key or None,
        },
    )

    def _finalize_attempt(status_name: str, detected_app=None, failures=None, fraud_score=None, details=None):
        finalize_payment_upload_attempt(
            db,
            attempt_id=upload_attempt_id,
            status=status_name,
            detected_app=detected_app,
            failure_reasons=failures or [],
            fraud_score=fraud_score,
            details=details or {},
        )

    def _reject_payment_for_fraud(failures, confidence=None, details=None):
        score = _calculate_fraud_score(failures or [], confidence=confidence)
        verification_details = {
            VERIFY_DETAIL_KEY_FAILURE_REASONS: failures or [],
            VERIFY_DETAIL_KEY_UPLOADED_SHA256: sha256_hash,
        }
        if details:
            verification_details.update(details)

        set_payment_verification_outcome(
            db,
            payment_id=payment_id,
            filtered_text="",
            sha256_hash=sha256_hash,
            fraud_score=score,
            target_status=PAYMENT_STATUS_REJECTED_FRAUD,
            detected_app=PAYMENT_DETECTED_APP_UNKNOWN,
            verification_details=verification_details,
            auto_rejected=True,
        )
        insert_payment_fraud_signals(db, payment_id=payment_id, failures=failures or [], score=score)
        return score

    if payment_audit_logger:
        payment_audit_logger(
            db,
            "payment_verify_upload_started",
            payment_id=payment_id,
            participant_id=participant_id,
            details="verify-upload called",
            request_data={
                "payment_public_id": payment_public_id,
                "file_extension": ext,
                "sha256_prefix": sha256_hash[:16],
                "mime_type": mime_type or None,
                "original_filename": original_filename or None,
                "client_file_size": client_file_size,
                "upload_object_key": upload_object_key or None,
            },
        )

    if expires_at and datetime.now(timezone.utc) > expires_at:
        try:
            transition_payment_status(
                db,
                payment_id=int(payment_id),
                from_status=str(status),
                to_status=PAYMENT_STATUS_EXPIRED,
                request_id=request_id,
                details={"reason": "session_expired_before_verify"},
            )
        except StateTransitionError:
            return create_error_response("PAYMENT_INVALID_STATE")
        _finalize_attempt(VERIFY_ATTEMPT_STATUS_EXPIRED)
        db.commit()
        return create_error_response("PAYMENT_EXPIRED")

    if status != PAYMENT_STATUS_PENDING:
        if payment_audit_logger:
            payment_audit_logger(
                db,
                "payment_verify_upload_invalid_state",
                payment_id=payment_id,
                participant_id=participant_id,
                details=f"invalid status {status}",
                response_data={"status": status},
            )
        _finalize_attempt(VERIFY_ATTEMPT_STATUS_INVALID_STATE, details={"current_payment_status": status})
        return create_error_response("PAYMENT_INVALID_STATE")

    if int(verification_attempts or 0) >= int(PAYMENT_VERIFY_MAX_ATTEMPTS):
        try:
            transition_payment_status(
                db,
                payment_id=int(payment_id),
                from_status=str(status),
                to_status=PAYMENT_STATUS_FAILED,
                request_id=request_id,
                details={"reason": "max_verify_attempts_exceeded"},
            )
        except StateTransitionError:
            return create_error_response("PAYMENT_INVALID_STATE")
        append_payment_verification_details(
            db,
            payment_id=payment_id,
            details={
                VERIFY_DETAIL_KEY_FAILURE_REASONS: [FRAUD_REASON_MAX_ATTEMPTS_EXCEEDED],
                VERIFY_DETAIL_KEY_MAX_ATTEMPTS: int(PAYMENT_VERIFY_MAX_ATTEMPTS),
            },
        )
        _finalize_attempt(
            VERIFY_ATTEMPT_STATUS_INVALID_STATE,
            failures=[FRAUD_REASON_MAX_ATTEMPTS_EXCEEDED],
            details={VERIFY_DETAIL_KEY_MAX_ATTEMPTS: int(PAYMENT_VERIFY_MAX_ATTEMPTS)},
        )
        db.commit()
        return create_error_response("PAY_VERIFY_ATTEMPTS_EXCEEDED")

    increment_verification_attempts(db, payment_id)

    is_duplicate, existing_payment_id, is_same_participant = check_duplicate_screenshot(
        db, sha256_hash, participant_id=participant_id
    )
    if is_duplicate:
        existing_owner_participant_id = fetch_payment_owner_participant_id(db, existing_payment_id)
        same_person_fingerprint = is_same_person_by_fingerprint(
            db,
            participant_id=participant_id,
            other_participant_id=existing_owner_participant_id,
            current_fingerprint=device_fingerprint,
            current_fingerprint_variants=device_fingerprint_variants,
        )
        if is_same_participant or same_person_fingerprint:
            fraud_score = _reject_payment_for_fraud([FRAUD_REASON_DUPLICATE_HASH_SELF])
            _finalize_attempt(
                VERIFY_ATTEMPT_STATUS_DUPLICATE,
                detected_app=PAYMENT_DETECTED_APP_UNKNOWN,
                failures=[FRAUD_REASON_DUPLICATE_HASH_SELF],
                fraud_score=fraud_score,
            )
            db.commit()
            return create_error_response("DUPLICATE_IMAGE_SELF")

        if payment_audit_logger:
            payment_audit_logger(
                db,
                "payment_verify_duplicate_other_user",
                payment_id=payment_id,
                participant_id=participant_id,
                details=f"duplicate hash matched payment {existing_payment_id}",
                fraud_signals={"duplicate_hash": True},
            )
        fraud_score = _reject_payment_for_fraud([FRAUD_REASON_DUPLICATE_HASH_OTHER])
        _finalize_attempt(
            VERIFY_ATTEMPT_STATUS_DUPLICATE,
            detected_app=PAYMENT_DETECTED_APP_UNKNOWN,
            failures=[FRAUD_REASON_DUPLICATE_HASH_OTHER],
            fraud_score=fraud_score,
        )
        db.commit()
        return create_error_response("DUPLICATE_IMAGE")

    if check_rejected_screenshot(db, sha256_hash):
        if payment_audit_logger:
            payment_audit_logger(
                db,
                "payment_verify_rejected_reuse",
                payment_id=payment_id,
                participant_id=participant_id,
                details="attempted reuse of previously rejected screenshot",
                fraud_signals={"rejected_reuse": True},
            )
        fraud_score = _reject_payment_for_fraud([FRAUD_REASON_REJECTED_REUSE])
        _finalize_attempt(
            VERIFY_ATTEMPT_STATUS_REJECTED,
            detected_app=PAYMENT_DETECTED_APP_UNKNOWN,
            failures=[FRAUD_REASON_REJECTED_REUSE],
            fraud_score=fraud_score,
        )
        db.commit()
        return create_error_response("REJECTED_REUSE")

    try:
        is_near_duplicate, near_payment_id, near_distance, near_same_participant = check_near_duplicate_screenshot(
            db,
            image_hash,
            participant_id=participant_id,
            threshold=6,
        )
        if is_near_duplicate:
            near_owner_participant_id = fetch_payment_owner_participant_id(db, near_payment_id)
            near_same_person_fingerprint = is_same_person_by_fingerprint(
                db,
                participant_id=participant_id,
                other_participant_id=near_owner_participant_id,
                current_fingerprint=device_fingerprint,
                current_fingerprint_variants=device_fingerprint_variants,
            )
            if near_same_participant or near_same_person_fingerprint:
                fraud_score = _reject_payment_for_fraud(
                    [FRAUD_REASON_NEAR_DUPLICATE_SELF],
                    details={VERIFY_DETAIL_KEY_DISTANCE: near_distance},
                )
                _finalize_attempt(
                    VERIFY_ATTEMPT_STATUS_DUPLICATE,
                    detected_app=PAYMENT_DETECTED_APP_UNKNOWN,
                    failures=[FRAUD_REASON_NEAR_DUPLICATE_SELF],
                    fraud_score=fraud_score,
                    details={VERIFY_DETAIL_KEY_DISTANCE: near_distance},
                )
                db.commit()
                return create_error_response("DUPLICATE_IMAGE_SELF")

            if payment_audit_logger:
                payment_audit_logger(
                    db,
                    "payment_verify_near_duplicate_other_user",
                    payment_id=payment_id,
                    participant_id=participant_id,
                    details=f"near duplicate matched payment {near_payment_id} with distance {near_distance}",
                    fraud_signals={"near_duplicate": True, "distance": near_distance},
            )
            fraud_score = _reject_payment_for_fraud(
                [FRAUD_REASON_NEAR_DUPLICATE_OTHER],
                details={VERIFY_DETAIL_KEY_DISTANCE: near_distance},
            )
            _finalize_attempt(
                VERIFY_ATTEMPT_STATUS_DUPLICATE,
                detected_app=PAYMENT_DETECTED_APP_UNKNOWN,
                failures=[FRAUD_REASON_NEAR_DUPLICATE_OTHER],
                fraud_score=fraud_score,
                details={VERIFY_DETAIL_KEY_DISTANCE: near_distance},
            )
            db.commit()
            return create_error_response("DUPLICATE_IMAGE")
    except Exception:
        image_hash = sha256_hash

    verification_result = {"status": PAYMENT_STATUS_PROCESSING, "verified": False}

    try:
        try:
            ensure_payment_status_transition(status, PAYMENT_STATUS_PROCESSING)
        except StateTransitionError:
            return create_error_response("PAYMENT_INVALID_STATE")

        set_payment_status(db, payment_id=payment_id, status=PAYMENT_STATUS_PROCESSING)

        extracted_text, confidence = extract_text_with_confidence(image)
        amount = amount if amount is not None else PAYMENT_AMOUNT
        is_valid, detected_app, failures = verify_payment_screenshot(
            image,
            extracted_text,
            amount,
            confidence,
            UPI_NAME,
            time_window_start_utc=timer_activated_at,
            time_window_end_utc=expires_at,
        )
        detected_app = detected_app or PAYMENT_DETECTED_APP_UNKNOWN
        filtered_text = sanitize_extracted_text_for_storage(extracted_text, detected_app)
        ocr_signature = compute_ocr_signature(extracted_text, detected_app)
        if ocr_signature:
            is_replay, replay_payment_id, replay_same_participant = check_ocr_signature_replay(
                db,
                ocr_signature,
                sha256_hash,
                participant_id=participant_id,
            )
            if is_replay:
                replay_reason = FRAUD_REASON_OCR_SIGNATURE_REPLAY_SELF if replay_same_participant else FRAUD_REASON_OCR_SIGNATURE_REPLAY_OTHER
                failures = list(set((failures or []) + [replay_reason]))
                is_valid = False

        risk_score = _calculate_fraud_score(failures, confidence=confidence)
        force_policy_reject = bool(is_valid and risk_score >= float(FRAUD_REJECT_THRESHOLD))
        if force_policy_reject:
            failures = list(set((failures or []) + [FRAUD_REASON_POLICY_RISK_THRESHOLD]))
            is_valid = False
            risk_score = _calculate_fraud_score(failures, confidence=confidence)

        verification_details = {
            VERIFY_DETAIL_KEY_OCR_CONFIDENCE: confidence,
            VERIFY_DETAIL_KEY_FAILURE_REASONS: failures,
            VERIFY_DETAIL_KEY_EXTRACTED_TEXT_LENGTH: len(extracted_text) if extracted_text else 0,
            VERIFY_DETAIL_KEY_UPLOADED_SHA256: sha256_hash,
            VERIFY_DETAIL_KEY_RISK_SCORE: risk_score,
            VERIFY_DETAIL_KEY_DECISION_THRESHOLD: float(FRAUD_REJECT_THRESHOLD),
        }
        if ocr_signature:
            verification_details[VERIFY_DETAIL_KEY_OCR_SIGNATURE] = ocr_signature

        if is_valid:
            try:
                ensure_payment_status_transition(PAYMENT_STATUS_PROCESSING, PAYMENT_STATUS_SUCCESS)
            except StateTransitionError:
                return create_error_response("PAYMENT_INVALID_STATE")

            object_key = f"{PAYMENT_FILE_FINAL_PREFIX}/{payment_public_id}.{ext}"
            try:
                if upload_object_key:
                    s3_response = s3.copy_object(
                        Bucket=S3_BUCKET_NAME,
                        CopySource={"Bucket": S3_BUCKET_NAME, "Key": upload_object_key},
                        Key=object_key,
                        ContentType=content_type or mime_type or "image/jpeg",
                        MetadataDirective="REPLACE",
                    )
                    try:
                        if upload_object_key != object_key:
                            s3.delete_object(Bucket=S3_BUCKET_NAME, Key=upload_object_key)
                    except Exception:
                        pass
                else:
                    s3_response = s3.put_object(
                        Bucket=S3_BUCKET_NAME,
                        Key=object_key,
                        Body=image_bytes,
                        ContentType=content_type,
                    )
            except Exception:
                db.rollback()
                _finalize_attempt(VERIFY_ATTEMPT_STATUS_ERROR, details={"reason": "s3_upload_failed"})
                return create_error_response("INTERNAL_ERROR", custom_message="Failed to save payment screenshot")

            insert_payment_file_record(
                db,
                payment_id=payment_id,
                bucket_name=S3_BUCKET_NAME,
                object_key=object_key,
                sha256_hash=sha256_hash,
                etag=(
                    (s3_response.get("ETag") or "").strip('"')
                    or (s3_response.get("CopyObjectResult", {}).get("ETag") or "").strip('"')
                    or None
                ),
                file_size=int(len(image_bytes)),
                content_type=content_type or mime_type or None,
                uploaded_by_ip_hash=ip_hash or get_ip_hash(),
                image_phash=image_hash,
                image_phash_bits=image_hash_bits,
                image_phash_bucket=image_hash_bucket,
                image_quality_score=round(float(confidence), 2) if confidence is not None else None,
            )

            success_risk_score = set_payment_verification_outcome(
                db,
                payment_id=payment_id,
                filtered_text=filtered_text,
                sha256_hash=sha256_hash,
                fraud_score=risk_score,
                target_status=PAYMENT_STATUS_SUCCESS,
                detected_app=detected_app,
                verification_details=verification_details,
                auto_rejected=False,
            )

            verification_result = {
                "status": PAYMENT_STATUS_SUCCESS,
                "verified": True,
                VERIFY_DETAIL_KEY_FAILURE_REASONS: [],
            }
            _finalize_attempt(
                VERIFY_ATTEMPT_STATUS_SUCCESS,
                detected_app=detected_app,
                failures=[],
                fraud_score=success_risk_score,
                details={VERIFY_DETAIL_KEY_OCR_SIGNATURE: ocr_signature} if ocr_signature else None,
            )
            emit_domain_event(
                db,
                event_type="payment_verified",
                correlation_id=request_id,
                participant_id=participant_id,
                payment_id=payment_id,
                payload={"detected_app": detected_app, "status": PAYMENT_STATUS_SUCCESS},
            )
        else:
            try:
                ensure_payment_status_transition(PAYMENT_STATUS_PROCESSING, PAYMENT_STATUS_REJECTED_FRAUD)
            except StateTransitionError:
                return create_error_response("PAYMENT_INVALID_STATE")

            set_payment_verification_outcome(
                db,
                payment_id=payment_id,
                filtered_text=filtered_text,
                sha256_hash=sha256_hash,
                fraud_score=risk_score,
                target_status=PAYMENT_STATUS_REJECTED_FRAUD,
                detected_app=detected_app,
                verification_details=verification_details,
                auto_rejected=True,
            )
            insert_payment_fraud_signals(
                db,
                payment_id=payment_id,
                failures=failures or [],
                score=100,
                confidence=confidence,
            )

            verification_result = {
                "status": PAYMENT_STATUS_REJECTED_FRAUD,
                "verified": True,
                VERIFY_DETAIL_KEY_FAILURE_REASONS: failures,
            }
            reject_details = {VERIFY_DETAIL_KEY_OCR_SIGNATURE: ocr_signature} if ocr_signature else None
            _finalize_attempt(VERIFY_ATTEMPT_STATUS_REJECTED, detected_app=detected_app, failures=failures, fraud_score=risk_score, details=reject_details)

    except Exception as exc:
        try:
            db.rollback()
        except Exception:
            pass
        if _is_ocr_unavailable(exc):
            verification_details, failures = _reject_for_ocr_unavailable(db, payment_id, participant_id, sha256_hash=sha256_hash)
            verification_result = {
                "status": PAYMENT_STATUS_REJECTED_FRAUD,
                "verified": True,
                VERIFY_DETAIL_KEY_FAILURE_REASONS: failures,
            }
            _finalize_attempt(VERIFY_ATTEMPT_STATUS_REJECTED, detected_app=PAYMENT_DETECTED_APP_UNKNOWN, failures=failures, fraud_score=_calculate_fraud_score(failures, confidence=0))
        else:
            verification_result = {
                "status": VERIFY_ATTEMPT_STATUS_ERROR,
                "verified": False,
                "error": PAYMENT_VERIFICATION_ERROR,
            }
            _finalize_attempt(
                VERIFY_ATTEMPT_STATUS_ERROR,
                failures=[FRAUD_REASON_VERIFICATION_FAILED],
                fraud_score=_calculate_fraud_score([FRAUD_REASON_VERIFICATION_FAILED]),
            )

    response_payload = {"status": "processed", "verification": verification_result}
    save_idempotent_response(
        db,
        endpoint=f"/payments/{payment_public_id}/verify-upload",
        idempotency_key=idempotency_key,
        participant_public_id=payment_public_id,
        request_hash=request_hash,
        response_body=response_payload,
        status_code=200,
    )
    try:
        db.commit()
    except Exception:
        pass
    return jsonify(response_payload)


def process_internal_verify(
    *,
    db,
    payment_public_id: str,
):
    row = fetch_payment_for_internal_verify(db, payment_public_id)

    if not row:
        return create_error_response("PAYMENT_NOT_FOUND")

    payment_id, participant_id, amount, current_status, object_key, existing_sha256 = row

    try:
        ensure_payment_status_transition(current_status, PAYMENT_STATUS_PROCESSING)
    except StateTransitionError:
        return create_error_response("PAYMENT_INVALID_STATE")

    set_payment_status(
        db,
        payment_id=payment_id,
        status=PAYMENT_STATUS_PROCESSING,
        current_status=current_status,
    )

    try:
        image = fetch_s3_image(object_key)
        extracted_text, confidence = extract_text_with_confidence(image)
    except Exception as e:
        if _is_ocr_unavailable(e):
            verification_details, failures = _reject_for_ocr_unavailable(
                db, payment_id, participant_id, sha256_hash=existing_sha256
            )
            return jsonify({
                "status": PAYMENT_STATUS_REJECTED_FRAUD,
                "detected_app": PAYMENT_DETECTED_APP_UNKNOWN,
                VERIFY_DETAIL_KEY_FAILURE_REASONS: failures,
                "auto_rejected": True,
                "verification_details": verification_details,
            })
        return create_error_response("SYS_SERVICE_UNAVAILABLE")

    is_valid, detected_app, failures = verify_payment_screenshot(
        image, extracted_text, amount, confidence, UPI_NAME
    )
    detected_app = detected_app or PAYMENT_DETECTED_APP_UNKNOWN
    filtered_text = sanitize_extracted_text_for_storage(extracted_text, detected_app)

    verification_details = {
        VERIFY_DETAIL_KEY_OCR_CONFIDENCE: confidence,
        VERIFY_DETAIL_KEY_FAILURE_REASONS: failures,
        VERIFY_DETAIL_KEY_EXTRACTED_TEXT_LENGTH: len(extracted_text) if extracted_text else 0,
        VERIFY_DETAIL_KEY_UPLOADED_SHA256: existing_sha256,
    }

    target_status = PAYMENT_STATUS_SUCCESS if is_valid else PAYMENT_STATUS_REJECTED_FRAUD
    try:
        ensure_payment_status_transition(PAYMENT_STATUS_PROCESSING, target_status)
    except StateTransitionError:
        return create_error_response("PAYMENT_INVALID_STATE")

    set_payment_verification_outcome(
        db,
        payment_id=payment_id,
        filtered_text=filtered_text,
        sha256_hash=existing_sha256,
        fraud_score=_calculate_fraud_score(failures, confidence=confidence),
        target_status=target_status,
        detected_app=detected_app,
        verification_details=verification_details,
        auto_rejected=(target_status == PAYMENT_STATUS_REJECTED_FRAUD),
    )
    insert_payment_fraud_signals(db, payment_id=payment_id, failures=failures, score=100, confidence=confidence)

    db.commit()
    if is_valid:
        emit_domain_event(
            db,
            event_type="payment_verified",
            correlation_id=None,
            participant_id=participant_id,
            payment_id=payment_id,
            payload={"detected_app": detected_app, "status": PAYMENT_STATUS_SUCCESS, "source": "internal_verify"},
        )
        return jsonify({"status": PAYMENT_STATUS_SUCCESS, "detected_app": detected_app})

    return jsonify({
        "status": PAYMENT_STATUS_REJECTED_FRAUD,
        "detected_app": detected_app,
        VERIFY_DETAIL_KEY_FAILURE_REASONS: failures,
    })
