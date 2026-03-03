"""
Payment Flow State Machine & Middleware
Server-side enforcement of payment flow with strict state transitions
"""

import functools
from datetime import datetime, timezone
from flask import request, jsonify, g
from sqlalchemy import text
import json

def error_response(error_code, message=None, details=None):
    """Standardized error response"""
    from app import ERROR_CODES
    
    error_info = ERROR_CODES.get(error_code, ERROR_CODES["SYS_INTERNAL_ERROR"])
    return jsonify({
        "error": error_code,
        "message": message or error_info["message"],
        "details": details
    }), error_info["status"]

def require_payment_completed(f):
    """
    Decorator to ensure payment is completed before allowing access
    Must be applied to routes that require payment verification
    """
    @functools.wraps(f)
    def decorated_function(*args, **kwargs):
        # Get public_id from request
        public_id = None
        if request.is_json and request.json:
            public_id = request.json.get('public_id')
        elif request.args:
            public_id = request.args.get('public_id')
        
        if not public_id:
            return error_response("VAL_MISSING_FIELDS", fields=["public_id"])
        
        from app.database import get_db
        db = get_db()
        
        # Get participant with payment status
        result = db.execute(text("""
            SELECT payment_status, current_stage, is_deleted
            FROM participants 
            WHERE public_id = :pub
        """), {"pub": public_id}).fetchone()
        
        if not result:
            return error_response("NF_PARTICIPANT")
        
        payment_status, current_stage, is_deleted = result
        
        if is_deleted:
            return error_response("AUTH_PARTICIPANT_DELETED")
        
        if payment_status != 'paid':
            # Log unauthorized access attempt
            try:
                db.execute(text("""
                    INSERT INTO audit_log (
                        event_type, participant_id, details, ip_hash, user_agent
                    ) VALUES (
                        'unauthorized_access_attempt', 
                        (SELECT id FROM participants WHERE public_id = :pub),
                        :details,
                        :ip_hash,
                        :ua
                    )
                """), {
                    "pub": public_id,
                    "details": json.dumps({
                        "route": request.endpoint,
                        "reason": "payment_not_completed",
                        "current_payment_status": payment_status
                    }),
                    "ip_hash": getattr(g, 'ip_hash', ''),
                    "ua": request.headers.get("User-Agent", "")[:512]
                })
                db.commit()
            except:
                pass
            
            return error_response("AUTH_PAYMENT_REQUIRED", 
                                message="Payment must be completed before accessing this feature")
        
        return f(*args, **kwargs)
    
    return decorated_function

def require_valid_payment_session(f):
    """
    Decorator to validate payment session state
    Ensures payment sessions are valid and not expired
    """
    @functools.wraps(f)
    def decorated_function(*args, **kwargs):
        payment_public_id = kwargs.get('payment_public_id')
        
        if not payment_public_id:
            return error_response("VAL_MISSING_FIELDS", fields=["payment_public_id"])
        
        from app.database import get_db
        db = get_db()
        
        # Get payment details
        result = db.execute(text("""
            SELECT status, expires_at, timer_activated_at, participant_id, amount
            FROM payments 
            WHERE public_id = :pid
        """), {"pid": payment_public_id}).fetchone()
        
        if not result:
            return error_response("NF_PAYMENT")
        
        status, expires_at, timer_activated_at, participant_id, amount = result
        
        # Check if payment is in valid state for the current action
        current_route = request.endpoint
        valid_states = []
        
        if 'upload_url' in current_route or 'upload-url' in current_route:
            # Can generate upload URL for pending payments only
            valid_states = ['pending']
        elif 'finalize' in current_route:
            # Can finalize pending payments
            valid_states = ['pending']
        elif 'upload' in current_route:
            # Can upload to pending payments
            valid_states = ['pending']
        else:
            valid_states = ['pending', 'processing', 'success']
        
        if status not in valid_states:
            return error_response("PAY_INVALID_STATE", 
                                details=f"Payment in state '{status}', required: {valid_states}")
        
        # Validate timer expiration
        if expires_at and datetime.now(timezone.utc) > expires_at:
            # Mark as expired if not already
            if status == 'pending':
                db.execute(text("""
                    UPDATE payments 
                    SET status = 'expired', updated_at = :now
                    WHERE public_id = :pid
                """), {
                    "pid": payment_public_id,
                    "now": datetime.now(timezone.utc)
                })
                db.commit()
            
            return error_response("PAY_EXPIRED", 
                                message="Payment session has expired. Please start a new payment.")
        
        # Validate amount matches expected
        expected_amount = 1  # ₹1 as configured
        if amount != expected_amount:
            return error_response("PAY_AMOUNT_MISMATCH",
                                details=f"Expected {expected_amount}, got {amount}")
        
        # Check for rapid payment attempts (potential abuse)
        if status == 'pending':
            recent_attempts = db.execute(text("""
                SELECT COUNT(*) 
                FROM payment_audit_log
                WHERE payment_id = (SELECT id FROM payments WHERE public_id = :pid)
                  AND event_type = 'payment_upload_attempt'
                  AND created_at > :recent_time
            """), {
                "pid": payment_public_id,
                "recent_time": datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
            }).fetchone()
            
            if recent_attempts and recent_attempts[0] > 5:
                return error_response("RATE_PAYMENT_ATTEMPTS", 
                                    message="Too many payment attempts. Please wait before trying again.")
        
        return f(*args, **kwargs)
    
    return decorated_function

def require_valid_stage_transition(f):
    """
    Decorator to validate stage transitions
    Ensures participants follow the correct flow order
    """
    @functools.wraps(f)
    def decorated_function(*args, **kwargs):
        # Get public_id from request
        public_id = None
        if request.is_json and request.json:
            public_id = request.json.get('public_id')
        elif request.args:
            public_id = request.args.get('public_id')
        
        if not public_id:
            return error_response("VAL_MISSING_FIELDS", fields=["public_id"])
        
        from app.database import get_db
        db = get_db()
        
        # Get current stage
        result = db.execute(text("""
            SELECT current_stage, payment_status
            FROM participants 
            WHERE public_id = :pub
        """), {"pub": public_id}).fetchone()
        
        if not result:
            return error_response("NF_PARTICIPANT")
        
        current_stage, payment_status = result
        
        # Define valid stage transitions
        valid_transitions = {
            "consent": ["user-details"],
            "user-details": ["payment-content", "user-details"],  # Allow staying on same stage
            "payment-content": ["payment-link"],
            "payment-link": ["payment", "survey"],
            "payment": ["payment", "survey"],
            "survey": ["finished"],
            "finished": []
        }
        
        # Get target stage from request or route
        target_stage = None
        if request.is_json and request.json:
            target_stage = request.json.get('target_stage')
        
        # For some routes, target stage is determined by the action
        if request.endpoint == 'create_payment':
            target_stage = "payment-content"
        elif request.endpoint == 'generate_upload_url':
            target_stage = "payment-link"
        elif request.endpoint == 'finalize_payment_upload':
            target_stage = "payment-link"  # Stays on payment until successful
        elif request.endpoint == 'submit':
            target_stage = "survey"
        elif request.endpoint == 'finish_participant':
            target_stage = "finished"
        
        if not target_stage:
            target_stage = current_stage  # Default to current stage
        
        # Validate transition
        if target_stage not in valid_transitions.get(current_stage, []):
            return error_response("VAL_INVALID_STAGE_TRANSITION",
                                details={
                                    "current_stage": current_stage,
                                    "target_stage": target_stage,
                                    "valid_transitions": valid_transitions.get(current_stage, [])
                                })
        
        # Additional validation for payment-related stages
        if current_stage in ["payment-content", "payment-link"] and payment_status == 'pending':
            # Ensure payment is in progress
            payment_check = db.execute(text("""
                SELECT COUNT(*) FROM payments 
                WHERE participant_id = (SELECT id FROM participants WHERE public_id = :pub)
                  AND status IN ('pending', 'processing')
            """), {"pub": public_id}).fetchone()
            
            if not payment_check or payment_check[0] == 0:
                return error_response("PAY_REQUIRED",
                                    message="Payment must be initiated before continuing")
        
        # Update stage if transitioning
        if target_stage != current_stage:
            db.execute(text("""
                UPDATE participants 
                SET current_stage = :target, stage_updated_at = :now
                WHERE public_id = :pub
            """), {
                "target": target_stage,
                "now": datetime.now(timezone.utc),
                "pub": public_id
            })
        
        return f(*args, **kwargs)
    
    return decorated_function

def log_payment_flow_event(event_type, participant_id=None, payment_id=None, details=None):
    """Log payment flow events for audit trail"""
    try:
        db = getattr(g, 'db', None)
        if not db:
            return
        
        audit_data = {
            "route": request.endpoint if request else None,
            "method": request.method if request else None,
            "ip": g.get('ip_hash', ''),
            "device_fingerprint": g.get('device_fingerprint', ''),
            "user_agent": request.headers.get('User-Agent', '') if request else None,
            **(details or {})
        }
        
        db.execute(text("""
            INSERT INTO payment_audit_log (
                event_type, participant_id, payment_id, 
                ip_hash, user_agent, device_fingerprint,
                request_data, details
            ) VALUES (
                :ev, :pid, :payid, :iph, :ua, :df, :req, :det
            )
        """), {
            "ev": event_type,
            "pid": participant_id,
            "payid": payment_id,
            "iph": g.get('ip_hash', ''),
            "ua": request.headers.get('User-Agent', '') if request else None,
            "df": g.get('device_fingerprint', ''),
            "req": json.dumps(audit_data.get('request_data', {})),
            "det": json.dumps(audit_data.get('details', {}))[:8000]
        })
        
    except Exception as e:
        print(f"[ERROR] Audit logging error: {e}", flush=True)
