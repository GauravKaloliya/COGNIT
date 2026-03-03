"""
Payment routes module for C.O.G.N.I.T. backend.
Handles payment creation, screenshot upload, verification, and status.
"""

import base64
import json
import re
from datetime import datetime, timedelta, timezone
from io import BytesIO

from flask import jsonify, request, current_app
from sqlalchemy import text
import qrcode
from PIL import Image

from app.config import PAYMENT_EXPIRY_SECONDS, UPI_NAME
from app.extensions import limiter
from app.database import get_db
from app.utils.helpers import (
    log_audit,
    create_error_response,
    validate_image_extension,
    get_ip_hash,
)
from app.utils.security import (
    generate_payment_signature,
    generate_upi_link,
)
from app.utils.ocr import (
    fetch_s3_image,
    extract_text_with_confidence,
    verify_payment_screenshot,
    OCRServiceUnavailableError,
    TesseractNotFoundError,
    OCRServiceError,
)
from app.utils.fraud import (
    check_duplicate_screenshot,
    check_rejected_screenshot,
)
from app.utils.decorators import track_performance
from app.extensions import s3, app
from app.config import S3_BUCKET_NAME


# ────────────────────────────────────────────────
# Blueprint Setup
# ────────────────────────────────────────────────

from flask import Blueprint
payment_bp = Blueprint('payment', __name__)


def _is_ocr_unavailable(error: Exception) -> bool:
    """Check if the error indicates OCR service is unavailable."""
    return (
        isinstance(error, (OCRServiceUnavailableError, TesseractNotFoundError))
        or "OCRServiceUnavailableError" in type(error).__name__
        or "TesseractNotFoundError" in type(error).__name__
        or "ocr unavailable" in str(error).lower()
        or "textract client" in str(error).lower()
        or "aws credentials" in str(error).lower()
        or "rate limited" in str(error).lower()
        or "connection error" in str(error).lower()
    )


def _reject_for_ocr_unavailable(db, payment_id: int, participant_id: int):
    failures = ["ocr_unavailable"]
    verification_details = {
        "ocr_confidence": 0,
        "failure_reasons": failures,
        "extracted_text_length": 0
    }

    db.execute(text("""
        UPDATE payments
        SET extracted_text = '',
            fraud_score = :fs,
            verified_at = CURRENT_TIMESTAMP,
            status = 'rejected_fraud',
            detected_app = NULL,
            auto_rejected = true,
            verification_details = :details
        WHERE id = :pid
    """), {
        "fs": len(failures) * 10,
        "details": json.dumps(verification_details),
        "pid": payment_id
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
        "details": json.dumps({"reason": "ocr_unavailable"})
    })

    log_audit(db, "payment_ocr_unavailable", participant_id=participant_id,
              details=f"Payment {payment_id} auto-rejected due to missing OCR")
    db.commit()
    return verification_details, failures


# Import middleware if available
try:
    from middleware import require_valid_payment_session
except ImportError:
    def require_valid_payment_session(f):
        return f


# ────────────────────────────────────────────────
# Routes
# ────────────────────────────────────────────────

@payment_bp.route("/payments/create", methods=["POST"])
@limiter.limit("20 per minute")
@track_performance
def create_payment():
    """Create a new payment session with timer."""
    data = request.json or {}
    public_id = data.get("public_id")
    amount = data.get("amount")

    if not public_id or not amount:
        return create_error_response("MISSING_FIELDS", {"fields": ["public_id", "amount"]})

    try:
        amount = round(float(amount), 2)
        if amount <= 0:
            raise ValueError
    except:
        return create_error_response("INVALID_AMOUNT")

    try:
        db = get_db()
    except Exception as e:
        print(f"[ERROR] create_payment failed - db connection: {e}", flush=True)
        return create_error_response("INTERNAL_ERROR", custom_message="Payment creation failed. Please try again.")

    row = db.execute(text("""
        SELECT id FROM participants
        WHERE public_id = :pub AND is_deleted = false
    """), {"pub": public_id}).fetchone()

    if not row:
        return create_error_response("PARTICIPANT_NOT_FOUND")

    participant_id = row[0]

    # Mark any existing pending/processing payments as failed
    db.execute(text("""
        UPDATE payments
        SET status = 'failed',
            updated_at = CURRENT_TIMESTAMP
        WHERE participant_id = :pid
          AND status IN ('pending', 'processing')
    """), {"pid": participant_id})

    # Timer starts immediately when payment is created
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=PAYMENT_EXPIRY_SECONDS)
    expires_str = expires_at.isoformat()

    signature = generate_payment_signature(public_id, str(amount), expires_str)

    try:
        payment_row = db.execute(text("""
            INSERT INTO payments (
                participant_id, amount, signature, expires_at, timer_activated_at
            ) VALUES (
                :pid, :amt, :sig, :exp, :timer_time
            )
            RETURNING public_id
        """), {
            "pid": participant_id,
            "amt": amount,
            "sig": signature,
            "exp": expires_at,
            "timer_time": datetime.now(timezone.utc)
        }).fetchone()

        # Generate UPI note identifier
        upi_note = f"COGNIT {payment_row[0]}"

        db.commit()

        # Generate UPI link and QR code
        upi_link = generate_upi_link(amount, upi_note)
        
        print(f"[INFO] Payment created: {payment_row[0]} for participant {public_id[:8]}...", flush=True)

        qr = qrcode.make(upi_link)
        buffer = BytesIO()
        qr.save(buffer, format="PNG")
        qr_base64 = base64.b64encode(buffer.getvalue()).decode()

        return jsonify({
            "payment_id": str(payment_row[0]),
            "amount": amount,
            "expires_at": expires_str,
            "signature": signature,
            "upi_link": upi_link,
            "upi_note": upi_note,
            "qr_base64": qr_base64,
            "timer_activated": True,
            "time_remaining_seconds": PAYMENT_EXPIRY_SECONDS
        })

    except Exception as e:
        try:
            db.rollback()
        except:
            pass
        print(f"[ERROR] Payment creation failed: {e}", flush=True)
        return create_error_response("INTERNAL_ERROR", custom_message="Payment creation failed. Please try again.")


@payment_bp.route("/payments/<payment_public_id>/upload-url", methods=["GET", "POST", "OPTIONS"])
@require_valid_payment_session
@limiter.limit("20 per minute")
@track_performance
def get_payment_upload_url(payment_public_id):
    """Return a presigned S3 upload URL for payment screenshots (legacy flow)."""
    if request.method == "OPTIONS":
        return "", 204

    data = request.json or {}
    file_extension = (
        data.get("file_extension")
        or request.args.get("file_extension")
        or "jpg"
    ).lower().strip(".")
    sha256_hash = (
        data.get("sha256")
        or data.get("sha256_hash")
        or request.args.get("sha256")
        or request.args.get("sha256_hash")
    )
    file_size = data.get("file_size") or request.args.get("file_size")

    if not sha256_hash:
        return create_error_response("MISSING_FIELDS", {"fields": ["sha256"]})

    if not re.match(r"^[a-f0-9]{64}$", sha256_hash):
        return create_error_response("INVALID_SHA256")

    is_valid_ext, ext, content_type = validate_image_extension(f"file.{file_extension}")
    if not is_valid_ext:
        return create_error_response("INVALID_IMAGE_TYPE", {"allowed": ["jpg", "jpeg", "png", "webp"]})

    try:
        db = get_db()
    except Exception as e:
        print(f"[ERROR] get_payment_upload_url failed - db connection: {e}", flush=True)
        return create_error_response("INTERNAL_ERROR", custom_message="Payment upload preparation failed. Please try again.")

    row = db.execute(text("""
        SELECT id, participant_id, status, expires_at
        FROM payments
        WHERE public_id = :pid
        FOR UPDATE
    """), {"pid": payment_public_id}).fetchone()

    if not row:
        return create_error_response("PAYMENT_NOT_FOUND")

    payment_id, participant_id, status, expires_at = row

    if expires_at and datetime.now(timezone.utc) > expires_at:
        db.execute(text("""
            UPDATE payments
            SET status = 'expired', updated_at = CURRENT_TIMESTAMP
            WHERE id = :pid
        """), {"pid": payment_id})
        db.commit()
        return create_error_response("PAYMENT_EXPIRED")

    if status != "pending":
        return create_error_response("PAYMENT_INVALID_STATE")

    is_duplicate, existing_payment_id = check_duplicate_screenshot(db, sha256_hash)
    if is_duplicate:
        log_audit(db, "fraud_detected_duplicate_image", participant_id=participant_id,
                  details=f"SHA256 {sha256_hash[:16]}... already exists in payment {existing_payment_id}")
        db.commit()
        return create_error_response("DUPLICATE_IMAGE")

    was_rejected = check_rejected_screenshot(db, sha256_hash)
    if was_rejected:
        log_audit(db, "fraud_detected_rejected_reuse", participant_id=participant_id,
                  details=f"SHA256 {sha256_hash[:16]}... was previously rejected")
        db.commit()
        return create_error_response("REJECTED_REUSE")

    object_key = f"payments/{payment_public_id}.{ext}"

    try:
        presigned_url = s3.generate_presigned_url(
            "put_object",
            Params={
                "Bucket": S3_BUCKET_NAME,
                "Key": object_key,
                "ContentType": content_type
            },
            ExpiresIn=300
        )
    except Exception as e:
        print(f"[ERROR] Failed to generate presigned URL: {e}", flush=True)
        return create_error_response("INTERNAL_ERROR", custom_message="Failed to prepare upload URL")

    try:
        db.execute(text("""
            INSERT INTO payment_files (
                payment_id, object_key, sha256, content_type, file_size, uploaded_by_ip_hash
            ) VALUES (
                :pid, :key, :hash, :content_type, :file_size, :ip_hash
            ) ON CONFLICT (payment_id)
            DO UPDATE SET
                object_key = EXCLUDED.object_key,
                sha256 = EXCLUDED.sha256,
                content_type = EXCLUDED.content_type,
                file_size = EXCLUDED.file_size,
                uploaded_by_ip_hash = EXCLUDED.uploaded_by_ip_hash,
                created_at = CURRENT_TIMESTAMP
        """), {
            "pid": payment_id,
            "key": object_key,
            "hash": sha256_hash,
            "content_type": content_type,
            "file_size": file_size,
            "ip_hash": get_ip_hash()
        })
        db.commit()
    except Exception as e:
        db.rollback()
        print(f"[ERROR] Failed to store upload metadata: {e}", flush=True)
        return create_error_response("INTERNAL_ERROR", custom_message="Failed to prepare upload")

    return jsonify({
        "upload_url": presigned_url,
        "object_key": object_key,
        "content_type": content_type,
        "expires_in": 300
    })


@payment_bp.route("/payments/<payment_public_id>/verify-upload", methods=["POST"])
@require_valid_payment_session
@limiter.limit("20 per minute")
@track_performance
def verify_and_upload_payment(payment_public_id):
    """
    Verify payment screenshot directly from uploaded file, then upload to S3 only if verified.
    
    This endpoint receives the image directly (base64 encoded), verifies it using Textract,
    and only uploads to S3 and saves to database if verification passes.
    
    Request body:
        - image_base64: Base64 encoded image data
        - file_extension: Image file extension (jpg, jpeg, png, webp)
        - sha256_hash: SHA256 hash of the original image file
    """
    data = request.json or {}
    image_base64 = data.get("image_base64")
    file_extension = data.get("file_extension", "jpg").lower().strip(".")
    sha256_hash = data.get("sha256")
    
    # Validate required fields
    if not image_base64:
        return create_error_response("MISSING_FIELDS", {"fields": ["image_base64"]})
    
    if not sha256_hash:
        return create_error_response("MISSING_FIELDS", {"fields": ["sha256"]})
    
    if not re.match(r"^[a-f0-9]{64}$", sha256_hash):
        return create_error_response("INVALID_SHA256")
    
    # Validate file extension
    is_valid_ext, ext, content_type = validate_image_extension(f"file.{file_extension}")
    if not is_valid_ext:
        return create_error_response("INVALID_IMAGE_TYPE", {"allowed": ["jpg", "jpeg", "png", "webp"]})
    
    # Decode base64 image
    try:
        # Remove data URL prefix if present
        if "," in image_base64:
            image_base64 = image_base64.split(",")[1]
        image_bytes = base64.b64decode(image_base64)
        image = Image.open(BytesIO(image_bytes))
    except Exception as e:
        print(f"[WARN] Failed to decode image: {e}", flush=True)
        return create_error_response("INVALID_FORMAT", {"field": "image_base64", "message": "Invalid image data"})
    
    try:
        db = get_db()
    except Exception as e:
        print(f"[ERROR] verify_and_upload_payment failed - db connection: {e}", flush=True)
        return create_error_response("INTERNAL_ERROR", custom_message="Payment verification failed. Please try again.")
    
    row = db.execute(text("""
        SELECT id, participant_id, status, expires_at
        FROM payments
        WHERE public_id = :pid
        FOR UPDATE
    """), {"pid": payment_public_id}).fetchone()
    
    if not row:
        return create_error_response("PAYMENT_NOT_FOUND")
    
    payment_id, participant_id, status, expires_at = row
    
    # Check if payment has expired
    if expires_at and datetime.now(timezone.utc) > expires_at:
        db.execute(text("""
            UPDATE payments
            SET status = 'expired', updated_at = CURRENT_TIMESTAMP
            WHERE id = :pid
        """), {"pid": payment_id})
        db.commit()
        return create_error_response("PAYMENT_EXPIRED")
    
    if status != "pending":
        return create_error_response("PAYMENT_INVALID_STATE")
    
    # Fraud Detection Checks (using hash before any S3 upload)
    # 1. Check if this screenshot was already uploaded
    is_duplicate, existing_payment_id = check_duplicate_screenshot(db, sha256_hash)
    if is_duplicate:
        log_audit(db, "fraud_detected_duplicate_image", participant_id=participant_id,
                  details=f"SHA256 {sha256_hash[:16]}... already exists in payment {existing_payment_id}")
        db.commit()
        return create_error_response("DUPLICATE_IMAGE")
    
    # 2. Check if this screenshot was previously rejected
    was_rejected = check_rejected_screenshot(db, sha256_hash)
    if was_rejected:
        log_audit(db, "fraud_detected_rejected_reuse", participant_id=participant_id,
                  details=f"SHA256 {sha256_hash[:16]}... was previously rejected")
        db.commit()
        return create_error_response("REJECTED_REUSE")
    
    # Run verification BEFORE uploading to S3
    verification_result = {"status": "processing", "verified": False}
    
    try:
        # Extract text directly from image bytes (not from S3)
        extracted_text, confidence = extract_text_with_confidence(image)
        
        # Get payment amount for verification
        payment_row = db.execute(text("""
            SELECT amount FROM payments WHERE id = :pid
        """), {"pid": payment_id}).fetchone()
        
        amount = payment_row[0] if payment_row else 1
        # Run strict validation
        is_valid, detected_app, failures = verify_payment_screenshot(
            image, extracted_text, amount, confidence, UPI_NAME
        )
        
        # Build verification details JSON
        verification_details = {
            "ocr_confidence": confidence,
            "failure_reasons": failures,
            "extracted_text_length": len(extracted_text) if extracted_text else 0
        }
        
        # ONLY upload to S3 and save to database if verification passed
        if is_valid:
            object_key = f"payments/{payment_public_id}.{ext}"
            
            # Upload to S3 only after verification passes
            try:
                s3.put_object(
                    Bucket=S3_BUCKET_NAME,
                    Key=object_key,
                    Body=image_bytes,
                    ContentType=content_type
                )
            except Exception as s3_error:
                print(f"[ERROR] Failed to upload verified payment to S3: {s3_error}", flush=True)
                db.rollback()
                return create_error_response("INTERNAL_ERROR", custom_message="Failed to save payment screenshot")
            
            # Save to payment_files table
            db.execute(text("""
                INSERT INTO payment_files (
                    payment_id, object_key, sha256
                ) VALUES (
                    :pid, :key, :hash
                )
            """), {
                "pid": payment_id,
                "key": object_key,
                "hash": sha256_hash
            })
            
            # Update payment status
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
                "txt": extracted_text,
                "fs": len(failures) * 10,
                "status": "success",
                "app": detected_app,
                "details": json.dumps(verification_details),
                "pid": payment_id
            })
            
            db.commit()
            verification_result = {
                "status": "success",
                "verified": True,
                "failure_reasons": []
            }
            print(f"[INFO] Payment verified successfully: {payment_public_id}", flush=True)
        else:
            # Verification FAILED - DO NOT upload to S3, DO NOT save to payment_files
            # Just update payment status to rejected
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
                "txt": extracted_text,
                "fs": len(failures) * 10,
                "status": "rejected_fraud",
                "app": detected_app,
                "details": json.dumps(verification_details),
                "pid": payment_id
            })
            
            # Insert fraud signals for each failure reason
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
                    "details": json.dumps({"reason": failure, "confidence": confidence})
                })
            
            db.commit()
            verification_result = {
                "status": "rejected_fraud",
                "verified": True,
                "failure_reasons": failures
            }
            print(f"[WARN] Payment rejected: {payment_public_id} - reasons: {failures}", flush=True)
    
    except Exception as e:
        try:
            db.rollback()
        except:
            pass
        if _is_ocr_unavailable(e):
            verification_details, failures = _reject_for_ocr_unavailable(db, payment_id, participant_id)
            verification_result = {
                "status": "rejected_fraud",
                "verified": True,
                "failure_reasons": failures
            }
            print(f"[WARN] OCR service not available - payment auto-rejected: {payment_public_id}", flush=True)
        else:
            print(f"[ERROR] Verification failed: {e}", flush=True)
            verification_result = {
                "status": "error",
                "verified": False,
                "error": "verification_failed"
            }
    
    return jsonify({"status": "processed", "verification": verification_result})


@payment_bp.route("/payments/<payment_public_id>/status", methods=["GET"])
@limiter.limit("30 per minute")
@track_performance
def get_payment_status(payment_public_id):
    """Get current payment status including expiry check."""
    try:
        db = get_db()

        row = db.execute(text("""
            SELECT p.id, p.participant_id, p.status, p.expires_at, p.amount, p.verified_at, p.verification_details, p.detected_app, p.auto_rejected
            FROM payments p
            WHERE p.public_id = :pid
        """), {"pid": payment_public_id}).fetchone()

        if not row:
            return create_error_response("PAYMENT_NOT_FOUND")

        payment_id, participant_id, status, expires_at, amount, verified_at, verification_details, detected_app, auto_rejected = row

        # Check if payment should be marked as expired
        now = datetime.now(timezone.utc)
        is_expired = expires_at and now > expires_at

        if is_expired and status in ("pending", "processing"):
            db.execute(text("""
                UPDATE payments
                SET status = 'expired', updated_at = CURRENT_TIMESTAMP
                WHERE id = :pid
            """), {"pid": payment_id})
            db.commit()
            status = "expired"

        response = {
            "payment_id": payment_public_id,
            "status": status,
            "amount": float(amount) if amount else None,
            "expires_at": expires_at.isoformat() if expires_at else None,
            "is_expired": status == "expired",
            "time_remaining_seconds": max(0, int((expires_at - now).total_seconds())) if expires_at and status in ("pending", "processing") else 0,
            "verified_at": verified_at.isoformat() if verified_at else None
        }

        if verification_details:
            response["verification_details"] = verification_details
        if detected_app:
            response["detected_app"] = detected_app
        if auto_rejected:
            response["auto_rejected"] = True

        return jsonify(response)
    except Exception as e:
        print(f"[ERROR] get_payment_status failed: {e}", flush=True)
        return create_error_response("DATABASE_ERROR")


@payment_bp.route("/internal/payments/<payment_public_id>/verify", methods=["POST"])
@limiter.exempt
def verify_payment(payment_public_id):
    """Internal endpoint for payment verification (no rate limit)."""
    try:
        db = get_db()
    except Exception as e:
        print(f"[ERROR] verify_payment failed - db connection: {e}", flush=True)
        return create_error_response("DATABASE_ERROR")

    row = db.execute(text("""
        SELECT p.id, p.participant_id, p.amount, f.object_key
        FROM payments p
        JOIN payment_files f ON f.payment_id = p.id
        WHERE p.public_id = :pid
        FOR UPDATE
    """), {"pid": payment_public_id}).fetchone()

    if not row:
        return create_error_response("PAYMENT_NOT_FOUND")

    payment_id, participant_id, amount, object_key = row
    try:
        image = fetch_s3_image(object_key)
        extracted_text, confidence = extract_text_with_confidence(image)
    except Exception as e:
        if _is_ocr_unavailable(e):
            verification_details, failures = _reject_for_ocr_unavailable(db, payment_id, participant_id)
            return jsonify({
                "status": "rejected_fraud",
                "detected_app": None,
                "failure_reasons": failures,
                "auto_rejected": True
            })
        print(f"[ERROR] Verification failed due to OCR error: {e}", flush=True)
        return create_error_response("SYS_SERVICE_UNAVAILABLE")

    # Run strict validation
    is_valid, detected_app, failures = verify_payment_screenshot(
        image, extracted_text, amount, confidence, UPI_NAME
    )

    # Build verification details JSON
    verification_details = {
        "ocr_confidence": confidence,
        "failure_reasons": failures,
        "extracted_text_length": len(extracted_text) if extracted_text else 0
    }

    if is_valid:
        new_status = "success"
    else:
        new_status = "rejected_fraud"

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
        "txt": extracted_text,
        "fs": len(failures) * 10,
        "status": new_status,
        "app": detected_app,
        "details": json.dumps(verification_details),
        "pid": payment_id
    })

    # Insert fraud signals for each failure reason
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
            "details": json.dumps({"reason": failure, "confidence": confidence})
        })

    db.commit()

    if is_valid:
        return jsonify({
            "status": "success",
            "detected_app": detected_app
        })
    else:
        return jsonify({
            "status": "rejected_fraud",
            "detected_app": detected_app,
            "failure_reasons": failures
        })
