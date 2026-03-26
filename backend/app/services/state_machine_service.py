"""State machine helpers for workflow transitions."""

from __future__ import annotations

from app.constants.participant_constants import (
    PARTICIPANT_STAGE_CONSENT,
    PARTICIPANT_STAGE_POST_SURVEY,
    PARTICIPANT_STAGE_SURVEY,
    PARTICIPANT_STAGE_USER_DETAILS,
)


PARTICIPANT_STAGE_EVENTS = {
    "consent_recorded": "consent_recorded",
    "email_changed": "email_changed",
    "email_verified": "email_verified",
    "submission_completed": "submission_completed",
}


class StateTransitionError(ValueError):
    """Raised when a workflow transition is not allowed."""

    def __init__(self, message: str, *, current_stage: str | None = None, event: str | None = None):
        super().__init__(message)
        self.current_stage = current_stage
        self.event = event


def normalize_participant_stage(stage: str | None) -> str:
    value = str(stage or "").strip()
    if value in {
        PARTICIPANT_STAGE_CONSENT,
        PARTICIPANT_STAGE_USER_DETAILS,
        PARTICIPANT_STAGE_SURVEY,
        PARTICIPANT_STAGE_POST_SURVEY,
    }:
        return value
    return PARTICIPANT_STAGE_CONSENT


def transition_participant_stage(current_stage: str | None, event: str, *, survey_completed: bool = False) -> str:
    stage = normalize_participant_stage(current_stage)

    if event == PARTICIPANT_STAGE_EVENTS["consent_recorded"]:
        if stage == PARTICIPANT_STAGE_CONSENT:
            return PARTICIPANT_STAGE_USER_DETAILS
        return stage

    if event == PARTICIPANT_STAGE_EVENTS["email_changed"]:
        if stage == PARTICIPANT_STAGE_POST_SURVEY:
            return PARTICIPANT_STAGE_POST_SURVEY
        return PARTICIPANT_STAGE_USER_DETAILS

    if event == PARTICIPANT_STAGE_EVENTS["email_verified"]:
        if stage in {PARTICIPANT_STAGE_CONSENT, PARTICIPANT_STAGE_USER_DETAILS, PARTICIPANT_STAGE_SURVEY}:
            return PARTICIPANT_STAGE_SURVEY
        return stage

    if event == PARTICIPANT_STAGE_EVENTS["submission_completed"]:
        if stage != PARTICIPANT_STAGE_SURVEY:
            raise StateTransitionError(
                f"Submission not allowed when stage='{stage}'",
                current_stage=stage,
                event=event,
            )
        return PARTICIPANT_STAGE_POST_SURVEY if survey_completed else PARTICIPANT_STAGE_SURVEY

    raise StateTransitionError(
        f"Unknown workflow event '{event}'",
        current_stage=stage,
        event=event,
    )


def require_participant_stage(current_stage: str | None, *, allowed_stages: set[str], event: str) -> str:
    stage = normalize_participant_stage(current_stage)
    if stage not in allowed_stages:
        raise StateTransitionError(
            f"Action '{event}' not allowed when stage='{stage}'",
            current_stage=stage,
            event=event,
        )
    return stage
