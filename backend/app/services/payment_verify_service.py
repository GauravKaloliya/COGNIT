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
    FRAUD_SCORE_WEIGHTS,
    FRAUD_UNKNOWN_REASON_WEIGHT,
    FRAUD_REJECT_THRESHOLD,
    FRAUD_SUCCESS_MAX_SCORE,
    PAYMENT_VERIFY_MAX_ATTEMPTS,
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
    failures = ["ocr_unavailable"]
    verification_details = {
        "ocr_confidence": 0,
        "failure_reasons": failures,
        "extracted_text_length": 0,
    }
    if sha256_hash:
        verification_details["uploaded_sha256"] = sha256_hash

    db.execute(text("""
        UPDATE payments
        SET extracted_text = '',
            fraud_score = :fs,
            verified_at = CURRENT_TIMESTAMP,
            status = 'rejected_fraud',
            detected_app = 'unknown',
            auto_rejected = true,
            verification_details = :details
        WHERE id = :pid
    """), {
        "fs": _calculate_fraud_score(failures, confidence=0),
        "details": json.dumps(verification_details),
        "pid": payment_id,
    })

    db.execute(text("""
        INSERT INTO payment_fraud_signals (
            payment_id, signal_type, signal_score, details
        ) VALUES (
            :pid, :type, :score, :details
        ) ON CONFLICT DO NOTHING
    """), {
        "pid": payment_id,
        "type": "ocr_unavailable",
        "score": 100,
        "details": json.dumps({"reason": "ocr_unavailable"}),
    })

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

    row = db.execute(text("""
        SELECT id, participant_id, status, expires_at, timer_activated_at, verification_attempts
        FROM payments
        WHERE public_id = :pid
        FOR UPDATE
    """), {"pid": payment_public_id}).fetchone()
    if not row:
        return create_error_response("PAYMENT_NOT_FOUND")

    payment_id, participant_id, status, expires_at, timer_activated_at, verification_attempts = row

    try:
        if upload_object_key:
            expected_prefix = f"payments/staging/{payment_public_id}/"
            if not upload_object_key.startswith(expected_prefix):
                return create_error_response("VAL_INVALID_FORMAT", {"field": "upload_object_key"})
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
        source_field = "upload_object_key" if upload_object_key else "image_base64"
        return create_error_response("INVALID_FORMAT", {"field": source_field, "message": "Invalid image data"})

    try:
        image_hash = compute_dhash(image) or sha256_hash
    except Exception:
        image_hash = sha256_hash

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
        status="started",
        details={
            "original_filename": original_filename or None,
            "upload_object_key": upload_object_key or None,
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
            "failure_reasons": failures or [],
            "uploaded_sha256": sha256_hash,
        }
        if details:
            verification_details.update(details)

        db.execute(text("""
            UPDATE payments
            SET fraud_score = :score,
                status = 'rejected_fraud',
                detected_app = 'unknown',
                auto_rejected = true,
                verified_at = CURRENT_TIMESTAMP,
                verification_details = :verification_details,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = :pid
        """), {
            "pid": payment_id,
            "score": score,
            "verification_details": json.dumps(verification_details),
        })

        for failure in (failures or []):
            db.execute(text("""
                INSERT INTO payment_fraud_signals (
                    payment_id, signal_type, signal_score, details
                ) VALUES (
                    :pid, :type, :score, :details
                ) ON CONFLICT DO NOTHING
            """), {
                "pid": payment_id,
                "type": failure,
                "score": score,
                "details": json.dumps({"reason": failure}),
            })
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
                to_status="expired",
                request_id=request_id,
                details={"reason": "session_expired_before_verify"},
            )
        except StateTransitionError:
            return create_error_response("PAYMENT_INVALID_STATE")
        _finalize_attempt("expired")
        db.commit()
        return create_error_response("PAYMENT_EXPIRED")

    if status != "pending":
        if payment_audit_logger:
            payment_audit_logger(
                db,
                "payment_verify_upload_invalid_state",
                payment_id=payment_id,
                participant_id=participant_id,
                details=f"invalid status {status}",
                response_data={"status": status},
            )
        _finalize_attempt("invalid_state", details={"current_payment_status": status})
        return create_error_response("PAYMENT_INVALID_STATE")

    if int(verification_attempts or 0) >= int(PAYMENT_VERIFY_MAX_ATTEMPTS):
        try:
            transition_payment_status(
                db,
                payment_id=int(payment_id),
                from_status=str(status),
                to_status="failed",
                request_id=request_id,
                details={"reason": "max_verify_attempts_exceeded"},
            )
        except StateTransitionError:
            return create_error_response("PAYMENT_INVALID_STATE")
        db.execute(text("""
            UPDATE payments
            SET verification_details = COALESCE(verification_details, '{}'::jsonb) || CAST(:details AS jsonb),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = :pid
        """), {
            "pid": payment_id,
            "details": json.dumps({
                "failure_reasons": ["max_attempts_exceeded"],
                "max_attempts": int(PAYMENT_VERIFY_MAX_ATTEMPTS),
            }),
        })
        _finalize_attempt(
            "invalid_state",
            failures=["max_attempts_exceeded"],
            details={"max_attempts": int(PAYMENT_VERIFY_MAX_ATTEMPTS)},
        )
        db.commit()
        return create_error_response("PAY_VERIFY_ATTEMPTS_EXCEEDED")

    db.execute(text("""
        UPDATE payments
        SET verification_attempts = COALESCE(verification_attempts, 0) + 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = :pid
    """), {"pid": payment_id})

    def _reuse_existing_success(existing_pid: int, reason: str):
        existing = db.execute(text("""
            SELECT status, extracted_text, fraud_score, detected_app, verification_details
            FROM payments
            WHERE id = :pid
        """), {"pid": existing_pid}).fetchone()
        if not existing:
            return False
        existing_status, existing_text, existing_fraud, existing_app, existing_details = existing
        if existing_status != "success":
            return False

        existing_app = existing_app or "unknown"
        reuse_details = existing_details or {}
        if isinstance(reuse_details, str):
            try:
                reuse_details = json.loads(reuse_details)
            except Exception:
                reuse_details = {}
        reuse_details["reused_from_payment_id"] = int(existing_pid)
        reuse_details["reuse_reason"] = reason

        try:
            ensure_payment_status_transition(status, "processing")
            ensure_payment_status_transition("processing", "success")
        except StateTransitionError:
            return False

        db.execute(text("""
            UPDATE payments
            SET status = 'processing', updated_at = CURRENT_TIMESTAMP
            WHERE id = :pid AND status = 'pending'
        """), {"pid": payment_id})

        db.execute(text("""
            UPDATE payments
            SET extracted_text = :txt,
                fraud_score = :fs,
                verified_at = CURRENT_TIMESTAMP,
                status = 'success',
                detected_app = :app,
                verification_details = :details
            WHERE id = :pid
        """), {
            "txt": existing_text or "",
            "fs": min(float(FRAUD_SUCCESS_MAX_SCORE), float(existing_fraud if existing_fraud is not None else 0)),
            "app": existing_app,
            "details": json.dumps(reuse_details),
            "pid": payment_id,
        })
        log_audit(
            db,
            "payment_reused_same_person",
            participant_id=participant_id,
            details=f"Reused verified payment {existing_pid} via {reason}",
        )
        db.commit()
        return True

    is_duplicate, existing_payment_id, is_same_participant = check_duplicate_screenshot(
        db, sha256_hash, participant_id=participant_id
    )
    if is_duplicate:
        existing_owner_participant_id = db.execute(text("""
            SELECT participant_id
            FROM payments
            WHERE id = :pid
        """), {"pid": existing_payment_id}).scalar()
        same_person_fingerprint = is_same_person_by_fingerprint(
            db,
            participant_id=participant_id,
            other_participant_id=existing_owner_participant_id,
            current_fingerprint=device_fingerprint,
        )
        if is_same_participant or same_person_fingerprint:
            if _reuse_existing_success(existing_payment_id, "exact_hash"):
                if payment_audit_logger:
                    payment_audit_logger(
                        db,
                        "payment_verify_reused_existing_success",
                        payment_id=payment_id,
                        participant_id=participant_id,
                        details=f"reused existing successful payment {existing_payment_id} (exact hash)",
                        response_data={"reused_from_payment_id": int(existing_payment_id)},
                    )
                _finalize_attempt("success", details={"reused_existing_verification": True})
                payload = {
                    "status": "processed",
                    "verification": {
                        "status": "success",
                        "verified": True,
                        "failure_reasons": [],
                        "reused_existing_verification": True,
                    },
                }
                save_idempotent_response(
                    db,
                    endpoint=f"/payments/{payment_public_id}/verify-upload",
                    idempotency_key=idempotency_key,
                    participant_public_id=payment_public_id,
                    request_hash=request_hash,
                    response_body=payload,
                    status_code=200,
                )
                emit_domain_event(
                    db,
                    event_type="payment_verified",
                    correlation_id=request_id,
                    participant_id=participant_id,
                    payment_id=payment_id,
                    payload={"reused": True},
                )
                try:
                    db.commit()
                except Exception:
                    pass
                return jsonify(payload)
            fraud_score = _reject_payment_for_fraud(["duplicate_hash_self"])
            _finalize_attempt(
                "duplicate",
                detected_app="unknown",
                failures=["duplicate_hash_self"],
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
        fraud_score = _reject_payment_for_fraud(["duplicate_hash_other"])
        _finalize_attempt(
            "duplicate",
            detected_app="unknown",
            failures=["duplicate_hash_other"],
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
        fraud_score = _reject_payment_for_fraud(["rejected_reuse"])
        _finalize_attempt(
            "rejected",
            detected_app="unknown",
            failures=["rejected_reuse"],
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
            near_owner_participant_id = db.execute(text("""
                SELECT participant_id
                FROM payments
                WHERE id = :pid
            """), {"pid": near_payment_id}).scalar()
            near_same_person_fingerprint = is_same_person_by_fingerprint(
                db,
                participant_id=participant_id,
                other_participant_id=near_owner_participant_id,
                current_fingerprint=device_fingerprint,
            )
            if near_same_participant or near_same_person_fingerprint:
                if _reuse_existing_success(near_payment_id, f"near_hash_distance_{near_distance}"):
                    if payment_audit_logger:
                        payment_audit_logger(
                            db,
                            "payment_verify_reused_existing_success_near_hash",
                            payment_id=payment_id,
                            participant_id=participant_id,
                            details=f"reused existing successful payment {near_payment_id} (near hash distance={near_distance})",
                            response_data={"reused_from_payment_id": int(near_payment_id), "distance": near_distance},
                        )
                    _finalize_attempt("success", details={"reused_existing_verification": True, "distance": near_distance})
                    payload = {
                        "status": "processed",
                        "verification": {
                            "status": "success",
                            "verified": True,
                            "failure_reasons": [],
                            "reused_existing_verification": True,
                        },
                    }
                    save_idempotent_response(
                        db,
                        endpoint=f"/payments/{payment_public_id}/verify-upload",
                        idempotency_key=idempotency_key,
                        participant_public_id=payment_public_id,
                        request_hash=request_hash,
                        response_body=payload,
                        status_code=200,
                    )
                    emit_domain_event(
                        db,
                        event_type="payment_verified",
                        correlation_id=request_id,
                        participant_id=participant_id,
                        payment_id=payment_id,
                        payload={"reused": True, "distance": near_distance},
                    )
                    try:
                        db.commit()
                    except Exception:
                        pass
                    return jsonify(payload)
                fraud_score = _reject_payment_for_fraud(
                    ["near_duplicate_self"],
                    details={"distance": near_distance},
                )
                _finalize_attempt(
                    "duplicate",
                    detected_app="unknown",
                    failures=["near_duplicate_self"],
                    fraud_score=fraud_score,
                    details={"distance": near_distance},
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
                ["near_duplicate_other"],
                details={"distance": near_distance},
            )
            _finalize_attempt(
                "duplicate",
                detected_app="unknown",
                failures=["near_duplicate_other"],
                fraud_score=fraud_score,
                details={"distance": near_distance},
            )
            db.commit()
            return create_error_response("DUPLICATE_IMAGE")
    except Exception:
        image_hash = sha256_hash

    verification_result = {"status": "processing", "verified": False}

    try:
        try:
            ensure_payment_status_transition(status, "processing")
        except StateTransitionError:
            return create_error_response("PAYMENT_INVALID_STATE")

        db.execute(text("""
            UPDATE payments
            SET status = 'processing', updated_at = CURRENT_TIMESTAMP
            WHERE id = :pid
        """), {"pid": payment_id})

        extracted_text, confidence = extract_text_with_confidence(image)
        payment_row = db.execute(text("SELECT amount FROM payments WHERE id = :pid"), {"pid": payment_id}).fetchone()
        amount = payment_row[0] if payment_row else 1
        is_valid, detected_app, failures = verify_payment_screenshot(
            image,
            extracted_text,
            amount,
            confidence,
            UPI_NAME,
            time_window_start_utc=timer_activated_at,
            time_window_end_utc=expires_at,
        )
        detected_app = detected_app or "unknown"
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
                replay_reason = "ocr_signature_replay_self" if replay_same_participant else "ocr_signature_replay_other"
                failures = list(set((failures or []) + [replay_reason]))
                is_valid = False

        risk_score = _calculate_fraud_score(failures, confidence=confidence)
        force_policy_reject = bool(is_valid and risk_score >= float(FRAUD_REJECT_THRESHOLD))
        if force_policy_reject:
            failures = list(set((failures or []) + ["policy_risk_threshold"]))
            is_valid = False
            risk_score = _calculate_fraud_score(failures, confidence=confidence)

        verification_details = {
            "ocr_confidence": confidence,
            "failure_reasons": failures,
            "extracted_text_length": len(extracted_text) if extracted_text else 0,
            "uploaded_sha256": sha256_hash,
            "risk_score": risk_score,
            "decision_threshold": float(FRAUD_REJECT_THRESHOLD),
        }
        if ocr_signature:
            verification_details["ocr_signature"] = ocr_signature

        if is_valid:
            try:
                ensure_payment_status_transition("processing", "success")
            except StateTransitionError:
                return create_error_response("PAYMENT_INVALID_STATE")

            object_key = f"payments/{payment_public_id}.{ext}"
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
                _finalize_attempt("error", details={"reason": "s3_upload_failed"})
                return create_error_response("INTERNAL_ERROR", custom_message="Failed to save payment screenshot")

            db.execute(text("""
                INSERT INTO payment_files (
                    payment_id, bucket_name, object_key, sha256, etag, file_size,
                    content_type, uploaded_by_ip_hash, image_phash, image_quality_score
                ) VALUES (
                    :pid, :bucket_name, :key, :hash, :etag, :file_size,
                    :content_type, :uploaded_by_ip_hash, :phash, :image_quality_score
                )
            """), {
                "pid": payment_id,
                "bucket_name": S3_BUCKET_NAME,
                "key": object_key,
                "hash": sha256_hash,
                "etag": (
                    (s3_response.get("ETag") or "").strip('"')
                    or (s3_response.get("CopyObjectResult", {}).get("ETag") or "").strip('"')
                    or None
                ),
                "file_size": int(len(image_bytes)),
                "content_type": content_type or mime_type or None,
                "uploaded_by_ip_hash": ip_hash or get_ip_hash(),
                "phash": image_hash,
                "image_quality_score": round(float(confidence), 2) if confidence is not None else None,
            })

            db.execute(text("""
                UPDATE payments
                SET extracted_text = :txt,
                    fraud_score = :fs,
                    verified_at = CURRENT_TIMESTAMP,
                    status = :status,
                    detected_app = :app,
                    verification_details = :details
                WHERE id = :pid
            """), {
                "txt": filtered_text,
                "fs": min(float(FRAUD_SUCCESS_MAX_SCORE), risk_score),
                "status": "success",
                "app": detected_app,
                "details": json.dumps(verification_details),
                "pid": payment_id,
            })

            verification_result = {
                "status": "success",
                "verified": True,
                "failure_reasons": [],
            }
            _finalize_attempt(
                "success",
                detected_app=detected_app,
                failures=[],
                fraud_score=min(float(FRAUD_SUCCESS_MAX_SCORE), risk_score),
                details={"ocr_signature": ocr_signature} if ocr_signature else None,
            )
            emit_domain_event(
                db,
                event_type="payment_verified",
                correlation_id=request_id,
                participant_id=participant_id,
                payment_id=payment_id,
                payload={"detected_app": detected_app, "status": "success"},
            )
        else:
            try:
                ensure_payment_status_transition("processing", "rejected_fraud")
            except StateTransitionError:
                return create_error_response("PAYMENT_INVALID_STATE")

            db.execute(text("""
                UPDATE payments
                SET extracted_text = :txt,
                    fraud_score = :fs,
                    verified_at = CURRENT_TIMESTAMP,
                    status = :status,
                    detected_app = :app,
                    verification_details = :details,
                    auto_rejected = true
                WHERE id = :pid
            """), {
                "txt": filtered_text,
                "fs": risk_score,
                "status": "rejected_fraud",
                "app": detected_app,
                "details": json.dumps(verification_details),
                "pid": payment_id,
            })

            for failure in failures:
                db.execute(text("""
                    INSERT INTO payment_fraud_signals (
                        payment_id, signal_type, signal_score, details
                    ) VALUES (
                        :pid, :type, :score, :details
                    ) ON CONFLICT DO NOTHING
                """), {
                    "pid": payment_id,
                    "type": failure,
                    "score": 100,
                    "details": json.dumps({"reason": failure, "confidence": confidence}),
                })

            verification_result = {
                "status": "rejected_fraud",
                "verified": True,
                "failure_reasons": failures,
            }
            reject_details = {"ocr_signature": ocr_signature} if ocr_signature else None
            _finalize_attempt("rejected", detected_app=detected_app, failures=failures, fraud_score=risk_score, details=reject_details)

    except Exception as exc:
        try:
            db.rollback()
        except Exception:
            pass
        if _is_ocr_unavailable(exc):
            verification_details, failures = _reject_for_ocr_unavailable(db, payment_id, participant_id, sha256_hash=sha256_hash)
            verification_result = {
                "status": "rejected_fraud",
                "verified": True,
                "failure_reasons": failures,
            }
            _finalize_attempt("rejected", detected_app="unknown", failures=failures, fraud_score=_calculate_fraud_score(failures, confidence=0))
        else:
            verification_result = {
                "status": "error",
                "verified": False,
                "error": "verification_failed",
            }
            _finalize_attempt(
                "error",
                failures=["verification_failed"],
                fraud_score=_calculate_fraud_score(["verification_failed"]),
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
    row = db.execute(text("""
        SELECT p.id, p.participant_id, p.amount, p.status, f.object_key, f.sha256
        FROM payments p
        JOIN payment_files f ON f.payment_id = p.id
        WHERE p.public_id = :pid
        FOR UPDATE
    """), {"pid": payment_public_id}).fetchone()

    if not row:
        return create_error_response("PAYMENT_NOT_FOUND")

    payment_id, participant_id, amount, current_status, object_key, existing_sha256 = row

    try:
        ensure_payment_status_transition(current_status, "processing")
    except StateTransitionError:
        return create_error_response("PAYMENT_INVALID_STATE")

    db.execute(text("""
        UPDATE payments
        SET status = 'processing', updated_at = CURRENT_TIMESTAMP
        WHERE id = :pid AND status = :current_status
    """), {"pid": payment_id, "current_status": current_status})

    try:
        image = fetch_s3_image(object_key)
        extracted_text, confidence = extract_text_with_confidence(image)
    except Exception as e:
        if _is_ocr_unavailable(e):
            verification_details, failures = _reject_for_ocr_unavailable(
                db, payment_id, participant_id, sha256_hash=existing_sha256
            )
            return jsonify({
                "status": "rejected_fraud",
                "detected_app": "unknown",
                "failure_reasons": failures,
                "auto_rejected": True,
                "verification_details": verification_details,
            })
        return create_error_response("SYS_SERVICE_UNAVAILABLE")

    is_valid, detected_app, failures = verify_payment_screenshot(
        image, extracted_text, amount, confidence, UPI_NAME
    )
    detected_app = detected_app or "unknown"
    filtered_text = sanitize_extracted_text_for_storage(extracted_text, detected_app)

    verification_details = {
        "ocr_confidence": confidence,
        "failure_reasons": failures,
        "extracted_text_length": len(extracted_text) if extracted_text else 0,
        "uploaded_sha256": existing_sha256,
    }

    target_status = "success" if is_valid else "rejected_fraud"
    try:
        ensure_payment_status_transition("processing", target_status)
    except StateTransitionError:
        return create_error_response("PAYMENT_INVALID_STATE")

    db.execute(text("""
        UPDATE payments
        SET extracted_text = :txt,
            fraud_score = :fs,
            verified_at = CURRENT_TIMESTAMP,
            status = :status,
            detected_app = :app,
            verification_details = :details
        WHERE id = :pid
    """), {
        "txt": filtered_text,
        "fs": _calculate_fraud_score(failures, confidence=confidence),
        "status": target_status,
        "app": detected_app,
        "details": json.dumps(verification_details),
        "pid": payment_id,
    })

    for failure in failures:
        db.execute(text("""
            INSERT INTO payment_fraud_signals (
                payment_id, signal_type, signal_score, details
            ) VALUES (
                :pid, :type, :score, :details
            ) ON CONFLICT DO NOTHING
        """), {
            "pid": payment_id,
            "type": failure,
            "score": 100,
            "details": json.dumps({"reason": failure, "confidence": confidence}),
        })

    db.commit()
    if is_valid:
        emit_domain_event(
            db,
            event_type="payment_verified",
            correlation_id=None,
            participant_id=participant_id,
            payment_id=payment_id,
            payload={"detected_app": detected_app, "status": "success", "source": "internal_verify"},
        )
        return jsonify({"status": "success", "detected_app": detected_app})

    return jsonify({
        "status": "rejected_fraud",
        "detected_app": detected_app,
        "failure_reasons": failures,
    })
