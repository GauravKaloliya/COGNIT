"""Email OTP request and verification orchestration."""

from __future__ import annotations

import logging
from dataclasses import dataclass

from sqlalchemy.exc import IntegrityError

from app.constants.response_keys import (
    RESPONSE_KEY_EMAIL,
    RESPONSE_KEY_EMAIL_VERIFIED,
    RESPONSE_KEY_EXPIRES_AT,
)
from app.services.email_otp_service import (
    build_email_otp_payload,
    email_in_use_by_other,
    enqueue_email_otp,
    fetch_latest_email_otp,
    fetch_participant_by_public_email,
    fetch_participant_by_public_id,
    generate_email_otp,
    hash_email_otp,
    increment_email_otp_attempts,
    insert_email_otp,
    mark_email_otp_used,
    mark_existing_otps_used,
    mark_participant_email_verified,
    otp_expiry_timestamp,
    otp_is_expired,
    otp_is_over_attempts,
    update_participant_email,
)
from app.services.participant_state_service import apply_participant_stage_event
from app.services.state_machine_service import PARTICIPANT_STAGE_EVENTS
from app.utils.helpers import create_error_response, success_response

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class EmailOtpWorkflowResult:
    response: object
    status_code: int


def request_email_otp_workflow(*, db, public_id: str, email: str, email_update: bool, request_id=None):
    participant_row = fetch_participant_by_public_id(db, public_id=public_id)
    if not participant_row:
        return EmailOtpWorkflowResult(create_error_response("AUTH_EMAIL_MISMATCH"), 403)

    participant_id, stored_email, email_verified, current_stage = participant_row
    if stored_email == email and email_update:
        return EmailOtpWorkflowResult(create_error_response("AUTH_EMAIL_SAME"), 400)

    if stored_email != email:
        if email_in_use_by_other(db, public_id=public_id, email=email):
            return EmailOtpWorkflowResult(create_error_response("DUP_EMAIL"), 409)
        try:
            update_participant_email(db, participant_id=int(participant_id), email=email)
            next_stage = apply_participant_stage_event(
                db,
                participant_id=int(participant_id),
                current_stage=current_stage,
                event=PARTICIPANT_STAGE_EVENTS["email_changed"],
            )
            stored_email = email
            email_verified = False
            current_stage = next_stage
        except IntegrityError as exc:
            err = str(exc).lower()
            if "check constraint" in err:
                return EmailOtpWorkflowResult(create_error_response("VAL_EMAIL_INVALID"), 400)
            if "duplicate key" in err or "unique constraint" in err:
                return EmailOtpWorkflowResult(create_error_response("DUP_EMAIL"), 409)
            return EmailOtpWorkflowResult(create_error_response("SYS_EMAIL_OTP_REQUEST_FAILED"), 500)

    if email_verified:
        return EmailOtpWorkflowResult(success_response({
            RESPONSE_KEY_EMAIL: stored_email,
            RESPONSE_KEY_EMAIL_VERIFIED: True,
        }), 200)

    otp = generate_email_otp()
    otp_hash = hash_email_otp(public_id=public_id, email=email, otp=otp)
    expires_at = otp_expiry_timestamp()
    mark_existing_otps_used(db, public_id=public_id, email=stored_email)
    otp_id = insert_email_otp(db, public_id=public_id, email=stored_email, otp_hash=otp_hash, expires_at=expires_at)
    db.commit()

    try:
        enqueue_email_otp(
            build_email_otp_payload(email=stored_email, otp=otp, public_id=public_id),
            otp_id=otp_id,
            idempotency_key=f"email-otp-request:{public_id}:{otp_id}",
        )
    except Exception as exc:
        logger.warning(
            "email_otp_enqueue_failed",
            extra={
                "event": "email_otp_enqueue_failed",
                "request_id": request_id,
                "otp_id": int(otp_id),
                "public_id": str(public_id),
                "error": str(exc),
            },
        )
        mark_email_otp_used(db, otp_id=otp_id)
        db.commit()
        return EmailOtpWorkflowResult(create_error_response("AUTH_EMAIL_OTP_SEND_FAILED"), 502)

    return EmailOtpWorkflowResult(success_response({
        RESPONSE_KEY_EMAIL: stored_email,
        RESPONSE_KEY_EMAIL_VERIFIED: False,
        RESPONSE_KEY_EXPIRES_AT: expires_at.isoformat(),
    }), 200)


def verify_email_otp_workflow(*, db, public_id: str, email: str, otp: str):
    participant_row = fetch_participant_by_public_email(db, public_id=public_id, email=email)
    if not participant_row:
        return EmailOtpWorkflowResult(create_error_response("AUTH_EMAIL_MISMATCH"), 403)

    participant_id, stored_email, email_verified, current_stage = participant_row
    if email_verified:
        mark_participant_email_verified(db, participant_id=int(participant_id))
        apply_participant_stage_event(
            db,
            participant_id=int(participant_id),
            current_stage=current_stage,
            event=PARTICIPANT_STAGE_EVENTS["email_verified"],
        )
        db.commit()
        return EmailOtpWorkflowResult(success_response({
            RESPONSE_KEY_EMAIL: stored_email,
            RESPONSE_KEY_EMAIL_VERIFIED: True,
        }), 200)

    latest = fetch_latest_email_otp(db, public_id=public_id, email=email)
    if not latest:
        return EmailOtpWorkflowResult(create_error_response("AUTH_EMAIL_OTP_NOT_FOUND"), 404)

    otp_id, otp_hash, attempts, is_used, expires_at = latest
    if is_used:
        return EmailOtpWorkflowResult(create_error_response("AUTH_EMAIL_OTP_INVALID"), 400)
    if otp_is_over_attempts(attempts):
        return EmailOtpWorkflowResult(create_error_response("AUTH_EMAIL_OTP_TOO_MANY"), 429)
    if otp_is_expired(expires_at):
        return EmailOtpWorkflowResult(create_error_response("AUTH_EMAIL_OTP_EXPIRED"), 400)

    expected = hash_email_otp(public_id=public_id, email=email, otp=otp)
    if expected != otp_hash:
        increment_email_otp_attempts(db, otp_id=int(otp_id))
        db.commit()
        return EmailOtpWorkflowResult(create_error_response("AUTH_EMAIL_OTP_INVALID"), 400)

    mark_email_otp_used(db, otp_id=int(otp_id))
    mark_participant_email_verified(db, participant_id=int(participant_id))
    apply_participant_stage_event(
        db,
        participant_id=int(participant_id),
        current_stage=current_stage,
        event=PARTICIPANT_STAGE_EVENTS["email_verified"],
    )
    db.commit()
    return EmailOtpWorkflowResult(success_response({
        RESPONSE_KEY_EMAIL: stored_email,
        RESPONSE_KEY_EMAIL_VERIFIED: True,
    }), 200)
