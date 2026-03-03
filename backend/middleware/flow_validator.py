"""
Flow Validator Middleware
Comprehensive flow validation and security enforcement
"""

import hashlib
import re
from datetime import datetime, timezone
from flask import request, g
from sqlalchemy import text

def get_ip_hash():
    """Get hashed IP address for privacy"""
    ip = request.headers.get('X-Real-IP') or request.headers.get('X-Forwarded-For', request.remote_addr).split(',')[0].strip()
    salt = "cognit_ip_salt_2024"
    return hashlib.sha256(f"{ip}{salt}".encode()).hexdigest()

def validate_required_fields(data, required_fields):
    """Validate that required fields are present in request"""
    missing = [field for field in required_fields if field not in data or data[field] is None]
    if missing:
        return False, missing
    return True, []

def validate_payment_timer(payment_row, client_claimed_time=None):
    """
    Server-side timer validation
    Strictly enforces payment expiration time
    """
    if not payment_row:
        return False, "Payment not found"
    
    status, expires_at = payment_row[0], payment_row[1]
    
    # If payment is already expired
    if expires_at and datetime.now(timezone.utc) > expires_at:
        if status == 'pending':
            return False, "Payment session has expired"
    
    # If client claims a time, validate it doesn't exceed server time
    if client_claimed_time:
        try:
            client_time = datetime.fromisoformat(client_claimed_time.replace('Z', '+00:00'))
            if client_time > datetime.now(timezone.utc):
                return False, "Invalid client timestamp"
            
            # Also check against payment expiry
            if expires_at and client_time > expires_at:
                return False, "Payment timer exceeded"
        except:
            pass  # Ignore invalid timestamp format
    
    return True, None

def check_global_duplicate_screenshot(db, sha256_hash, exclude_participant_id=None):
    """
    Check for duplicate screenshots across ALL users in the system
    This prevents cross-user screenshot reuse fraud
    """
    query = """
        SELECT pf.id, pf.payment_id, p.participant_id, p.status, p.created_at
        FROM payment_files pf
        JOIN payments p ON pf.payment_id = p.id
        WHERE pf.sha256 = :hash
    """
    
    params = {"hash": sha256_hash}
    
    if exclude_participant_id:
        query += " AND p.participant_id != :exclude_pid"
        params["exclude_pid"] = exclude_participant_id
    
    result = db.execute(text(query), params).fetchall()
    
    if result:
        return True, [{
            "payment_file_id": row[0],
            "payment_id": row[1],
            "participant_id": row[2],
            "status": row[3],
            "uploaded_at": row[4].isoformat() if row[4] else None
        } for row in result]
    
    return False, []

def detect_upi_app(text_content):
    """
    Detect UPI app from OCR text content
    """
    text_lower = text_content.lower()
    
    app_patterns = {
        "gpay": [r'\bgpay\b', r'\bgoogle\s*pay\b', r'\btez\b', r'\bgooglepay\b'],
        "paytm": [r'\bpaytm\b'],
        "bhim": [r'\bbhim\b'],
    }
    
    for app, patterns in app_patterns.items():
        for pattern in patterns:
            if re.search(pattern, text_lower):
                return app
    
    return None

def validate_screenshot_metadata(image):
    """
    Validate screenshot metadata for authenticity
    """
    issues = []
    
    try:
        # Check image dimensions (should be reasonable for mobile screenshot)
        width, height = image.size
        
        if width < 600 or height < 600:
            issues.append(f"Resolution too low: {width}x{height}")
        
        if width > 4000 or height > 4000:
            issues.append(f"Resolution too high: {width}x{height}")
        
        # Check for extreme aspect ratios (not typical for screenshots)
        aspect_ratio = width / height
        if aspect_ratio < 0.5 or aspect_ratio > 2.5:
            issues.append(f"Unusual aspect ratio: {aspect_ratio:.2f}")
        
    except Exception as e:
        issues.append(f"Metadata validation error: {str(e)}")
    
    return len(issues) == 0, issues

def analyze_fraud_signals(db, participant_id, payment_data, device_data=None):
    """
    Comprehensive fraud signal analysis
    Returns fraud score and detected signals
    """
    signals = []
    fraud_score = 0
    
    # Signal 1: Device risk score (from device fingerprinting)
    if device_data and device_data.get('risk_score', 0) > 50:
        fraud_score += device_data['risk_score']
        signals.append(f"high_device_risk: {device_data['risk_score']}")
    
    # Signal 2: Rapid payment attempts
    recent_payments = db.execute(text("""
        SELECT COUNT(*) FROM payments
        WHERE participant_id = :pid
          AND created_at > :recent
    """), {
        "pid": participant_id,
        "recent": datetime.now(timezone.utc) - timedelta(hours=1)
    }).fetchone()
    
    if recent_payments and recent_payments[0] > 3:
        fraud_score += 20
        signals.append("rapid_payment_attempts")
    
    # Signal 3: Multiple failed payments
    failed_payments = db.execute(text("""
        SELECT COUNT(*) FROM payments
        WHERE participant_id = :pid
          AND status = 'failed'
    """), {"pid": participant_id}).fetchone()
    
    if failed_payments and failed_payments[0] > 2:
        fraud_score += 15
        signals.append("multiple_failed_payments")
    
    # Signal 4: Suspicious IP patterns
    ip_count = db.execute(text("""
        SELECT COUNT(DISTINCT pf.uploaded_by_ip_hash)
        FROM payments p
        JOIN payment_files pf ON pf.payment_id = p.id
        WHERE p.participant_id = :pid
          AND pf.uploaded_by_ip_hash IS NOT NULL
    """), {"pid": participant_id}).fetchone()
    
    if ip_count and ip_count[0] > 2:
        fraud_score += 10
        signals.append("multiple_ip_addresses")
    
    # Signal 5: Check for known fraud patterns in device
    if device_data:
        risk_signals = device_data.get('risk_signals', [])
        for signal in risk_signals:
            if signal in ['headless_browser', 'proxy_detected']:
                fraud_score += 25
                signals.append(f"device_signal: {signal}")
    
    # Normalize score to 0-100
    fraud_score = min(fraud_score, 100)
    
    return fraud_score, signals

# Import timedelta for the fraud analysis function
from datetime import timedelta

def rate_limit_by_participant(identifier, limit=10, window_seconds=3600):
    """
    Simple rate limiting by participant
    Returns (is_allowed, retry_after)
    """
    from flask import g
    
    db = getattr(g, 'db', None)
    if not db:
        return True, None
    
    # Check recent requests
    since = datetime.now(timezone.utc) - timedelta(seconds=window_seconds)
    
    result = db.execute(text("""
        SELECT COUNT(*) FROM audit_log
        WHERE participant_id = (
            SELECT id FROM participants WHERE public_id = :pub
        )
        AND created_at > :since
        AND event_type LIKE 'rate_limit_%'
    """), {"pub": identifier, "since": since}).fetchone()
    
    count = result[0] if result else 0
    
    if count >= limit:
        return False, window_seconds
    
    return True, None
