"""
Payment flow middleware used by user-facing routes.
"""

import functools
import json
from datetime import datetime, timezone

from flask import request, g
from sqlalchemy import text

from app.utils.helpers import create_error_response, get_ip_hash
from app.utils.security import verify_payment_write_token
from app.constants.participant_constants import PARTICIPANT_PAYMENT_STATUS_PAID
from app.constants.payment_constants import (
    PAYMENT_STATUS_EXPIRED,
    PAYMENT_STATUS_PENDING,
    PAYMENT_STATUS_PROCESSING,
    PAYMENT_STATUS_SUCCESS,
)


def require_payment_completed(f):
    """Ensure payment is completed before allowing access."""

    @functools.wraps(f)
    def decorated_function(*args, **kwargs):
        public_id = None
        if request.is_json and request.json:
            public_id = request.json.get("public_id")
        elif request.args:
            public_id = request.args.get("public_id")

        if not public_id:
            return create_error_response("VAL_MISSING_FIELDS", fields=["public_id"])

        from app.database import get_db

        db = get_db()

        result = db.execute(text("""
            SELECT payment_status, is_deleted, email_verified
            FROM participants
            WHERE public_id = :pub
        """), {"pub": public_id}).fetchone()

        if not result:
            return create_error_response("NF_PARTICIPANT")

        payment_status, is_deleted, email_verified = result

        if is_deleted:
            return create_error_response("AUTH_ACCOUNT_DEACTIVATED")

        if not email_verified:
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
                        "reason": "email_not_verified",
                        "current_payment_status": payment_status,
                    }),
                    "ip_hash": get_ip_hash(),
                    "ua": request.headers.get("User-Agent", "")[:512],
                })
                db.commit()
            except Exception:
                pass

            return create_error_response("AUTH_EMAIL_NOT_VERIFIED")

        if payment_status != PARTICIPANT_PAYMENT_STATUS_PAID:
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
                    "ip_hash": get_ip_hash(),
                    "ua": request.headers.get("User-Agent", "")[:512],
                })
                db.commit()
            except Exception:
                pass

            return create_error_response("PAY_NOT_VERIFIED")

        return f(*args, **kwargs)

    return decorated_function


def require_valid_payment_session(
    _func=None,
    *,
    require_write_token: bool = False,
    allowed_states=None,
    skip_expiry_check: bool = False,
):
    """Validate payment session state and expiry before payment actions."""

    def decorator(f):
        @functools.wraps(f)
        def decorated_function(*args, **kwargs):
            payment_public_id = kwargs.get("payment_public_id")

            if not payment_public_id:
                return create_error_response("VAL_MISSING_FIELDS", fields=["payment_public_id"])

            from app.database import get_db

            db = get_db()

            result = db.execute(text("""
                SELECT p.status, p.expires_at, p.participant_id, p.signature, pr.session_id, p.metadata
                FROM payments p
                JOIN participants pr ON pr.id = p.participant_id
                WHERE p.public_id = :pid
            """), {"pid": payment_public_id}).fetchone()

            if not result:
                return create_error_response("NF_PAYMENT")

            status, expires_at, participant_id, payment_signature, participant_session_id, payment_metadata = result

            if require_write_token:
                valid_states = allowed_states if allowed_states else [PAYMENT_STATUS_PENDING]

                auth_header = (request.headers.get("Authorization") or "").strip()
                token = ""
                if auth_header.lower().startswith("bearer "):
                    token = auth_header[7:].strip()
                if not token:
                    token = (request.headers.get("X-Payment-Token") or "").strip()
                claims = verify_payment_write_token(token)
                if not claims:
                    return create_error_response("AUTH_INVALID_PAYMENT_TOKEN")
                if (
                    str(claims.get("sub")) != str(payment_public_id)
                    or int(claims.get("pid", 0) or 0) != int(participant_id)
                    or str(claims.get("sig") or "") != str(payment_signature or "")
                ):
                    return create_error_response("AUTH_INVALID_PAYMENT_TOKEN")
                token_fingerprint = str(claims.get("dfp") or "")
                request_fingerprint = str(getattr(g, "device_fingerprint", None) or "")
                if token_fingerprint and request_fingerprint and token_fingerprint != request_fingerprint:
                    return create_error_response("AUTH_INVALID_PAYMENT_TOKEN")
                token_session = str(claims.get("sid") or "")
                if token_session and str(participant_session_id or "") and token_session != str(participant_session_id):
                    return create_error_response("AUTH_INVALID_PAYMENT_TOKEN")
                expected_nonce = ""
                if isinstance(payment_metadata, dict):
                    expected_nonce = str(payment_metadata.get("payment_write_nonce") or "")
                else:
                    try:
                        import json
                        md = json.loads(payment_metadata or "{}")
                        expected_nonce = str(md.get("payment_write_nonce") or "")
                    except Exception:
                        expected_nonce = ""
                token_nonce = str(claims.get("nonce") or "")
                if expected_nonce and token_nonce != expected_nonce:
                    return create_error_response("AUTH_INVALID_PAYMENT_TOKEN")
            else:
                valid_states = [PAYMENT_STATUS_PENDING, PAYMENT_STATUS_PROCESSING, PAYMENT_STATUS_SUCCESS]

            if status not in valid_states:
                return create_error_response(
                    "PAY_INVALID_STATE",
                    details={"current_status": status, "required_statuses": valid_states},
                )

            if not skip_expiry_check and expires_at and datetime.now(timezone.utc) > expires_at:
                if status == PAYMENT_STATUS_PENDING:
                    db.execute(text("""
                        UPDATE payments
                        SET status = :expired, updated_at = :now
                        WHERE public_id = :pid
                    """), {
                        "pid": payment_public_id,
                        "expired": PAYMENT_STATUS_EXPIRED,
                        "now": datetime.now(timezone.utc),
                    })
                    db.commit()

                return create_error_response(
                    "PAY_EXPIRED",
                )

            return f(*args, **kwargs)

        return decorated_function

    if _func is not None:
        return decorator(_func)
    return decorator
