"""Shared backend error-mapping helpers."""

from __future__ import annotations

from typing import Callable, Optional

from app.constants.participant_constants import (
    PARTICIPANT_FIELD_EMAIL,
    PARTICIPANT_FIELD_USERNAME,
    PARTICIPANT_STATUS_EXISTS,
)
from app.utils.helpers import create_error_response, success_response

PARTICIPANT_DUPLICATE_ERROR_MAP = {
    PARTICIPANT_FIELD_USERNAME: "DUP_USERNAME",
    PARTICIPANT_FIELD_EMAIL: "DUP_EMAIL",
    "public_id": "DUP_PUBLIC_ID",
}
PARTICIPANT_FOREIGN_KEY_ERROR_MAP = {
    "gender_code": "VAL_GENDER_REQUIRED",
    "language_code": "VAL_LANGUAGE_REQUIRED",
}
PARTICIPANT_CHECK_CONSTRAINT_ERROR_MAP = {
    "chk_email_format": "VAL_EMAIL_INVALID",
    PARTICIPANT_FIELD_EMAIL: "VAL_EMAIL_INVALID",
    "chk_age": "VAL_AGE_INVALID",
    "age": "VAL_AGE_INVALID",
}
PARTICIPANT_UNIQUE_ERROR_MARKERS = (
    "duplicate key value",
    "violates unique constraint",
)
PARTICIPANT_FOREIGN_KEY_ERROR_MARKERS = (
    "foreign key",
    "violates foreign key constraint",
)
PARTICIPANT_CHECK_CONSTRAINT_MARKERS = (
    "check constraint",
    "violates check constraint",
)


def _match_error_key(value: str, mapping: dict[str, str]) -> Optional[str]:
    normalized = (value or "").lower()
    for marker, error_key in mapping.items():
        if marker in normalized:
            return error_key
    return None


def build_existing_participant_response(*, public_id: str, session_id: str, set_cookies: Callable):
    response = success_response({
        "status": PARTICIPANT_STATUS_EXISTS,
        "public_id": public_id,
        "session_id": session_id,
    })
    response = set_cookies(response, public_id, session_id)
    return response, 200


def map_participant_create_exception(
    *,
    error: Exception,
    public_id: str,
    get_existing_session_id: Callable[[str], Optional[str]],
    set_cookies: Callable,
):
    error_str = str(error).lower()
    constraint_name = ""
    try:
        constraint_name = str(error.orig.diag.constraint_name or "").lower()
    except Exception:
        constraint_name = ""

    duplicate_error = _match_error_key(constraint_name, PARTICIPANT_DUPLICATE_ERROR_MAP) or _match_error_key(
        error_str,
        PARTICIPANT_DUPLICATE_ERROR_MAP,
    )
    if duplicate_error:
        if duplicate_error == "DUP_PUBLIC_ID":
            existing_session_id = get_existing_session_id(public_id)
            if existing_session_id:
                return build_existing_participant_response(
                    public_id=public_id,
                    session_id=existing_session_id,
                    set_cookies=set_cookies,
                )
        return create_error_response(duplicate_error)

    if any(marker in error_str for marker in PARTICIPANT_UNIQUE_ERROR_MARKERS):
        duplicate_error = _match_error_key(error_str, PARTICIPANT_DUPLICATE_ERROR_MAP)
        if duplicate_error:
            if duplicate_error == "DUP_PUBLIC_ID":
                existing_session_id = get_existing_session_id(public_id)
                if existing_session_id:
                    return build_existing_participant_response(
                        public_id=public_id,
                        session_id=existing_session_id,
                        set_cookies=set_cookies,
                    )
            return create_error_response(duplicate_error)
        return create_error_response("PARTICIPANT_EXISTS")

    if any(marker in error_str for marker in PARTICIPANT_FOREIGN_KEY_ERROR_MARKERS):
        mapped = _match_error_key(error_str, PARTICIPANT_FOREIGN_KEY_ERROR_MAP)
        return create_error_response(mapped or "DATABASE_ERROR")

    if any(marker in error_str for marker in PARTICIPANT_CHECK_CONSTRAINT_MARKERS):
        mapped = _match_error_key(error_str, PARTICIPANT_CHECK_CONSTRAINT_ERROR_MAP)
        return create_error_response(mapped or "DATABASE_ERROR")

    return create_error_response("PARTICIPANT_EXISTS" if duplicate_error else "DATABASE_ERROR")
