import logging

from app.constants.audit_details import (
    AUDIT_DETAIL_DUPLICATE_HASH_MATCH,
    AUDIT_DETAIL_NEAR_DUPLICATE_MATCH,
    AUDIT_DETAIL_REUSE_REJECTED_SCREENSHOT,
)
from app.constants.event_constants import (
    AUDIT_EVENT_PAYMENT_VERIFY_DUPLICATE_OTHER_USER,
    AUDIT_EVENT_PAYMENT_VERIFY_NEAR_DUPLICATE_OTHER_USER,
    AUDIT_EVENT_PAYMENT_VERIFY_REJECTED_REUSE,
)
from app.constants.observability_constants import OBS_EVENT_PAYMENT_NEAR_DUPLICATE_CHECK_FAILED
from app.constants.payment_constants import (
    FRAUD_REASON_DUPLICATE_HASH_OTHER,
    FRAUD_REASON_DUPLICATE_HASH_SELF,
    FRAUD_REASON_NEAR_DUPLICATE_OTHER,
    FRAUD_REASON_NEAR_DUPLICATE_SELF,
    FRAUD_REASON_REJECTED_REUSE,
    PAYMENT_DETECTED_APP_UNKNOWN,
    VERIFY_ATTEMPT_STATUS_DUPLICATE,
    VERIFY_ATTEMPT_STATUS_REJECTED,
    VERIFY_DETAIL_KEY_DISTANCE,
)
from app.utils.helpers import create_error_response
from app.utils.observability import log_event
from app.utils.fraud import (
    check_duplicate_screenshot,
    check_near_duplicate_screenshot,
    check_rejected_screenshot,
    is_same_person_by_fingerprint,
)

logger = logging.getLogger(__name__)


def resolve_duplicate_upload_response(
    *,
    db,
    payment_id: int,
    participant_id: int,
    sha256_hash: str,
    image_hash: str,
    device_fingerprint,
    device_fingerprint_variants,
    payment_audit_logger,
    fetch_payment_owner_participant_id,
    reject_payment_for_fraud,
    finalize_attempt,
):
    is_duplicate, existing_payment_id, is_same_participant = check_duplicate_screenshot(
        db, sha256_hash, participant_id=participant_id
    )
    if is_duplicate:
        existing_owner_participant_id = fetch_payment_owner_participant_id(db, existing_payment_id)
        same_person_fingerprint = is_same_person_by_fingerprint(
            db,
            participant_id=participant_id,
            other_participant_id=existing_owner_participant_id,
            current_fingerprint=device_fingerprint,
            current_fingerprint_variants=device_fingerprint_variants,
        )
        if is_same_participant or same_person_fingerprint:
            fraud_score = reject_payment_for_fraud([FRAUD_REASON_DUPLICATE_HASH_SELF])
            finalize_attempt(
                VERIFY_ATTEMPT_STATUS_DUPLICATE,
                detected_app=PAYMENT_DETECTED_APP_UNKNOWN,
                failures=[FRAUD_REASON_DUPLICATE_HASH_SELF],
                fraud_score=fraud_score,
            )
            db.commit()
            return create_error_response("FRAUD_DUPLICATE_IMAGE_SELF")

        if payment_audit_logger:
            payment_audit_logger(
                db,
                AUDIT_EVENT_PAYMENT_VERIFY_DUPLICATE_OTHER_USER,
                payment_id=payment_id,
                participant_id=participant_id,
                details=AUDIT_DETAIL_DUPLICATE_HASH_MATCH.format(payment_id=existing_payment_id),
                fraud_signals={"duplicate_hash": True},
            )
        fraud_score = reject_payment_for_fraud([FRAUD_REASON_DUPLICATE_HASH_OTHER])
        finalize_attempt(
            VERIFY_ATTEMPT_STATUS_DUPLICATE,
            detected_app=PAYMENT_DETECTED_APP_UNKNOWN,
            failures=[FRAUD_REASON_DUPLICATE_HASH_OTHER],
            fraud_score=fraud_score,
        )
        db.commit()
        return create_error_response("FRAUD_DUPLICATE_IMAGE")

    if check_rejected_screenshot(db, sha256_hash):
        if payment_audit_logger:
            payment_audit_logger(
                db,
                AUDIT_EVENT_PAYMENT_VERIFY_REJECTED_REUSE,
                payment_id=payment_id,
                participant_id=participant_id,
                details=AUDIT_DETAIL_REUSE_REJECTED_SCREENSHOT,
                fraud_signals={"rejected_reuse": True},
            )
        fraud_score = reject_payment_for_fraud([FRAUD_REASON_REJECTED_REUSE])
        finalize_attempt(
            VERIFY_ATTEMPT_STATUS_REJECTED,
            detected_app=PAYMENT_DETECTED_APP_UNKNOWN,
            failures=[FRAUD_REASON_REJECTED_REUSE],
            fraud_score=fraud_score,
        )
        db.commit()
        return create_error_response("FRAUD_REJECTED_REUSE")

    try:
        is_near_duplicate, near_payment_id, near_distance, near_same_participant = check_near_duplicate_screenshot(
            db,
            image_hash,
            participant_id=participant_id,
            threshold=6,
        )
        if is_near_duplicate:
            near_owner_participant_id = fetch_payment_owner_participant_id(db, near_payment_id)
            near_same_person_fingerprint = is_same_person_by_fingerprint(
                db,
                participant_id=participant_id,
                other_participant_id=near_owner_participant_id,
                current_fingerprint=device_fingerprint,
                current_fingerprint_variants=device_fingerprint_variants,
            )
            if near_same_participant or near_same_person_fingerprint:
                fraud_score = reject_payment_for_fraud(
                    [FRAUD_REASON_NEAR_DUPLICATE_SELF],
                    details={VERIFY_DETAIL_KEY_DISTANCE: near_distance},
                )
                finalize_attempt(
                    VERIFY_ATTEMPT_STATUS_DUPLICATE,
                    detected_app=PAYMENT_DETECTED_APP_UNKNOWN,
                    failures=[FRAUD_REASON_NEAR_DUPLICATE_SELF],
                    fraud_score=fraud_score,
                    details={VERIFY_DETAIL_KEY_DISTANCE: near_distance},
                )
                db.commit()
                return create_error_response("FRAUD_DUPLICATE_IMAGE_SELF")

            if payment_audit_logger:
                payment_audit_logger(
                    db,
                    AUDIT_EVENT_PAYMENT_VERIFY_NEAR_DUPLICATE_OTHER_USER,
                    payment_id=payment_id,
                    participant_id=participant_id,
                    details=AUDIT_DETAIL_NEAR_DUPLICATE_MATCH.format(
                        payment_id=near_payment_id,
                        distance=near_distance,
                    ),
                    fraud_signals={"near_duplicate": True, "distance": near_distance},
                )
            fraud_score = reject_payment_for_fraud(
                [FRAUD_REASON_NEAR_DUPLICATE_OTHER],
                details={VERIFY_DETAIL_KEY_DISTANCE: near_distance},
            )
            finalize_attempt(
                VERIFY_ATTEMPT_STATUS_DUPLICATE,
                detected_app=PAYMENT_DETECTED_APP_UNKNOWN,
                failures=[FRAUD_REASON_NEAR_DUPLICATE_OTHER],
                fraud_score=fraud_score,
                details={VERIFY_DETAIL_KEY_DISTANCE: near_distance},
            )
            db.commit()
            return create_error_response("FRAUD_DUPLICATE_IMAGE")
    except Exception:
        log_event(logger, OBS_EVENT_PAYMENT_NEAR_DUPLICATE_CHECK_FAILED, level=logging.WARNING)

    return None
