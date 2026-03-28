"""Service helpers for participant registration and lookup flows."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from app.config import (
    PARTICIPANT_PUBLIC_COOKIE_NAME,
    PARTICIPANT_SESSION_COOKIE_NAME,
    PARTICIPANT_SESSION_STALE_TTL_SECONDS,
    SESSION_COOKIE_SAMESITE,
    SESSION_COOKIE_SECURE,
)
from app.constants.participant_constants import (
    PARTICIPANT_FIELD_EMAIL,
    PARTICIPANT_FIELD_USERNAME,
)
from app.constants.error_keys import DUP_USERNAME
from app.constants.request_keys import REQUEST_KEY_SESSION_ID
from app.constants.participant_patterns import PUBLIC_ID_REGEX
from app.services.participant_query_service import (
    QUERY_CHECK_PARTICIPANT_FIELD_AVAILABLE_TEMPLATE,
    QUERY_CHECK_PRIOR_EXPERIENCE_EXISTS,
    QUERY_CLOSE_PARTICIPANT_SESSION_BY_KEY,
    QUERY_FETCH_PARTICIPANT_SESSION_STATUS,
    QUERY_FETCH_GENDERS,
    QUERY_FETCH_LANGUAGES,
    QUERY_FETCH_PRIOR_EXPERIENCES,
    QUERY_FIND_EXISTING_PARTICIPANT_CONFLICT,
    QUERY_GET_EXISTING_SESSION_ID,
    QUERY_INSERT_PARTICIPANT,
    QUERY_MARK_PARTICIPANT_SESSION_HIDDEN,
    QUERY_TOUCH_PARTICIPANT_SESSION,
    QUERY_UPSERT_PARTICIPANT_SESSION,
)
from sqlalchemy import text

PARTICIPANT_REQUIRED_FIELDS = [
    PARTICIPANT_FIELD_USERNAME,
    PARTICIPANT_FIELD_EMAIL,
    "gender_code",
    "age",
    "location",
    "language_code",
    "prior_experience",
]
PARTICIPANT_AVAILABILITY_FIELDS = {PARTICIPANT_FIELD_USERNAME, PARTICIPANT_FIELD_EMAIL}


def set_participant_cookies(response, public_id: str, session_id: str):
    response.set_cookie(
        PARTICIPANT_SESSION_COOKIE_NAME,
        session_id,
        httponly=True,
        secure=bool(SESSION_COOKIE_SECURE),
        samesite=SESSION_COOKIE_SAMESITE,
        path="/",
    )
    response.set_cookie(
        PARTICIPANT_PUBLIC_COOKIE_NAME,
        public_id,
        httponly=True,
        secure=bool(SESSION_COOKIE_SECURE),
        samesite=SESSION_COOKIE_SAMESITE,
        path="/",
    )
    return response


def clear_participant_cookies(response):
    response.delete_cookie(
        PARTICIPANT_SESSION_COOKIE_NAME,
        path="/",
        secure=bool(SESSION_COOKIE_SECURE),
        samesite=SESSION_COOKIE_SAMESITE,
    )
    response.delete_cookie(
        PARTICIPANT_PUBLIC_COOKIE_NAME,
        path="/",
        secure=bool(SESSION_COOKIE_SECURE),
        samesite=SESSION_COOKIE_SAMESITE,
    )
    return response


def collect_missing_participant_fields(data):
    return [field for field in PARTICIPANT_REQUIRED_FIELDS if field not in data or not data[field]]


def generate_public_id(data) -> str:
    return str(data.get("public_id") or uuid.uuid4()).strip()


def is_valid_public_id(public_id: str) -> bool:
    return bool(PUBLIC_ID_REGEX.match(public_id or ""))


def generate_session_id(data) -> str:
    return str(data.get(REQUEST_KEY_SESSION_ID) or f"sess_{uuid.uuid4().hex}").strip()[:128]


def find_existing_participant_conflict(db, *, username: str, email: str):
    existing = db.execute(QUERY_FIND_EXISTING_PARTICIPANT_CONFLICT, {
        "un": username,
        "em": email,
    }).fetchone()
    if not existing:
        return None
    existing_username, existing_email = existing
    if existing_username == username:
        return DUP_USERNAME
    if existing_email == email:
        return "DUP_EMAIL"
    return "DUP_PUBLIC_ID"


def insert_participant(
    db,
    *,
    public_id: str,
    session_id: str,
    payload: dict,
    ip_hash: str,
    user_agent: str,
):
    result = db.execute(QUERY_INSERT_PARTICIPANT, {
        "pub": public_id,
        "sid": session_id,
        "un": str(payload["username"]).strip()[:50],
        "em": str(payload["email"]).strip().lower()[:255],
        "gc": str(payload["gender_code"]).strip().lower()[:32],
        "age": int(payload["age"]),
        "loc": str(payload["location"]).strip()[:120],
        "lc": str(payload["language_code"]).strip().lower()[:20],
        "pe": str(payload.get("prior_experience", "")).strip()[:120],
        "iph": ip_hash,
        "ua": user_agent[:512],
    })
    participant_id = result.scalar()
    if participant_id is None:
        raise RuntimeError("participant insert did not return id")
    return int(participant_id)


def get_existing_session_id_for_public_id(db, public_id: str):
    row = db.execute(QUERY_GET_EXISTING_SESSION_ID, {"pub": public_id}).fetchone()
    return row[0] if row else None


def fetch_participant_session_status(db, *, public_id: str, session_id: str):
    safe_public_id = str(public_id or "").strip()
    safe_session_id = str(session_id or "").strip()
    if not safe_public_id or not safe_session_id:
        return None
    return db.execute(
        QUERY_FETCH_PARTICIPANT_SESSION_STATUS,
        {"pub": safe_public_id, "sid": safe_session_id[:128]},
    ).fetchone()


def ensure_participant_session(db, *, participant_id: int, session_id: str | None):
    safe_session_id = str(session_id or "").strip()
    if not safe_session_id:
        return None
    row = db.execute(
        QUERY_UPSERT_PARTICIPANT_SESSION,
        {"pid": int(participant_id), "sid": safe_session_id[:128]},
    ).fetchone()
    if row is None:
        return None
    ended_at = row[1]
    if ended_at is not None:
        return None
    return int(row[0])


def touch_participant_session(db, *, public_id: str, session_id: str):
    safe_public_id = str(public_id or "").strip()
    safe_session_id = str(session_id or "").strip()
    if not safe_public_id or not safe_session_id:
        return None
    return db.execute(
        QUERY_TOUCH_PARTICIPANT_SESSION,
        {"pub": safe_public_id, "sid": safe_session_id[:128]},
    ).fetchone()


def mark_participant_session_hidden(db, *, public_id: str, session_id: str):
    safe_public_id = str(public_id or "").strip()
    safe_session_id = str(session_id or "").strip()
    if not safe_public_id or not safe_session_id:
        return None
    return db.execute(
        QUERY_MARK_PARTICIPANT_SESSION_HIDDEN,
        {"pub": safe_public_id, "sid": safe_session_id[:128]},
    ).fetchone()


def close_participant_session_by_key(db, *, public_id: str, session_id: str):
    safe_public_id = str(public_id or "").strip()
    safe_session_id = str(session_id or "").strip()
    if not safe_public_id or not safe_session_id:
        return None
    return db.execute(
        QUERY_CLOSE_PARTICIPANT_SESSION_BY_KEY,
        {"pub": safe_public_id, "sid": safe_session_id[:128]},
    ).fetchone()


def is_participant_session_stale(last_seen_at, hidden_at=None, *, now_utc: datetime | None = None) -> bool:
    reference_point = hidden_at or last_seen_at
    if reference_point is None:
        return False
    reference_time = now_utc or datetime.now(timezone.utc)
    if getattr(reference_point, "tzinfo", None) is None:
        reference_point = reference_point.replace(tzinfo=timezone.utc)
    age_seconds = max(0.0, (reference_time - reference_point).total_seconds())
    return age_seconds >= float(PARTICIPANT_SESSION_STALE_TTL_SECONDS)


def is_participant_field_available(db, *, field_name: str, value: str) -> bool:
    if field_name not in PARTICIPANT_AVAILABILITY_FIELDS:
        raise ValueError(f"Unsupported participant availability field: {field_name}")
    row = db.execute(text(QUERY_CHECK_PARTICIPANT_FIELD_AVAILABLE_TEMPLATE.format(field_name=field_name)), {"value": value}).scalar()
    return not bool(row)


def fetch_participant_options(db):
    genders = db.execute(QUERY_FETCH_GENDERS).fetchall()

    languages = db.execute(QUERY_FETCH_LANGUAGES).fetchall()

    prior_experiences = db.execute(QUERY_FETCH_PRIOR_EXPERIENCES).fetchall()
    grouped_prior_experiences = []
    current_group = None
    current_options = []
    for code, display_name, group_label in prior_experiences:
        group_name = str(group_label)
        if current_group != group_name:
            if current_group is not None:
                grouped_prior_experiences.append({
                    "label": current_group,
                    "options": current_options,
                })
            current_group = group_name
            current_options = []
        current_options.append({"value": str(code), "label": str(display_name)})
    if current_group is not None:
        grouped_prior_experiences.append({
            "label": current_group,
            "options": current_options,
        })

    return {
        "genders": [
            {"value": str(code), "label": str(display_name)}
            for code, display_name in genders
        ],
        "languages": [
            {
                "value": str(code),
                "label": (
                    f"{name} ({native_name})"
                    if native_name and str(native_name).strip() and str(native_name) != str(name)
                    else str(name)
                ),
            }
            for code, name, native_name in languages
        ],
        "prior_experiences": grouped_prior_experiences,
    }


def is_valid_prior_experience_code(db, code: str) -> bool:
    value = str(code or "").strip()
    if not value:
        return False
    row = db.execute(QUERY_CHECK_PRIOR_EXPERIENCE_EXISTS, {"code": value}).scalar()
    return bool(row)
