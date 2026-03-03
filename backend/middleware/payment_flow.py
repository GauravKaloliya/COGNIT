"""
Payment flow middleware used by user-facing routes.
"""

import functools
import json
from datetime import datetime, timezone

from flask import request, g
from sqlalchemy import text

from app.config import BYPASS_PAYMENT_FLOW
from app.utils.helpers import create_error_response


def require_payment_completed(f):
    """Ensure payment is completed before allowing access."""

    @functools.wraps(f)
    def decorated_function(*args, **kwargs):
        if BYPASS_PAYMENT_FLOW:
            return f(*args, **kwargs)

        public_id = None
        if request.is_json and request.json:
            public_id = request.json.get("public_id")
        elif request.args:
            public_id = request.args.get("public_id")

        if not public_id:
            return create_error_response("VAL_MISSING_FIELDS", {"fields": ["public_id"]})

        from app.database import get_db

        db = get_db()

        result = db.execute(text("""
            SELECT payment_status, is_deleted
            FROM participants
            WHERE public_id = :pub
        """), {"pub": public_id}).fetchone()

        if not result:
            return create_error_response("NF_PARTICIPANT")

        payment_status, is_deleted = result

        if is_deleted:
            return create_error_response("AUTH_ACCOUNT_DEACTIVATED")

        if payment_status != "paid":
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
                        "current_payment_status": payment_status,
                    }),
                    "ip_hash": getattr(g, "ip_hash", ""),
                    "ua": request.headers.get("User-Agent", "")[:512],
                })
                db.commit()
            except Exception:
                pass

            return create_error_response(
                "PAYMENT_NOT_VERIFIED",
                custom_message="Payment must be completed before accessing this feature",
            )

        return f(*args, **kwargs)

    return decorated_function


def require_valid_payment_session(f):
    """Validate payment session state and expiry before payment actions."""

    @functools.wraps(f)
    def decorated_function(*args, **kwargs):
        payment_public_id = kwargs.get("payment_public_id")

        if not payment_public_id:
            return create_error_response("VAL_MISSING_FIELDS", {"fields": ["payment_public_id"]})

        from app.database import get_db

        db = get_db()

        result = db.execute(text("""
            SELECT status, expires_at, amount
            FROM payments
            WHERE public_id = :pid
        """), {"pid": payment_public_id}).fetchone()

        if not result:
            return create_error_response("NF_PAYMENT")

        status, expires_at, amount = result

        current_route = request.endpoint or ""
        if "upload" in current_route or "finalize" in current_route:
            valid_states = ["pending"]
        else:
            valid_states = ["pending", "processing", "success"]

        if status not in valid_states:
            return create_error_response(
                "PAY_INVALID_STATE",
                details=f"Payment in state '{status}', required: {valid_states}",
            )

        if expires_at and datetime.now(timezone.utc) > expires_at:
            if status == "pending":
                db.execute(text("""
                    UPDATE payments
                    SET status = 'expired', updated_at = :now
                    WHERE public_id = :pid
                """), {
                    "pid": payment_public_id,
                    "now": datetime.now(timezone.utc),
                })
                db.commit()

            return create_error_response(
                "PAY_EXPIRED",
                custom_message="Payment session has expired. Please start a new payment.",
            )

        expected_amount = 1
        if amount != expected_amount:
            return create_error_response(
                "PAY_INVALID_AMOUNT",
                details=f"Expected {expected_amount}, got {amount}",
            )

        return f(*args, **kwargs)

    return decorated_function
