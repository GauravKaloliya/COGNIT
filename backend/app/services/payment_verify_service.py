import logging
from datetime import datetime, timezone
from typing import Callable, Optional

from flask import jsonify

from app.config import (
    ERROR_CODES,
    S3_BUCKET_NAME,
    UPI_NAME,
    PAYMENT_AMOUNT,
    FRAUD_SCORE_WEIGHTS,
    FRAUD_UNKNOWN_REASON_WEIGHT,
    FRAUD_REJECT_THRESHOLD,
    MAX_FRAUD_SCORE,
    PAYMENT_VERIFY_MAX_ATTEMPTS,
    ENABLE_DUPLICATE_DETECTION,
)
from app.constants.event_constants import (
    AUDIT_EVENT_PAYMENT_VERIFY_UPLOAD_INVALID_STATE,
    AUDIT_EVENT_PAYMENT_VERIFY_UPLOAD_STARTED,
    DOMAIN_EVENT_PAYMENT_VERIFIED,
)
from app.constants.audit_details import (
    AUDIT_DETAIL_INVALID_STATUS,
    AUDIT_DETAIL_VERIFY_UPLOAD_CALLED,
)
from app.constants.payment_constants import (
    FRAUD_REASON_MAX_ATTEMPTS_EXCEEDED,
    FRAUD_REASON_OCR_SIGNATURE_REPLAY_OTHER,
    FRAUD_REASON_OCR_SIGNATURE_REPLAY_SELF,
    FRAUD_REASON_POLICY_RISK_THRESHOLD,
    FRAUD_REASON_VERIFICATION_FAILED,
    PAYMENT_DETECTED_APP_UNKNOWN,
    PAYMENT_FILE_FINAL_PREFIX,
    PAYMENT_STATUS_EXPIRED,
    PAYMENT_STATUS_FAILED,
    PAYMENT_STATUS_PENDING,
    PAYMENT_STATUS_PROCESSING,
    PAYMENT_STATUS_REJECTED_FRAUD,
    PAYMENT_STATUS_SUCCESS,
    UPLOAD_SOURCE_FIELD_OBJECT_KEY,
    VERIFY_ATTEMPT_STATUS_ERROR,
    VERIFY_ATTEMPT_STATUS_EXPIRED,
    VERIFY_ATTEMPT_STATUS_INVALID_STATE,
    VERIFY_ATTEMPT_STATUS_REJECTED,
    VERIFY_ATTEMPT_STATUS_STARTED,
    VERIFY_ATTEMPT_STATUS_SUCCESS,
    VERIFY_DETAIL_KEY_DECISION_THRESHOLD,
    VERIFY_DETAIL_KEY_EXTRACTED_TEXT_LENGTH,
    VERIFY_DETAIL_KEY_FAILURE_REASONS,
    VERIFY_DETAIL_KEY_MAX_ATTEMPTS,
    VERIFY_DETAIL_KEY_OCR_CONFIDENCE,
    VERIFY_DETAIL_KEY_OCR_SIGNATURE,
    VERIFY_DETAIL_KEY_RISK_SCORE,
    VERIFY_DETAIL_KEY_UPLOADED_SHA256,
    PAYMENT_VERIFICATION_ERROR,
)
from app.constants.response_keys import (
    RESPONSE_KEY_DETECTED_APP,
    RESPONSE_KEY_ERROR,
    RESPONSE_KEY_STATUS,
    RESPONSE_KEY_VERIFICATION,
    RESPONSE_KEY_VERIFIED,
)
from app.constants.route_constants import PAYMENT_VERIFY_UPLOAD_ENDPOINT_TEMPLATE
from app.constants.observability_constants import OBS_EVENT_FRAUD_SCORE_CONFIDENCE_PARSE_FAILED, OBS_EVENT_PAYMENT_DHASH_FAILED, OBS_EVENT_PAYMENT_UPLOAD_CLEANUP_FAILED, OBS_EVENT_PAYMENT_VERIFY_COMMIT_FAILED, OBS_EVENT_PAYMENT_VERIFY_ROLLBACK_FAILED
from app.extensions import s3
from app.utils.helpers import create_error_response, get_ip_hash
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
    check_ocr_signature_replay,
    compute_dhash,
    phash_hex_to_bits_and_bucket,
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
from app.services.payment_duplicate_service import resolve_duplicate_upload_response
from app.services.payment_verify_input_service import load_verify_upload_image
from app.services.payment_verify_support_service import (
    calculate_fraud_score as calculate_payment_fraud_score,
    is_ocr_unavailable as detect_ocr_unavailable,
    reject_for_ocr_unavailable as reject_payment_for_ocr_unavailable,
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
from app.services import record_upi_result
from app.utils.observability import log_event

logger = logging.getLogger(__name__)


def _calculate_fraud_score(failures, confidence=None) -> float:
    return calculate_payment_fraud_score(
        failures=failures,
        confidence=confidence,
        fraud_score_weights=FRAUD_SCORE_WEIGHTS,
        unknown_reason_weight=FRAUD_UNKNOWN_REASON_WEIGHT,
        max_fraud_score=MAX_FRAUD_SCORE,
        log_confidence_parse_error=lambda: log_event(
            logger,
            OBS_EVENT_FRAUD_SCORE_CONFIDENCE_PARSE_FAILED,
            level=logging.WARNING,
        ),
    )


def _is_ocr_unavailable(error: Exception) -> bool:
    return isinstance(error, (OCRServiceUnavailableError, TesseractNotFoundError, OCRServiceError)) or detect_ocr_unavailable(error)


def _reject_for_ocr_unavailable(db, payment_id: int, participant_id: int, sha256_hash: str = None):
    return reject_payment_for_ocr_unavailable(
        db=db,
        payment_id=payment_id,
        participant_id=participant_id,
        sha256_hash=sha256_hash,
        calculate_score=lambda **kwargs: _calculate_fraud_score(kwargs.get("failures"), kwargs.get("confidence")),
        set_payment_ocr_unavailable=set_payment_ocr_unavailable,
        record_upi_result=record_upi_result,
        insert_payment_fraud_signals=insert_payment_fraud_signals,
    )


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
    prepared_upload, upload_error = load_verify_upload_image(
        payment_public_id=payment_public_id,
        data=data,
        s3_client=s3,
    )
    if upload_error is not None:
        return upload_error

    upload_object_key = prepared_upload["upload_object_key"]
    ext = prepared_upload["ext"]
    content_type = prepared_upload["content_type"]
    mime_type = prepared_upload["mime_type"]
    original_filename = prepared_upload["original_filename"]
    client_file_size = prepared_upload["client_file_size"]
    sha256_hash = prepared_upload["sha256_hash"]
    image_bytes = prepared_upload["image_bytes"]
    image = prepared_upload["image"]
    idempotency_key = (idempotency_key_header or data.get("idempotency_key") or "").strip()[:128]

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
        endpoint=PAYMENT_VERIFY_UPLOAD_ENDPOINT_TEMPLATE.format(payment_public_id=payment_public_id),
        idempotency_key=idempotency_key,
        participant_public_id=payment_public_id,
        request_hash=request_hash,
    )
    if replay:
        payload, status_code = replay
        return jsonify(payload), status_code

    row = fetch_payment_for_verify(db, payment_public_id)
    if not row:
        return create_error_response("NF_PAYMENT_VERIFY_NOT_FOUND")

    if len(row) >= 7:
        payment_id, participant_id, status, expires_at, timer_activated_at, verification_attempts, amount = row
    else:
        payment_id, participant_id, status, expires_at, timer_activated_at, verification_attempts = row
        amount = None

    try:
        image_hash = compute_dhash(image) or sha256_hash
    except Exception:
        log_event(logger, OBS_EVENT_PAYMENT_DHASH_FAILED, level=logging.WARNING)
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
            AUDIT_EVENT_PAYMENT_VERIFY_UPLOAD_STARTED,
            payment_id=payment_id,
            participant_id=participant_id,
            details=AUDIT_DETAIL_VERIFY_UPLOAD_CALLED,
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
                details={"reason": ERROR_CODES["PAY_EXPIRED"]["reason"]},
            )
        except StateTransitionError:
            return create_error_response("PAY_VERIFY_EXPIRED_TRANSITION_INVALID")
        _finalize_attempt(VERIFY_ATTEMPT_STATUS_EXPIRED)
        db.commit()
        return create_error_response("PAY_EXPIRED")

    if status != PAYMENT_STATUS_PENDING:
        if payment_audit_logger:
            payment_audit_logger(
                db,
                AUDIT_EVENT_PAYMENT_VERIFY_UPLOAD_INVALID_STATE,
                payment_id=payment_id,
                participant_id=participant_id,
                details=AUDIT_DETAIL_INVALID_STATUS.format(status=status),
                response_data={"status": status},
            )
        _finalize_attempt(VERIFY_ATTEMPT_STATUS_INVALID_STATE, details={"current_payment_status": status})
        return create_error_response("PAY_VERIFY_STATUS_INVALID")

    if int(verification_attempts or 0) >= int(PAYMENT_VERIFY_MAX_ATTEMPTS):
        try:
            transition_payment_status(
                db,
                payment_id=int(payment_id),
                from_status=str(status),
                to_status=PAYMENT_STATUS_FAILED,
                request_id=request_id,
                details={"reason": ERROR_CODES["PAY_VERIFY_ATTEMPTS_EXCEEDED"]["reason"]},
            )
        except StateTransitionError:
            return create_error_response("PAY_VERIFY_MAX_ATTEMPTS_STATE_INVALID")
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

    if ENABLE_DUPLICATE_DETECTION:
        duplicate_error = resolve_duplicate_upload_response(
            db=db,
            payment_id=payment_id,
            participant_id=participant_id,
            sha256_hash=sha256_hash,
            image_hash=image_hash,
            device_fingerprint=device_fingerprint,
            device_fingerprint_variants=device_fingerprint_variants,
            payment_audit_logger=payment_audit_logger,
            fetch_payment_owner_participant_id=fetch_payment_owner_participant_id,
            reject_payment_for_fraud=_reject_payment_for_fraud,
            finalize_attempt=_finalize_attempt,
        )
        if duplicate_error is not None:
            return duplicate_error
        image_hash = sha256_hash

    verification_result = {RESPONSE_KEY_STATUS: PAYMENT_STATUS_PROCESSING, RESPONSE_KEY_VERIFIED: False}

    try:
        try:
            ensure_payment_status_transition(status, PAYMENT_STATUS_PROCESSING)
        except StateTransitionError:
            return create_error_response("PAY_VERIFY_PROCESSING_STATE_INVALID")
        set_payment_status(
            db,
            payment_id=payment_id,
            status=PAYMENT_STATUS_PROCESSING,
            current_status=status,
        )

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
        if ENABLE_DUPLICATE_DETECTION and ocr_signature:
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
                return create_error_response("PAY_VERIFY_SUCCESS_STATE_INVALID")
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
                        log_event(logger, OBS_EVENT_PAYMENT_UPLOAD_CLEANUP_FAILED, level=logging.WARNING)
                else:
                    s3_response = s3.put_object(
                        Bucket=S3_BUCKET_NAME,
                        Key=object_key,
                        Body=image_bytes,
                        ContentType=content_type,
                    )
            except Exception:
                db.rollback()
                _finalize_attempt(VERIFY_ATTEMPT_STATUS_ERROR, details={"reason": ERROR_CODES["SYS_PAYMENT_SCREENSHOT_SAVE_FAILED"]["reason"]})
                return create_error_response("SYS_PAYMENT_SCREENSHOT_SAVE_FAILED")

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
            record_upi_result(db, payment_id=payment_id, result_status="SUCCESS")

            verification_result = {
                RESPONSE_KEY_STATUS: PAYMENT_STATUS_SUCCESS,
                RESPONSE_KEY_VERIFIED: True,
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
                event_type=DOMAIN_EVENT_PAYMENT_VERIFIED,
                correlation_id=request_id,
                participant_id=participant_id,
                payment_id=payment_id,
                payload={RESPONSE_KEY_DETECTED_APP: detected_app, RESPONSE_KEY_STATUS: PAYMENT_STATUS_SUCCESS},
            )
        else:
            try:
                ensure_payment_status_transition(PAYMENT_STATUS_PROCESSING, PAYMENT_STATUS_REJECTED_FRAUD)
            except StateTransitionError:
                return create_error_response("PAY_VERIFY_REJECT_STATE_INVALID")
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
            record_upi_result(db, payment_id=payment_id, result_status="FAILURE")
            insert_payment_fraud_signals(
                db,
                payment_id=payment_id,
                failures=failures or [],
                score=100,
                confidence=confidence,
            )

            verification_result = {
                RESPONSE_KEY_STATUS: PAYMENT_STATUS_REJECTED_FRAUD,
                RESPONSE_KEY_VERIFIED: True,
                VERIFY_DETAIL_KEY_FAILURE_REASONS: failures,
            }
            reject_details = {VERIFY_DETAIL_KEY_OCR_SIGNATURE: ocr_signature} if ocr_signature else None
            _finalize_attempt(VERIFY_ATTEMPT_STATUS_REJECTED, detected_app=detected_app, failures=failures, fraud_score=risk_score, details=reject_details)

    except Exception as exc:
        try:
            db.rollback()
        except Exception:
            log_event(logger, OBS_EVENT_PAYMENT_VERIFY_ROLLBACK_FAILED, level=logging.WARNING)
        if _is_ocr_unavailable(exc):
            verification_details, failures = _reject_for_ocr_unavailable(db, payment_id, participant_id, sha256_hash=sha256_hash)
            verification_result = {
                RESPONSE_KEY_STATUS: PAYMENT_STATUS_REJECTED_FRAUD,
                RESPONSE_KEY_VERIFIED: True,
                VERIFY_DETAIL_KEY_FAILURE_REASONS: failures,
            }
            _finalize_attempt(VERIFY_ATTEMPT_STATUS_REJECTED, detected_app=PAYMENT_DETECTED_APP_UNKNOWN, failures=failures, fraud_score=_calculate_fraud_score(failures, confidence=0))
        else:
            verification_result = {
                RESPONSE_KEY_STATUS: VERIFY_ATTEMPT_STATUS_ERROR,
                RESPONSE_KEY_VERIFIED: False,
                RESPONSE_KEY_ERROR: PAYMENT_VERIFICATION_ERROR,
            }
            _finalize_attempt(
                VERIFY_ATTEMPT_STATUS_ERROR,
                failures=[FRAUD_REASON_VERIFICATION_FAILED],
                fraud_score=_calculate_fraud_score([FRAUD_REASON_VERIFICATION_FAILED]),
            )

    response_payload = {RESPONSE_KEY_STATUS: "processed", RESPONSE_KEY_VERIFICATION: verification_result}
    save_idempotent_response(
        db,
        endpoint=PAYMENT_VERIFY_UPLOAD_ENDPOINT_TEMPLATE.format(payment_public_id=payment_public_id),
        idempotency_key=idempotency_key,
        participant_public_id=payment_public_id,
        request_hash=request_hash,
        response_body=response_payload,
        status_code=200,
    )
    try:
        db.commit()
    except Exception:
        log_event(logger, OBS_EVENT_PAYMENT_VERIFY_COMMIT_FAILED, level=logging.WARNING)
    return jsonify(response_payload)


def process_internal_verify(
    *,
    db,
    payment_public_id: str,
):
    row = fetch_payment_for_internal_verify(db, payment_public_id)

    if not row:
        return create_error_response("NF_PAYMENT_INTERNAL_VERIFY_NOT_FOUND")

    payment_id, participant_id, amount, current_status, object_key, existing_sha256 = row

    try:
        ensure_payment_status_transition(current_status, PAYMENT_STATUS_PROCESSING)
    except StateTransitionError:
        return create_error_response("PAY_INTERNAL_VERIFY_START_INVALID")

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
                RESPONSE_KEY_STATUS: PAYMENT_STATUS_REJECTED_FRAUD,
                RESPONSE_KEY_DETECTED_APP: PAYMENT_DETECTED_APP_UNKNOWN,
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
        return create_error_response("PAY_INTERNAL_VERIFY_FINALIZE_INVALID")
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
    record_upi_result(db, payment_id=payment_id, result_status="SUCCESS" if is_valid else "FAILURE")
    insert_payment_fraud_signals(db, payment_id=payment_id, failures=failures, score=100, confidence=confidence)

    db.commit()
    if is_valid:
        emit_domain_event(
            db,
            event_type=DOMAIN_EVENT_PAYMENT_VERIFIED,
            correlation_id=None,
            participant_id=participant_id,
            payment_id=payment_id,
            payload={RESPONSE_KEY_DETECTED_APP: detected_app, RESPONSE_KEY_STATUS: PAYMENT_STATUS_SUCCESS, "source": "internal_verify"},
        )
        return jsonify({RESPONSE_KEY_STATUS: PAYMENT_STATUS_SUCCESS, RESPONSE_KEY_DETECTED_APP: detected_app})

    return jsonify({
        RESPONSE_KEY_STATUS: PAYMENT_STATUS_REJECTED_FRAUD,
        RESPONSE_KEY_DETECTED_APP: detected_app,
        VERIFY_DETAIL_KEY_FAILURE_REASONS: failures,
    })
