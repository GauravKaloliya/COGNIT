"""Participant lifecycle state helpers."""

from __future__ import annotations

from app.services.participant_query_service import (
    QUERY_RECORD_PARTICIPANT_CONSENT,
    QUERY_UPDATE_PARTICIPANT_STAGE,
)
from app.services.state_machine_service import transition_participant_stage


def record_participant_consent(db, *, public_id: str):
    return db.execute(QUERY_RECORD_PARTICIPANT_CONSENT, {"pub": str(public_id)}).fetchone()


def update_participant_stage(db, *, participant_id: int, stage: str) -> None:
    db.execute(QUERY_UPDATE_PARTICIPANT_STAGE, {
        "pid": int(participant_id),
        "stage": str(stage),
    })


def apply_participant_stage_event(
    db,
    *,
    participant_id: int,
    current_stage: str | None,
    event: str,
    survey_completed: bool = False,
) -> str:
    next_stage = transition_participant_stage(
        current_stage,
        event,
        survey_completed=survey_completed,
    )
    if next_stage != current_stage:
        update_participant_stage(db, participant_id=participant_id, stage=next_stage)
    return next_stage
