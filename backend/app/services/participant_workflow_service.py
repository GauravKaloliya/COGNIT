"""Participant registration orchestration."""

from __future__ import annotations

import logging
from dataclasses import dataclass

from sqlalchemy.exc import IntegrityError

from app.constants.audit_details import AUDIT_DETAIL_PARTICIPANT_CREATED
from app.constants.event_constants import AUDIT_EVENT_PARTICIPANT_CREATED
from app.constants.observability_constants import OBS_EVENT_PARTICIPANT_CREATE_ROLLBACK_FAILED
from app.constants.participant_constants import PARTICIPANT_STATUS_CREATED
from app.constants.response_keys import RESPONSE_KEY_PUBLIC_ID, RESPONSE_KEY_SESSION_ID, RESPONSE_KEY_STATUS
from app.services.participant_service import (
    find_existing_participant_conflict,
    get_existing_session_id_for_public_id,
    insert_participant,
    is_valid_prior_experience_code,
    set_participant_cookies,
)
from app.utils.error_mapping import map_participant_create_exception
from app.utils.helpers import create_error_response, log_audit, success_response
from app.utils.observability import log_event

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class ParticipantWorkflowResult:
    response: object
    status_code: int


def create_participant_workflow(
    *,
    db,
    payload: dict,
    public_id: str,
    session_id: str,
    ip_hash: str,
    user_agent: str,
):
    username = str(payload["username"]).strip()[:50]
    email = str(payload["email"]).strip().lower()[:255]
    prior_experience = str(payload.get("prior_experience", "")).strip()

    if not is_valid_prior_experience_code(db, prior_experience):
        return ParticipantWorkflowResult(create_error_response("VAL_EXPERIENCE_REQUIRED"), 400)

    conflict_error_key = find_existing_participant_conflict(db, username=username, email=email)
    if conflict_error_key:
        return ParticipantWorkflowResult(create_error_response(conflict_error_key), 409)

    try:
        participant_id = insert_participant(
            db,
            public_id=public_id,
            session_id=session_id,
            payload=payload,
            ip_hash=ip_hash,
            user_agent=user_agent,
        )
        log_audit(
            db,
            AUDIT_EVENT_PARTICIPANT_CREATED,
            participant_id=participant_id,
            details=AUDIT_DETAIL_PARTICIPANT_CREATED.format(public_id=public_id),
        )
        db.commit()
        response = success_response({
            RESPONSE_KEY_STATUS: PARTICIPANT_STATUS_CREATED,
            RESPONSE_KEY_PUBLIC_ID: public_id,
            RESPONSE_KEY_SESSION_ID: session_id,
        })
        response = set_participant_cookies(response, public_id, session_id)
        return ParticipantWorkflowResult(response, 201)
    except IntegrityError as exc:
        try:
            db.rollback()
        except Exception:
            log_event(logger, OBS_EVENT_PARTICIPANT_CREATE_ROLLBACK_FAILED, level=logging.WARNING, error=str(exc))
        response = map_participant_create_exception(
            error=exc,
            public_id=public_id,
            get_existing_session_id=lambda value: get_existing_session_id_for_public_id(db, value),
            set_cookies=set_participant_cookies,
        )
        return ParticipantWorkflowResult(response, response[1] if isinstance(response, tuple) else 400)
    except Exception as exc:
        try:
            db.rollback()
        except Exception:
            log_event(logger, OBS_EVENT_PARTICIPANT_CREATE_ROLLBACK_FAILED, level=logging.WARNING, error=str(exc))
        response = map_participant_create_exception(
            error=exc,
            public_id=public_id,
            get_existing_session_id=lambda value: get_existing_session_id_for_public_id(db, value),
            set_cookies=set_participant_cookies,
        )
        return ParticipantWorkflowResult(response, response[1] if isinstance(response, tuple) else 500)
