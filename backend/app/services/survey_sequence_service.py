"""Helpers for enforcing a two-step survey sequence per participant."""

from __future__ import annotations

import random

STEP_ATTENTION = "attention"
STEP_SURVEY = "survey"
REQUIRED_SUBMISSIONS = 2
PARTICIPANT_META_KEY_SEQUENCE = "two_step_sequence_order"


def _is_valid_sequence(value) -> bool:
    if not isinstance(value, list) or len(value) != REQUIRED_SUBMISSIONS:
        return False
    return set(value) == {STEP_ATTENTION, STEP_SURVEY}


def resolve_two_step_sequence(participant_meta: dict) -> tuple[list[str], bool]:
    """Return participant sequence order and whether it was newly created."""
    existing = participant_meta.get(PARTICIPANT_META_KEY_SEQUENCE)
    if _is_valid_sequence(existing):
        return list(existing), False

    attention_first = random.choice((True, False))
    sequence = [STEP_ATTENTION, STEP_SURVEY] if attention_first else [STEP_SURVEY, STEP_ATTENTION]
    participant_meta[PARTICIPANT_META_KEY_SEQUENCE] = sequence
    return sequence, True


def expected_step_for_submission_count(sequence: list[str], completed_submissions: int) -> str | None:
    if completed_submissions < 0 or completed_submissions >= REQUIRED_SUBMISSIONS:
        return None
    if not _is_valid_sequence(sequence):
        return None
    return sequence[completed_submissions]
