"""
Device Fingerprinting Middleware
Comprehensive device tracking and risk scoring for fraud prevention
"""

import hashlib
import logging
import json
import time
from datetime import datetime, timezone
from flask import request, g
from sqlalchemy import text

from app.config import DEVICE_FINGERPRINT_SALTS

_FINGERPRINT_HISTORY_CACHE = {}
_FINGERPRINT_HISTORY_CACHE_TTL_SECONDS = 300
logger = logging.getLogger(__name__)


def _should_run_fingerprinting() -> bool:
    path = (request.path or "").lower()
    # Restrict expensive fingerprint DB work to fraud-sensitive write flows.
    if request.method not in {"POST", "PUT", "PATCH", "DELETE"}:
        return False
    return path.startswith("/payments/") or path == "/submit"

def _resolve_participant_id(db):
    """Best-effort participant resolution across route styles."""
    if hasattr(g, "participant_id") and g.participant_id:
        return g.participant_id
    public_id = None
    payment_public_id = None

    json_payload = request.get_json(silent=True) or {}
    if request.is_json and json_payload:
        public_id = json_payload.get("public_id")
        payment_public_id = json_payload.get("payment_public_id")

    if not public_id and request.args:
        public_id = request.args.get("public_id")
    if not payment_public_id and request.args:
        payment_public_id = request.args.get("payment_public_id")

    view_args = getattr(request, "view_args", None) or {}
    if not public_id:
        public_id = view_args.get("public_id")
    if not payment_public_id:
        payment_public_id = (
            view_args.get("payment_public_id")
            or view_args.get("payment_id")
        )

    if public_id:
        row = db.execute(text("""
            SELECT id FROM participants
            WHERE public_id = :pub
        """), {"pub": public_id}).fetchone()
        if row:
            g.participant_id = row[0]
            return row[0]

    if payment_public_id:
        row = db.execute(text("""
            SELECT participant_id
            FROM payments
            WHERE public_id = :pid
        """), {"pid": payment_public_id}).fetchone()
        if row:
            g.participant_id = row[0]
            return row[0]

    return None


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

def _get_fingerprint_salts():
    raw = str(DEVICE_FINGERPRINT_SALTS or "").strip()
    if not raw:
        return ["cognit_fingerprint_salt_2024"]
    return [s.strip() for s in raw.split(",") if s.strip()] or ["cognit_fingerprint_salt_2024"]


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
    
    # Add salt for security (first salt is primary).
    salts = _get_fingerprint_salts()
    primary = salts[0]
    salted_data = f"{fingerprint_string}{primary}"
    return hashlib.sha256(salted_data.encode()).hexdigest()


def generate_device_fingerprint_variants(characteristics):
    """Generate hashes for current and previous salts to allow rotation windows."""
    fingerprint_string = json.dumps({
        'ua': characteristics.get('user_agent', ''),
        'platform': characteristics.get('platform', ''),
        'browser': characteristics.get('browser', ''),
        'os': characteristics.get('os', ''),
        'lang': characteristics.get('accept_language', '')
    }, sort_keys=True)
    variants = []
    for salt in _get_fingerprint_salts():
        salted_data = f"{fingerprint_string}{salt}"
        variants.append(hashlib.sha256(salted_data.encode()).hexdigest())
    return list(dict.fromkeys([v for v in variants if v]))

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
        now_ts = int(time.time())
        cache_entry = _FINGERPRINT_HISTORY_CACHE.get(int(participant_id))
        if cache_entry and (now_ts - int(cache_entry.get("fetched_at", 0))) <= _FINGERPRINT_HISTORY_CACHE_TTL_SECONDS:
            previous_fingerprints = cache_entry.get("rows", [])
        else:
            previous_fingerprints = db.execute(text("""
                SELECT fingerprint_hash, created_at
                FROM device_fingerprints
                WHERE participant_id = :pid
                ORDER BY created_at DESC
                LIMIT 5
            """), {"pid": participant_id}).fetchall()
            _FINGERPRINT_HISTORY_CACHE[int(participant_id)] = {
                "fetched_at": now_ts,
                "rows": previous_fingerprints,
            }
        
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
    fingerprint_variants = generate_device_fingerprint_variants(characteristics)
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
    
    return fingerprint_hash, fingerprint_variants, risk_score, characteristics

def device_fingerprint_middleware():
    """Middleware to extract and store device fingerprint for each request"""
    try:
        if not _should_run_fingerprinting():
            g.device_fingerprint = None
            g.device_risk_score = 0
            g.device_characteristics = {}
            g.device_fingerprint_written = False
            return

        # Get database connection from Flask g
        if hasattr(g, 'db'):
            db = g.db
            
            participant_id = _resolve_participant_id(db)
            
            # Get or create device fingerprint
            fingerprint_hash, fingerprint_variants, risk_score, characteristics = get_or_create_device_fingerprint(db, participant_id)
            
            # Store in Flask g for access in route handlers
            g.device_fingerprint = fingerprint_hash
            g.device_fingerprint_variants = fingerprint_variants
            g.device_risk_score = risk_score
            g.device_characteristics = characteristics
            g.device_fingerprint_written = bool(participant_id)
            
    except Exception as e:
        # Don't fail the request if fingerprinting fails
        logger.warning("device_fingerprint_error %s", e)
        g.device_fingerprint = None
        g.device_fingerprint_variants = []
        g.device_risk_score = 0
        g.device_characteristics = {}
