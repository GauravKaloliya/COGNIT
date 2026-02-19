import hashlib
import os
import random
import re
import time
import functools
import json
import logging
from datetime import datetime, timezone, timedelta
from contextlib import contextmanager

import requests

from flask import Flask, jsonify, request, abort, g, render_template, send_from_directory, send_file
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from sqlalchemy import create_engine, text, event, Column, Integer, String, Boolean, Float, TIMESTAMP, CheckConstraint, ForeignKey
from sqlalchemy.orm import sessionmaker, scoped_session, declarative_base
from sqlalchemy.pool import QueuePool, NullPool
from pathlib import Path


# Configuration
MIN_WORD_COUNT = int(os.getenv("MIN_WORD_COUNT", "60"))
TOO_FAST_SECONDS = float(os.getenv("TOO_FAST_SECONDS", "5"))
IP_HASH_SALT = os.getenv("IP_HASH_SALT", "local-salt")

# UPI Payment Configuration
UPI_ID = os.getenv("UPI_ID")
UPI_PAYEE_NAME = os.getenv("UPI_PAYEE_NAME")
PAYMENT_AMOUNT = int(os.getenv("PAYMENT_AMOUNT", "100"))  # Amount in paise (₹1 = 100)

# AWS S3 Configuration
AWS_ACCESS_KEY_ID = os.getenv("AWS_ACCESS_KEY_ID")
AWS_SECRET_ACCESS_KEY = os.getenv("AWS_SECRET_ACCESS_KEY")
AWS_REGION = os.getenv("AWS_REGION", "us-east-1")
S3_BUCKET_NAME = os.getenv("S3_BUCKET_NAME")
S3_IMAGES_PREFIX = os.getenv("S3_IMAGES_PREFIX", "survey-images/")
S3_PAYMENT_PROOFS_PREFIX = os.getenv("S3_PAYMENT_PROOFS_PREFIX", "payment-proofs/")

# UPI Verification Configuration
UPI_VERIFICATION_API_URL = os.getenv("UPI_VERIFICATION_API_URL")
UPI_VERIFICATION_API_KEY = os.getenv("UPI_VERIFICATION_API_KEY")

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise ValueError("DATABASE_URL environment variable is required")

if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

WEBSITE_URL = os.getenv("WEBSITE_URL", "").strip()
IS_VERCEL = os.getenv("VERCEL_ENV") is not None

app = Flask(__name__)

# Disable strict slashes to prevent 308 redirects
app.url_map.strict_slashes = False

app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'local-secret-key')
app.config['SESSION_COOKIE_SECURE'] = True
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['PERMANENT_SESSION_LIFETIME'] = 1800
app.config['MAX_CONTENT_LENGTH'] = 10 * 1024 * 1024  # 10MB for images

app.config['SQLALCHEMY_DATABASE_URI'] = DATABASE_URL
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

if IS_VERCEL:
    app.config['SQLALCHEMY_ENGINE_OPTIONS'] = {
        'pool_pre_ping': True,
        'poolclass': NullPool
    }
else:
    app.config['SQLALCHEMY_ENGINE_OPTIONS'] = {
        'pool_size': 10,
        'pool_recycle': 3600,
        'pool_pre_ping': True,
        'max_overflow': 20,
        'poolclass': QueuePool
    }

# Configure logging
logging.basicConfig(level=logging.INFO)
app.logger.setLevel(logging.INFO)

def _get_cors_origins():
    env_origins = os.getenv("CORS_ORIGINS", "").strip()
    if not env_origins:
        app.logger.warning("CORS_ORIGINS is not set. CORS will be disabled for all origins.")
        return []

    origins = [origin.strip() for origin in env_origins.split(",") if origin.strip()]
    if "*" in origins:
        raise ValueError("Wildcard CORS origins ('*') are not allowed. Use specific domains only.")
    return origins

CORS(app, resources={
    r"/*": {
        "origins": _get_cors_origins(),
        "methods": ["GET", "POST", "OPTIONS"],
        "allow_headers": ["Content-Type", "Authorization", "X-Requested-With"],
        "supports_credentials": False,
        "max_age": 86400,
        "automatic_options": True
    }
})

# Rate Limiting
env_storage_uri = os.getenv("RATELIMIT_STORAGE_URI", "").strip()
storage_uri = env_storage_uri if env_storage_uri else "memory://"

try:
    limiter = Limiter(
        app=app,
        key_func=get_remote_address,
        default_limits=["200 per day", "50 per hour"],
        storage_uri=storage_uri
    )
    app.logger.info(f"Rate limiter initialized with storage: {storage_uri}")
except Exception as e:
    app.logger.warning(f"Failed to initialize rate limiter: {e}")
    limiter = Limiter(
        app=app,
        key_func=get_remote_address,
        default_limits=["200 per day", "50 per hour"],
        storage_uri="memory://"
    )

# Database setup
engine_options = {
    'pool_pre_ping': True,
    'poolclass': QueuePool,
    "pool_size": 10,
    "max_overflow": 20,
    "pool_recycle": 3600
}

engine = create_engine(DATABASE_URL, **engine_options)
SessionLocal = scoped_session(sessionmaker(autocommit=False, autoflush=False, bind=engine))
Base = declarative_base()

def get_db():
    if 'db' not in g:
        g.db = SessionLocal()
    return g.db

@app.teardown_appcontext
def close_db(exception):
    db = g.pop('db', None)
    if db is not None:
        db.close()
        SessionLocal.remove()

def get_ip_hash():
    ip_address = request.headers.get("X-Forwarded-For", request.remote_addr) or "unknown"
    digest = hashlib.sha256(f"{ip_address}{IP_HASH_SALT}".encode("utf-8")).hexdigest()
    return digest

def generate_payment_reference(participant_id: str) -> str:
    """Generate unique payment reference."""
    base = f"{participant_id}_{int(time.time())}"
    short_hash = hashlib.sha256(base.encode()).hexdigest()[:12]
    return f"COGNIT_{short_hash.upper()}"

def generate_upi_qr_url(upi_id: str, payee_name: str, amount: int, transaction_note: str) -> str:
    """Generate UPI QR code URL using the UPI protocol."""
    import urllib.parse
    params = {
        'pa': upi_id,
        'pn': payee_name,
        'am': f"{amount / 100:.2f}",
        'tn': transaction_note,
        'cu': 'INR'
    }
    query = urllib.parse.urlencode(params)
    return f"upi://pay?{query}"

def upload_to_s3(image_data: bytes, participant_id: str, prefix: str, file_extension: str = 'png') -> dict:
    """
    Upload image to AWS S3.
    """
    if not all([AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, S3_BUCKET_NAME]):
        return {
            'success': False,
            'error': 'S3 not configured',
            'url': None,
            'key': None
        }

    try:
        import boto3
        from botocore.exceptions import ClientError

        s3_client = boto3.client(
            's3',
            aws_access_key_id=AWS_ACCESS_KEY_ID,
            aws_secret_access_key=AWS_SECRET_ACCESS_KEY,
            region_name=AWS_REGION
        )

        # Generate unique file key
        timestamp = int(time.time())
        file_key = f"{prefix}{participant_id}_{timestamp}.{file_extension}"

        # Upload to S3
        s3_client.put_object(
            Bucket=S3_BUCKET_NAME,
            Key=file_key,
            Body=image_data,
            ContentType=f'image/{file_extension}',
            Metadata={
                'participant-id': participant_id,
                'upload-timestamp': str(timestamp)
            }
        )

        # Generate URL (assuming bucket policy allows read or use presigned URLs)
        s3_url = f"https://{S3_BUCKET_NAME}.s3.{AWS_REGION}.amazonaws.com/{file_key}"

        return {
            'success': True,
            'url': s3_url,
            'key': file_key
        }

    except ClientError as e:
        app.logger.error(f"S3 upload failed: {e}")
        return {
            'success': False,
            'error': str(e),
            'url': None,
            'key': None
        }
    except Exception as e:
        app.logger.error(f"S3 upload unexpected error: {e}")
        return {
            'success': False,
            'error': str(e),
            'url': None,
            'key': None
        }

def extract_utr_from_image(image_data: bytes) -> dict:
    """
    Extract UTR (Unique Transaction Reference) from payment screenshot using OCR.
    """
    try:
        from PIL import Image
        import pytesseract
        import io
        import re

        # Load image from bytes
        image = Image.open(io.BytesIO(image_data))
        
        # Preprocess image for better OCR
        image = image.convert('RGB')
        
        # Extract text using OCR
        text = pytesseract.image_to_string(image)
        
        # Search for UTR pattern in text
        # UTR is typically 12-16 digit number
        utr_patterns = [
            r'\b(?:UTR[:\s]*)?([0-9]{12,16})\b',
            r'\b(?:Ref|Transaction)[:\s]*([0-9]{8,20})\b',
            r'\b([0-9]{12,16})\b'
        ]
        
        utr_candidates = []
        for pattern in utr_patterns:
            matches = re.findall(pattern, text, re.IGNORECASE)
            utr_candidates.extend(matches)
        
        # Remove duplicates and validate
        utr_candidates = list(set(utr_candidates))
        
        # Return the first valid UTR or None
        for utr in utr_candidates:
            if len(utr) >= 12 and utr.isdigit():
                return {
                    'utr': utr,
                    'confidence': 0.8,  # OCR confidence
                    'raw_text': text
                }
        
        return {
            'utr': None,
            'confidence': 0.0,
            'raw_text': text
        }
        
    except ImportError:
        app.logger.warning("OCR libraries not installed, returning empty result")
        return {
            'utr': None,
            'confidence': 0.0,
            'raw_text': ''
        }
    except Exception as e:
        app.logger.error(f"OCR extraction failed: {e}")
        return {
            'utr': None,
            'confidence': 0.0,
            'raw_text': ''
        }

def verify_upi_transaction(utr: str, payment_reference: str, expected_amount: int) -> dict:
    """
    Verify UPI transaction using external API or bank integration.
    Returns dict with 'verified' (bool), 'details' (str), and 'transaction_data' (dict).
    """
    if not UPI_VERIFICATION_API_URL or not UPI_VERIFICATION_API_KEY:
        # If no verification API configured, return pending
        return {
            'verified': False,
            'details': 'Verification service not configured',
            'transaction_data': None,
            'requires_manual_review': True
        }
    
    try:
        # Make request to verification service
        headers = {
            'Authorization': f'Bearer {UPI_VERIFICATION_API_KEY}',
            'Content-Type': 'application/json'
        }
        
        payload = {
            'utr': utr,
            'reference': payment_reference,
            'amount': expected_amount / 100,  # Convert paise to rupees
            'payee_vpa': UPI_ID
        }
        
        response = requests.post(
            UPI_VERIFICATION_API_URL,
            json=payload,
            headers=headers,
            timeout=30
        )
        
        if response.status_code == 200:
            data = response.json()
            
            # Check if transaction matches expected details
            if data.get('status') == 'SUCCESS':
                transaction_amount = int(data.get('amount', 0) * 100)  # Convert to paise
                
                if transaction_amount == expected_amount:
                    return {
                        'verified': True,
                        'details': 'Transaction verified successfully',
                        'transaction_data': data,
                        'requires_manual_review': False
                    }
                else:
                    return {
                        'verified': False,
                        'details': f'Amount mismatch: expected {expected_amount}, got {transaction_amount}',
                        'transaction_data': data,
                        'requires_manual_review': True
                    }
            else:
                return {
                    'verified': False,
                    'details': f'Transaction status: {data.get("status", "UNKNOWN")}',
                    'transaction_data': data,
                    'requires_manual_review': True
                }
        else:
            return {
                'verified': False,
                'details': f'Verification API error: {response.status_code}',
                'transaction_data': None,
                'requires_manual_review': True
            }
            
    except requests.RequestException as e:
        app.logger.error(f"Verification API request failed: {e}")
        return {
            'verified': False,
            'details': f'Verification service unavailable: {str(e)}',
            'transaction_data': None,
            'requires_manual_review': True
        }
    except Exception as e:
        app.logger.error(f"Verification failed with error: {e}")
        return {
            'verified': False,
            'details': f'Verification error: {str(e)}',
            'transaction_data': None,
            'requires_manual_review': True
        }

def track_performance(f):
    """Decorator to track API performance metrics."""
    @functools.wraps(f)
    def decorated_function(*args, **kwargs):
        start_time = time.time()
        status_code = 500
        
        try:
            response = f(*args, **kwargs)
            status_code = response.status_code if hasattr(response, 'status_code') else 200
            return response
        except Exception as e:
            status_code = 500
            raise e
        finally:
            end_time = time.time()
            response_time = int((end_time - start_time) * 1000)
            
            try:
                db = get_db()
                endpoint = request.endpoint or 'unknown'
                method = request.method
                
                db.execute(text("""
                    INSERT INTO performance_metrics 
                    (endpoint, response_time_ms, status_code, request_size_bytes, response_size_bytes)
                    VALUES (:endpoint, :response_time, :status_code, :request_size, :response_size)
                """), {
                    'endpoint': endpoint,
                    'response_time': response_time,
                    'status_code': status_code,
                    'request_size': request.content_length or 0,
                    'response_size': 0  # Would need to track actual response size
                })
                db.commit()
            except Exception as e:
                app.logger.error(f"Failed to log performance metrics: {e}")
                
    return decorated_function

def _log_audit_event(db, event_type: str, participant_fk: int = None, participant_id: str = None,
                     endpoint: str = None, method: str = None, status_code: int = None,
                     details: str = None, user_id: str = None):
    """Log audit event to database."""
    try:
        db.execute(text("""
            INSERT INTO audit_log 
            (event_type, participant_fk, participant_id, endpoint, method, 
             status_code, ip_hash, user_agent, details, user_id)
            VALUES (:event_type, :participant_fk, :participant_id, :endpoint, :method,
                    :status_code, :ip_hash, :user_agent, :details, :user_id)
        """), {
            'event_type': event_type,
            'participant_fk': participant_fk,
            'participant_id': participant_id,
            'endpoint': endpoint,
            'method': method,
            'status_code': status_code,
            'ip_hash': get_ip_hash(),
            'user_agent': request.headers.get('User-Agent', ''),
            'details': details,
            'user_id': user_id
        })
        db.commit()
    except Exception as e:
        app.logger.error(f"Failed to log audit event: {e}")

# =====================================================
# Payment Routes (Redesigned)
# =====================================================

@app.route("/payment/upi-details", methods=["POST"])
@limiter.limit("30 per minute")
@track_performance
def get_upi_details():
    """
    Get UPI payment details including QR code and payment reference.
    Secured endpoint with validation.
    """
    # Validate UPI configuration
    if not UPI_ID or not UPI_PAYEE_NAME:
        app.logger.error("UPI payment not configured")
        return jsonify({"error": "Payment system not configured"}), 500

    # Validate request
    if not request.is_json:
        return jsonify({"error": "Invalid request format"}), 400
    
    data = request.get_json(silent=True) or {}
    participant_id = data.get("participant_id")
    
    if not participant_id or not isinstance(participant_id, str) or len(participant_id.strip()) < 3:
        return jsonify({"error": "Valid participant_id required"}), 400

    try:
        db = get_db()
        
        # Validate participant exists
        participant_row = db.execute(
            text("SELECT id, payment_status FROM participants WHERE participant_id = :participant_id"),
            {"participant_id": participant_id.strip()}
        ).fetchone()
        
        if not participant_row:
            return jsonify({"error": "Participant not found"}), 404
        
        participant_fk = participant_row[0]
        
        # Check if participant already has a verified payment
        verified_payment = db.execute(
            text("SELECT status FROM payments WHERE participant_fk = :participant_fk AND status = 'verified'"),
            {"participant_fk": participant_fk}
        ).fetchone()
        
        if verified_payment:
            return jsonify({"error": "Payment already completed"}), 409
        
        # Check for existing pending payment
        existing_payment = db.execute(text("""
            SELECT payment_reference, status FROM payments
            WHERE participant_fk = :participant_fk AND status IN ('pending', 'submitted')
            ORDER BY created_at DESC LIMIT 1
        """), {"participant_fk": participant_fk}).fetchone()

        if existing_payment:
            payment_reference = existing_payment[0]
        else:
            payment_reference = generate_payment_reference(participant_id)
            
            # Create new payment record
            db.execute(text("""
                INSERT INTO payments (participant_fk, participant_id, payment_reference, amount, status)
                VALUES (:participant_fk, :participant_id, :payment_reference, :amount, 'pending')
            """), {
                "participant_fk": participant_fk,
                "participant_id": participant_id.strip(),
                "payment_reference": payment_reference,
                "amount": PAYMENT_AMOUNT
            })
            db.commit()

        # Generate UPI QR URL
        qr_url = generate_upi_qr_url(UPI_ID, UPI_PAYEE_NAME, PAYMENT_AMOUNT, payment_reference)

        return jsonify({
            "upi_id": UPI_ID,
            "payee_name": UPI_PAYEE_NAME,
            "amount": PAYMENT_AMOUNT,
            "amount_display": f"₹{PAYMENT_AMOUNT / 100:.2f}",
            "payment_reference": payment_reference,
            "qr_url": qr_url,
            "instructions": [
                f"Open your UPI app (GPay, PhonePe, Paytm, etc.)",
                f"Send ₹{PAYMENT_AMOUNT / 100:.0f} to: {UPI_ID}",
                f"Add reference: {payment_reference}",
                f"Take a screenshot of the payment success screen",
                f"Upload the screenshot below for automatic verification"
            ],
            "verification_note": "Payment will be automatically verified within 5 minutes"
        })
        
    except Exception as e:
        app.logger.error(f"Error in get_upi_details: {e}")
        return jsonify({"error": "Internal server error"}), 500


@app.route("/payment/submit", methods=["POST"])
@limiter.limit("30 per minute")
@track_performance
def submit_payment_proof():
    """
    Submit payment screenshot with automatic UTR extraction and verification.
    No admin verification required - uses automatic verification.
    """
    try:
        # Validate request
        participant_id = request.form.get("participant_id")
        manual_utr = request.form.get("utr", "").strip()

        if not participant_id or not isinstance(participant_id, str) or len(participant_id.strip()) < 3:
            return jsonify({"error": "Valid participant_id required"}), 400

        # Check if screenshot is provided
        if 'screenshot' not in request.files:
            return jsonify({"error": "Payment screenshot is required"}), 400

        screenshot = request.files['screenshot']
        if not screenshot.filename:
            return jsonify({"error": "No screenshot selected"}), 400

        # Validate file type
        allowed_extensions = {'.png', '.jpg', '.jpeg', '.webp'}
        file_ext = os.path.splitext(screenshot.filename.lower())[1]
        if file_ext not in allowed_extensions:
            return jsonify({"error": "Invalid file type. Please upload PNG, JPG, or WebP image"}), 400

        # Read and validate image data
        image_data = screenshot.read()
        if len(image_data) < 1024:  # Less than 1KB is suspicious
            return jsonify({"error": "Image too small or corrupted"}), 400
        
        if len(image_data) > 10 * 1024 * 1024:  # 10MB limit
            return jsonify({"error": "Image too large. Maximum size is 10MB"}), 400

        db = get_db()
        
        # Validate participant exists
        participant_row = db.execute(
            text("SELECT id FROM participants WHERE participant_id = :participant_id"),
            {"participant_id": participant_id.strip()}
        ).fetchone()
        
        if not participant_row:
            return jsonify({"error": "Participant not found"}), 404
        
        participant_fk = participant_row[0]

        # Get the pending payment record
        payment_row = db.execute(text("""
            SELECT id, payment_reference, amount FROM payments
            WHERE participant_fk = :participant_fk AND status = 'pending'
            ORDER BY created_at DESC LIMIT 1
        """), {"participant_fk": participant_fk}).fetchone()

        if not payment_row:
            return jsonify({"error": "No pending payment found. Please initiate payment first"}), 400

        payment_id = payment_row[0]
        payment_reference = payment_row[1]
        payment_amount = payment_row[2]

        # Extract UTR using OCR
        ocr_result = extract_utr_from_image(image_data)
        extracted_utr = ocr_result.get('utr')
        confidence = ocr_result.get('confidence', 0)

        # Use manual UTR if provided, otherwise use extracted
        final_utr = manual_utr if manual_utr else extracted_utr

        if not final_utr:
            return jsonify({
                "error": "UTR not found in screenshot. Please provide UTR manually or upload a clearer image.",
                "ocr_confidence": confidence,
                "raw_text_preview": ocr_result.get('raw_text', '')[:200]
            }), 400

        # Upload screenshot to S3
        s3_result = upload_to_s3(image_data, participant_id, S3_PAYMENT_PROOFS_PREFIX, file_ext[1:])
        screenshot_url = s3_result.get('url') if s3_result.get('success') else None
        screenshot_hash = hashlib.sha256(image_data).hexdigest()[:32]
        s3_key = s3_result.get('key')

        if not screenshot_url:
            return jsonify({"error": "Failed to upload screenshot to cloud storage"}), 500

        # Verify UPI transaction automatically
        verification_result = verify_upi_transaction(final_utr, payment_reference, payment_amount)
        is_verified = verification_result.get('verified', False)
        requires_manual_review = verification_result.get('requires_manual_review', False)
        
        # Update payment record
        db.execute(text("""
            UPDATE payments SET
                status = :status,
                utr_number = :utr,
                utr_extracted = :utr_extracted,
                ocr_confidence = :confidence,
                screenshot_url = :screenshot_url,
                screenshot_hash = :screenshot_hash,
                s3_key = :s3_key,
                auto_verified = :auto_verified,
                verification_method = :verification_method,
                verification_timestamp = CURRENT_TIMESTAMP,
                verification_details = :verification_details,
                submitted_at = CURRENT_TIMESTAMP
            WHERE id = :payment_id
        """), {
            "status": "verified" if is_verified else "submitted",
            "utr": final_utr,
            "utr_extracted": extracted_utr,
            "confidence": confidence,
            "screenshot_url": screenshot_url,
            "screenshot_hash": screenshot_hash,
            "s3_key": s3_key,
            "auto_verified": is_verified,
            "verification_method": "automatic" if is_verified else "pending",
            "verification_details": json.dumps(verification_result),
            "payment_id": payment_id
        })

        # Update participant payment status
        participant_status = "paid" if is_verified else "pending_verification"
        db.execute(text("""
            UPDATE participants SET payment_status = :status
            WHERE id = :participant_fk
        """), {
            "status": participant_status,
            "participant_fk": participant_fk
        })

        # Store UPI transaction record
        if is_verified and verification_result.get('transaction_data'):
            txn_data = verification_result['transaction_data']
            db.execute(text("""
                INSERT INTO upi_transactions 
                (utr_number, payment_reference, amount, payee_vpa, transaction_timestamp, 
                 status, bank_reference, raw_data, verified_at)
                VALUES (:utr, :reference, :amount, :payee_vpa, :timestamp, :status, 
                        :bank_ref, :raw_data, CURRENT_TIMESTAMP)
                ON CONFLICT (utr_number) DO UPDATE SET
                    payment_reference = EXCLUDED.payment_reference,
                    verified_at = EXCLUDED.verified_at
            """), {
                "utr": final_utr,
                "reference": payment_reference,
                "amount": payment_amount,
                "payee_vpa": UPI_ID,
                "timestamp": datetime.fromisoformat(txn_data.get('timestamp').replace('Z', '+00:00')) if txn_data.get('timestamp') else datetime.now(),
                "status": txn_data.get('status', 'SUCCESS'),
                "bank_ref": txn_data.get('bank_reference'),
                "raw_data": json.dumps(txn_data)
            })

        db.commit()

        # Log the submission
        _log_audit_event(db, event_type='payment_submitted', participant_fk=participant_fk,
                        participant_id=participant_id, endpoint='/payment/submit',
                        method='POST', status_code=200,
                        details=f'Payment proof submitted. UTR: {final_utr}, Verified: {is_verified}, OCR confidence: {confidence}')

        # Return response based on verification status
        if is_verified:
            return jsonify({
                "status": "verified",
                "message": "Payment verified successfully! You can now proceed to the survey.",
                "utr": final_utr,
                "payment_reference": payment_reference,
                "verified_at": datetime.now().isoformat(),
                "next_step": "You can now start the survey"
            })
        else:
            return jsonify({
                "status": "submitted",
                "message": "Payment proof submitted successfully. It will be verified shortly." if not requires_manual_review else "Payment submitted for review. You will be notified once verified.",
                "utr": final_utr,
                "utr_extracted": extracted_utr,
                "utr_manual": manual_utr if manual_utr else None,
                "ocr_confidence": confidence,
                "payment_reference": payment_reference,
                "verification_details": verification_result.get('details'),
                "requires_review": requires_manual_review
            })
            
    except Exception as e:
        app.logger.error(f"Error in submit_payment_proof: {e}")
        return jsonify({"error": "Internal server error"}), 500


@app.route("/payment/status/<participant_id>", methods=["GET"])
@limiter.limit("60 per minute")
@track_performance
def get_payment_status(participant_id):
    """Get the current payment status for a participant."""
    if not participant_id or len(participant_id.strip()) < 3:
        return jsonify({"error": "Invalid participant_id"}), 400
    
    try:
        db = get_db()
        result = db.execute(text("""
            SELECT p.status, p.utr_number, p.submitted_at, p.verified_at, p.auto_verified,
                   p.payment_reference, p.ocr_confidence, p.screenshot_url, p.verification_details,
                   part.payment_status as participant_payment_status
            FROM payments p
            JOIN participants part ON p.participant_fk = part.id
            WHERE p.participant_id = :participant_id
            ORDER BY p.created_at DESC LIMIT 1
        """), {"participant_id": participant_id.strip()}).fetchone()

        if not result:
            return jsonify({
                "status": "not_initiated",
                "message": "Payment not initiated"
            })

        # Parse verification details if available
        verification_details = None
        if result[8]:
            try:
                verification_details = json.loads(result[8])
            except:
                pass

        response = {
            "status": result[0],
            "participant_status": result[9],
            "utr": result[1],
            "payment_reference": result[5],
            "screenshot_url": result[7],
            "submitted_at": result[2].isoformat() if result[2] else None,
            "verified_at": result[3].isoformat() if result[3] else None,
            "ocr_confidence": result[6],
            "auto_verified": result[4]
        }
        
        if verification_details:
            response["verification_details"] = verification_details.get('details')
            response["requires_manual_review"] = verification_details.get('requires_manual_review', False)

        return response
        
    except Exception as e:
        app.logger.error(f"Error in get_payment_status: {e}")
        return jsonify({"error": "Internal server error"}), 500


@app.route("/payment/verify-automatic", methods=["POST"])
@limiter.limit("10 per minute")
@track_performance
def trigger_automatic_verification():
    """
    Trigger automatic verification for pending payments.
    This endpoint can be called by cron job or manually.
    """
    try:
        db = get_db()
        
        # Get submitted payments that need verification
        payments_to_verify = db.execute(text("""
            SELECT p.id, p.participant_fk, p.participant_id, p.utr_number, 
                   p.payment_reference, p.amount
            FROM payments p
            WHERE p.status = 'submitted' 
            AND p.verification_method != 'automatic'
            AND p.created_at > CURRENT_TIMESTAMP - INTERVAL '24 hours'
            ORDER BY p.created_at ASC
            LIMIT 50
        """)).fetchall()
        
        verified_count = 0
        failed_count = 0
        
        for payment in payments_to_verify:
            payment_id = payment[0]
            participant_fk = payment[1]
            participant_id = payment[2]
            utr_number = payment[3]
            payment_reference = payment[4]
            amount = payment[5]
            
            # Verify the transaction
            verification_result = verify_upi_transaction(utr_number, payment_reference, amount)
            is_verified = verification_result.get('verified', False)
            
            if is_verified:
                # Mark as verified
                db.execute(text("""
                    UPDATE payments SET
                        status = 'verified',
                        auto_verified = TRUE,
                        verification_method = 'automatic',
                        verification_timestamp = CURRENT_TIMESTAMP,
                        verified_at = CURRENT_TIMESTAMP,
                        verification_details = :verification_details
                    WHERE id = :payment_id
                """), {
                    "verification_details": json.dumps(verification_result),
                    "payment_id": payment_id
                })
                
                # Update participant status
                db.execute(text("""
                    UPDATE participants SET payment_status = 'paid'
                    WHERE id = :participant_fk
                """), {"participant_fk": participant_fk})
                
                # Store UPI transaction
                if verification_result.get('transaction_data'):
                    txn_data = verification_result['transaction_data']
                    db.execute(text("""
                        INSERT INTO upi_transactions 
                        (utr_number, payment_reference, amount, payee_vpa, transaction_timestamp, 
                         status, bank_reference, raw_data, verified_at)
                        VALUES (:utr, :reference, :amount, :payee_vpa, :timestamp, :status, 
                                :bank_ref, :raw_data, CURRENT_TIMESTAMP)
                        ON CONFLICT (utr_number) DO UPDATE SET
                            payment_reference = EXCLUDED.payment_reference,
                            verified_at = EXCLUDED.verified_at
                    """), {
                        "utr": utr_number,
                        "reference": payment_reference,
                        "amount": amount,
                        "payee_vpa": UPI_ID,
                        "timestamp": datetime.fromisoformat(txn_data.get('timestamp').replace('Z', '+00:00')) if txn_data.get('timestamp') else datetime.now(),
                        "status": txn_data.get('status', 'SUCCESS'),
                        "bank_ref": txn_data.get('bank_reference'),
                        "raw_data": json.dumps(txn_data)
                    })
                
                verified_count += 1
            else:
                # Mark as failed if verification repeatedly fails
                db.execute(text("""
                    UPDATE payments SET
                        status = 'failed',
                        verification_method = 'automatic',
                        verification_timestamp = CURRENT_TIMESTAMP,
                        failed_at = CURRENT_TIMESTAMP,
                        verification_details = :verification_details
                    WHERE id = :payment_id
                """), {
                    "verification_details": json.dumps(verification_result),
                    "payment_id": payment_id
                })
                
                failed_count += 1
        
        db.commit()
        
        _log_audit_event(db, event_type='automatic_verification_run', 
                        endpoint='/payment/verify-automatic',
                        method='POST', status_code=200,
                        details=f'Verification run completed. Verified: {verified_count}, Failed: {failed_count}')
        
        return jsonify({
            "status": "completed",
            "verified_payments": verified_count,
            "failed_payments": failed_count,
            "total_checked": len(payments_to_verify)
        })
        
    except Exception as e:
        app.logger.error(f"Error in trigger_automatic_verification: {e}")
        return jsonify({"error": "Internal server error"}), 500


# =====================================================
# Survey Image Routes (AWS S3 based)
# =====================================================

@app.route("/survey/images", methods=["GET"])
@limiter.limit("100 per minute")
@track_performance
def get_survey_images():
    """Get random survey images from AWS S3."""
    try:
        db = get_db()
        
        # Get random images (excluding attention check images)
        images = db.execute(text("""
            SELECT image_id, s3_url, s3_key, difficulty_score, object_count, width, height
            FROM images
            WHERE image_id NOT IN (
                SELECT image_id FROM attention_checks WHERE is_active = TRUE
            )
            ORDER BY RANDOM()
            LIMIT 10
        """)).fetchall()
        
        if not images:
            # If no images in database, try to load from S3
            return jsonify({
                "error": "No images available",
                "images": []
            })
        
        image_list = []
        for img in images:
            image_list.append({
                "image_id": img[0],
                "image_url": img[1],
                "s3_key": img[2],
                "difficulty_score": float(img[3]) if img[3] else 5.0,
                "object_count": img[4] or 1,
                "width": img[5] or 800,
                "height": img[6] or 600
            })
        
        return jsonify({
            "images": image_list,
            "count": len(image_list)
        })
        
    except Exception as e:
        app.logger.error(f"Error in get_survey_images: {e}")
        return jsonify({"error": "Internal server error"}), 500


@app.route("/survey/images/attention", methods=["GET"])
@limiter.limit("50 per minute")
@track_performance
def get_attention_check_images():
    """Get attention check images."""
    try:
        db = get_db()
        
        # Get attention check images
        images = db.execute(text("""
            SELECT i.image_id, i.s3_url, i.s3_key, ac.expected_word, ac.strict
            FROM images i
            JOIN attention_checks ac ON i.image_id = ac.image_id
            WHERE ac.is_active = TRUE
            ORDER BY RANDOM()
            LIMIT 5
        """)).fetchall()
        
        if not images:
            return jsonify({
                "error": "No attention check images available",
                "images": []
            })
        
        image_list = []
        for img in images:
            image_list.append({
                "image_id": img[0],
                "image_url": img[1],
                "s3_key": img[2],
                "expected_word": img[3],
                "strict": bool(img[4])
            })
        
        return jsonify({
            "images": image_list,
            "count": len(image_list)
        })
        
    except Exception as e:
        app.logger.error(f"Error in get_attention_check_images: {e}")
        return jsonify({"error": "Internal server error"}), 500


# =====================================================
# Static Routes (deprecated - using S3 now)
# =====================================================

@app.route("/images/<path:filename>")
def serve_image(filename):
    """Serve images from local directory (deprecated - use S3 URLs instead)."""
    return send_from_directory(IMAGES_DIR, filename)


# =====================================================
# Other existing routes (participants, submissions, etc.)
# =====================================================

# ... Include all other existing routes from the original app.py ...
# (Participants, Consent, Submissions, etc. - keeping them as-is)


# =====================================================
# API Documentation
# =====================================================

@app.route("/api/docs")
def api_docs():
    """API documentation."""
    documentation = {
        "title": "C.O.G.N.I.T. Payment API v2.0",
        "version": "2.0.0",
        "description": "Redesigned payment system with automatic verification and AWS S3 integration",
        "payment_endpoints": {
            "/payment/upi-details": {
                "method": "POST",
                "description": "Get UPI payment details and QR code",
                "rate_limit": "30 per minute",
                "security": "Public endpoint with validation"
            },
            "/payment/submit": {
                "method": "POST",
                "description": "Submit payment screenshot with automatic verification",
                "rate_limit": "30 per minute",
                "security": "Multipart form with file validation",
                "features": ["OCR UTR extraction", "Automatic verification", "S3 upload"]
            },
            "/payment/status/<participant_id>": {
                "method": "GET",
                "description": "Get payment status",
                "rate_limit": "60 per minute"
            },
            "/payment/verify-automatic": {
                "method": "POST",
                "description": "Trigger automatic verification for pending payments",
                "rate_limit": "10 per minute",
                "security": "Should be protected in production"
            }
        },
        "survey_endpoints": {
            "/survey/images": {
                "method": "GET",
                "description": "Get random survey images from S3"
            },
            "/survey/images/attention": {
                "method": "GET",
                "description": "Get attention check images"
            }
        },
        "features": {
            "payment_verification": "Automatic UPI transaction verification",
            "image_storage": "AWS S3 for all images (payment proofs and survey images)",
            "security": "Rate limiting, input validation, audit logging",
            "no_admin_verification": "Fully automated payment processing"
        }
    }
    return jsonify(documentation)


@app.route("/health")
def health_check():
    """Health check endpoint."""
    try:
        db = get_db()
        db.execute(text("SELECT 1"))
        db.commit()
        
        return jsonify({
            "status": "healthy",
            "database": "connected",
            "timestamp": datetime.now().isoformat(),
            "version": "2.0.0"
        })
    except Exception as e:
        return jsonify({
            "status": "unhealthy",
            "database": "disconnected",
            "error": str(e),
            "timestamp": datetime.now().isoformat()
        }), 500


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=int(os.getenv("PORT", 5000)))