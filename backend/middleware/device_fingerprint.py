"""
Device Fingerprinting Middleware
Comprehensive device tracking and risk scoring for fraud prevention
"""

import hashlib
import json
import time
from datetime import datetime, timezone
from flask import request, g
from sqlalchemy import text
import random
import string

def generate_canvas_fingerprint():
    """Generate a canvas-based fingerprint for browser detection"""
    try:
        # This would be implemented client-side in JavaScript
        # and sent to the server. For now, we'll use a simple hash
        # based on user agent and other available data
        canvas_data = f"{request.user_agent.string if request.user_agent else ''}{time.time()}"
        return hashlib.sha256(canvas_data.encode()).hexdigest()
    except:
        return hashlib.sha256(str(time.time()).encode()).hexdigest()

def collect_device_characteristics():
    """Collect device characteristics for fingerprinting"""
    characteristics = {
        'user_agent': request.headers.get('User-Agent', '')[:512],
        'accept_language': request.headers.get('Accept-Language', '')[:200],
        'accept_encoding': request.headers.get('Accept-Encoding', '')[:200],
        'remote_addr': request.remote_addr,
        'x_forwarded_for': request.headers.get('X-Forwarded-For', '')[:200],
        'x_real_ip': request.headers.get('X-Real-IP', '')[:200],
        'timestamp': int(time.time())
    }
    
    # Parse User-Agent for specific characteristics
    if request.user_agent:
        characteristics.update({
            'platform': request.user_agent.platform or '',
            'browser': request.user_agent.browser or '',
            'version': request.user_agent.version or '',
            'os': request.user_agent.os or ''
        })
    
    return characteristics

def generate_device_fingerprint(characteristics):
    """Generate a stable device fingerprint hash"""
    # Create a normalized string of key characteristics
    fingerprint_string = json.dumps({
        'ua': characteristics.get('user_agent', ''),
        'platform': characteristics.get('platform', ''),
        'browser': characteristics.get('browser', ''),
        'os': characteristics.get('os', ''),
        'lang': characteristics.get('accept_language', '')
    }, sort_keys=True)
    
    # Add salt for security
    salt = "cognit_fingerprint_salt_2024"
    salted_data = f"{fingerprint_string}{salt}"
    
    return hashlib.sha256(salted_data.encode()).hexdigest()

def calculate_risk_score(fingerprint_data, db, participant_id=None):
    """Calculate device risk score based on fingerprint characteristics"""
    risk_score = 0.0
    signals = []
    
    # Check for suspicious User-Agent patterns
    user_agent = fingerprint_data.get('user_agent', '').lower()
    if not user_agent or user_agent in ['curl', 'wget', 'bot', 'spider', 'crawler']:
        risk_score += 25
        signals.append('suspicious_user_agent')
    
    # Check for headless browsers
    if 'headless' in user_agent or 'phantom' in user_agent:
        risk_score += 30
        signals.append('headless_browser')
    
    # Check for rapid changes in fingerprint (device switching)
    if participant_id:
        previous_fingerprints = db.execute(text("""
            SELECT fingerprint_hash, created_at
            FROM device_fingerprints
            WHERE participant_id = :pid
            ORDER BY created_at DESC
            LIMIT 5
        """), {"pid": participant_id}).fetchall()
        
        current_fingerprint = generate_device_fingerprint(fingerprint_data)
        
        if len(previous_fingerprints) > 0:
            # Check for multiple different fingerprints in short time
            recent_hashes = [fp[0] for fp in previous_fingerprints]
            if current_fingerprint not in recent_hashes:
                risk_score += 20
                signals.append('device_fingerprint_change')
            
            # Check for too many different fingerprints
            unique_hashes = set(recent_hashes)
            if len(unique_hashes) > 3:
                risk_score += 15
                signals.append('multiple_device_switches')
    
    # Check for IP address patterns
    ip_address = fingerprint_data.get('remote_addr', '')
    if ip_address:
        # Check for proxy/VPN indicators
        if any(indicator in fingerprint_data.get('x_forwarded_for', '') for indicator in [',', 'proxy', 'vpn']):
            risk_score += 10
            signals.append('proxy_detected')
    
    # Normalize risk score (0-100)
    risk_score = min(risk_score, 100)
    
    return risk_score, signals

def get_or_create_device_fingerprint(db, participant_id=None):
    """Get existing or create new device fingerprint"""
    characteristics = collect_device_characteristics()
    fingerprint_hash = generate_device_fingerprint(characteristics)
    risk_score, risk_signals = calculate_risk_score(characteristics, db, participant_id)
    
    # Store or update fingerprint
    if participant_id:
        db.execute(text("""
            INSERT INTO device_fingerprints (
                participant_id, fingerprint_hash, fingerprint_data,
                risk_score, risk_signals, last_seen_at
            ) VALUES (
                :pid, :fph, :fpd, :rs, :rss, :now
            )
            ON CONFLICT (participant_id, fingerprint_hash)
            DO UPDATE SET
                last_seen_at = EXCLUDED.last_seen_at,
                risk_score = EXCLUDED.risk_score,
                risk_signals = EXCLUDED.risk_signals
        """), {
            "pid": participant_id,
            "fph": fingerprint_hash,
            "fpd": json.dumps(characteristics),
            "rs": risk_score,
            "rss": json.dumps(risk_signals),
            "now": datetime.now(timezone.utc)
        })
    
    return fingerprint_hash, risk_score, characteristics

def device_fingerprint_middleware():
    """Middleware to extract and store device fingerprint for each request"""
    try:
        # Get database connection from Flask g
        if hasattr(g, 'db'):
            db = g.db
            
            # Try to get participant_id from request context
            participant_id = None
            if request.is_json and request.json:
                public_id = request.json.get('public_id')
                if public_id:
                    result = db.execute(text("""
                        SELECT id FROM participants WHERE public_id = :pub
                    """), {"pub": public_id}).fetchone()
                    if result:
                        participant_id = result[0]
            elif request.args:
                public_id = request.args.get('public_id')
                if public_id:
                    result = db.execute(text("""
                        SELECT id FROM participants WHERE public_id = :pub
                    """), {"pub": public_id}).fetchone()
                    if result:
                        participant_id = result[0]
            
            # Get or create device fingerprint
            fingerprint_hash, risk_score, characteristics = get_or_create_device_fingerprint(db, participant_id)
            
            # Store in Flask g for access in route handlers
            g.device_fingerprint = fingerprint_hash
            g.device_risk_score = risk_score
            g.device_characteristics = characteristics
            
    except Exception as e:
        # Don't fail the request if fingerprinting fails
        # Log the error for debugging
        print(f"Device fingerprinting error: {e}")
        g.device_fingerprint = None
        g.device_risk_score = 0
        g.device_characteristics = {}