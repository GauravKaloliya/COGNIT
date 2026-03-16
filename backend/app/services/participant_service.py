"""Service helpers for participant registration and lookup flows."""

from __future__ import annotations

import re
import uuid

from sqlalchemy import text

from app.config import (
    PARTICIPANT_PUBLIC_COOKIE_NAME,
    PARTICIPANT_SESSION_COOKIE_NAME,
    SESSION_COOKIE_SAMESITE,
    SESSION_COOKIE_SECURE,
)

PARTICIPANT_REQUIRED_FIELDS = [
    "username",
    "email",
    "phone",
    "gender_code",
    "age",
    "location",
    "language_code",
    "prior_experience",
]
PUBLIC_ID_REGEX = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)
PARTICIPANT_AVAILABILITY_FIELDS = {"username", "email", "phone"}


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


def collect_missing_participant_fields(data):
    return [field for field in PARTICIPANT_REQUIRED_FIELDS if field not in data or not data[field]]


def generate_public_id(data) -> str:
    return str(data.get("public_id") or uuid.uuid4()).strip()


def is_valid_public_id(public_id: str) -> bool:
    return bool(PUBLIC_ID_REGEX.match(public_id or ""))


def generate_session_id(data) -> str:
    return str(data.get("session_id") or f"sess_{uuid.uuid4().hex}").strip()[:128]


def find_existing_participant_conflict(db, *, username: str, email: str, phone: str):
    existing = db.execute(text("""
        SELECT username, email, phone
        FROM participants
        WHERE is_deleted = false
          AND (
            username = :un
            OR email = :em
            OR phone = :ph
          )
        LIMIT 1
    """), {
        "un": username,
        "em": email,
        "ph": phone,
    }).fetchone()
    if not existing:
        return None
    existing_username, existing_email, existing_phone = existing
    if existing_username == username:
        return "DUP_USERNAME"
    if existing_email == email:
        return "DUP_EMAIL"
    if existing_phone == phone:
        return "DUP_PHONE"
    return "PARTICIPANT_EXISTS"


def insert_participant(
    db,
    *,
    public_id: str,
    session_id: str,
    payload: dict,
    ip_hash: str,
    user_agent: str,
):
    result = db.execute(text("""
        INSERT INTO participants (
            public_id, session_id, username, email, phone,
            gender_code, age, location, language_code, prior_experience,
            ip_hash, user_agent, extra_metadata
        ) VALUES (
            :pub, :sid, :un, :em, :ph, :gc, :age, :loc, :lc, :pe, :iph, :ua, '{}'
        )
        RETURNING id
    """), {
        "pub": public_id,
        "sid": session_id,
        "un": str(payload["username"]).strip()[:50],
        "em": str(payload["email"]).strip().lower()[:255],
        "ph": str(payload["phone"]).strip()[:20],
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
    row = db.execute(text("""
        SELECT session_id
        FROM participants
        WHERE public_id = :pub AND is_deleted = false
        LIMIT 1
    """), {"pub": public_id}).fetchone()
    return row[0] if row else None


def is_participant_field_available(db, *, field_name: str, value: str) -> bool:
    if field_name not in PARTICIPANT_AVAILABILITY_FIELDS:
        raise ValueError(f"Unsupported participant availability field: {field_name}")
    row = db.execute(text(f"""
        SELECT 1 FROM participants
        WHERE {field_name} = :value AND is_deleted = false
        LIMIT 1
    """), {"value": value}).scalar()
    return not bool(row)


def fetch_participant_options(db):
    genders = db.execute(text("""
        SELECT code, display_name
        FROM genders
        WHERE active = true
        ORDER BY sort_order ASC, display_name ASC
    """)).fetchall()

    languages = db.execute(text("""
        SELECT code, name, native_name
        FROM languages
        WHERE active = true
        ORDER BY name ASC
    """)).fetchall()

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
    }
