from __future__ import annotations

import json
from typing import Any

from app.config import (
    CONSENT_RATE_LIMIT,
    DOCS_BASE_URL,
    EMAIL_OTP_REQUEST_RATE_LIMIT,
    EMAIL_OTP_VERIFY_RATE_LIMIT,
    HEALTH_RATE_LIMIT,
    PARTICIPANT_CHECK_RATE_LIMIT,
    PARTICIPANT_CREATE_RATE_LIMIT,
    ROOT_RATE_LIMIT,
    SUBMIT_RATE_LIMIT,
    ERROR_CODES,
)
from app.constants.route_constants import (
    CHECK_EMAIL_ROUTE,
    CHECK_USERNAME_ROUTE,
    CLIENT_ERROR_ROUTE,
    CONSENT_ROUTE,
    EMAIL_OTP_REQUEST_ROUTE,
    EMAIL_OTP_VERIFY_ROUTE,
    HEALTH_ROUTE,
    IMAGES_RANDOM_ROUTE,
    API_DOCS_ENDPOINTS_ROUTE,
    API_DOCS_ERRORS_ROUTE,
    API_DOCS_EXAMPLES_ROUTE,
    API_DOCS_ROUTE,
    PARTICIPANTS_ROUTE,
    PARTICIPANT_OPTIONS_ROUTE,
    PARTICIPANT_SESSION_ROUTE,
    ROOT_ROUTE,
    SUBMIT_ROUTE,
)
from app.extensions import app


_ENDPOINT_METADATA: dict[tuple[str, str], dict[str, Any]] = {
    ("GET", HEALTH_ROUTE): {
        "summary": "Check whether the API process is up and whether the database can be reached right now.",
        "auth": "none",
        "idempotency": "n/a",
        "rate_limit": HEALTH_RATE_LIMIT,
        "query": [],
        "headers": [],
        "body": None,
        "notes": [
            "Intended for uptime probes and smoke tests.",
            "Returns service-degraded output when the database probe fails.",
        ],
    },
    ("GET", CHECK_USERNAME_ROUTE): {
        "summary": "Check whether a participant username is available before registration.",
        "auth": "none",
        "idempotency": "n/a",
        "rate_limit": PARTICIPANT_CHECK_RATE_LIMIT,
        "query": ["username=<candidate_username>"],
        "headers": [],
        "body": None,
    },
    ("GET", CHECK_EMAIL_ROUTE): {
        "summary": "Check whether an email address is already in use.",
        "auth": "none",
        "idempotency": "n/a",
        "rate_limit": PARTICIPANT_CHECK_RATE_LIMIT,
        "query": ["email=<candidate@example.com>"],
        "headers": [],
        "body": None,
    },
    ("POST", CLIENT_ERROR_ROUTE): {
        "summary": "Receive structured frontend error telemetry for observability and debugging.",
        "auth": "none",
        "idempotency": "n/a",
        "rate_limit": ROOT_RATE_LIMIT,
        "headers": ["Content-Type: application/json"],
        "body": {
            "message": "Unhandled UI exception",
            "route": "/survey",
            "tag": "ui_exception",
            "context": {"component": "SurveyPage"},
            "meta": {"browser": "Safari"},
            "stack": "Error: ...",
        },
    },
    ("POST", PARTICIPANTS_ROUTE): {
        "summary": "Create a participant record, set participant cookies, and start the registration session.",
        "auth": "none",
        "idempotency": "required",
        "rate_limit": PARTICIPANT_CREATE_RATE_LIMIT,
        "headers": ["Content-Type: application/json", "X-Idempotency-Key: <uuid>"],
        "body": {
            "username": "gaurav_01",
            "email": "gaurav@example.com",
            "gender_code": "male",
            "age": 24,
            "location": "Ahmedabad, Gujarat",
            "language_code": "en",
            "prior_experience": "none",
            "turnstile_token": "<turnstile-token>",
        },
        "notes": [
            "Sets secure participant cookies on success.",
            "Turnstile is enforced when backend production verification is enabled.",
        ],
    },
    ("POST", CONSENT_ROUTE): {
        "summary": "Mark consent as recorded for an existing participant.",
        "auth": "none",
        "idempotency": "n/a",
        "rate_limit": CONSENT_RATE_LIMIT,
        "headers": ["Content-Type: application/json"],
        "body": {"public_id": "<participant_public_id>"},
        "notes": ["This is a simple update operation and no longer uses the idempotency layer."],
    },
    ("GET", PARTICIPANT_SESSION_ROUTE): {
        "summary": "Read the current participant identifiers from secure cookies, if they exist.",
        "auth": "participant cookies (optional)",
        "idempotency": "n/a",
        "rate_limit": PARTICIPANT_CHECK_RATE_LIMIT,
        "headers": [],
        "body": None,
    },
    ("GET", PARTICIPANT_OPTIONS_ROUTE): {
        "summary": "Load registration form options such as genders, languages, and prior-experience groups.",
        "auth": "none",
        "idempotency": "n/a",
        "rate_limit": PARTICIPANT_CHECK_RATE_LIMIT,
        "headers": [],
        "body": None,
    },
    ("POST", EMAIL_OTP_REQUEST_ROUTE): {
        "summary": "Create and send an email verification OTP for the participant email address.",
        "auth": "none",
        "idempotency": "n/a",
        "rate_limit": EMAIL_OTP_REQUEST_RATE_LIMIT,
        "headers": ["Content-Type: application/json"],
        "body": {
            "public_id": "<participant_public_id>",
            "email": "gaurav@example.com",
            "email_update": False,
        },
        "notes": [
            "Use `email_update=true` when the participant is changing their email address.",
            "Delivery is rate-limited and OTP state is managed server-side rather than with idempotency replay.",
        ],
    },
    ("POST", EMAIL_OTP_VERIFY_ROUTE): {
        "summary": "Verify an email OTP and mark the participant email as verified.",
        "auth": "none",
        "idempotency": "n/a",
        "rate_limit": EMAIL_OTP_VERIFY_RATE_LIMIT,
        "headers": ["Content-Type: application/json"],
        "body": {
            "public_id": "<participant_public_id>",
            "email": "gaurav@example.com",
            "otp": "123456",
        },
        "notes": ["Consumes the OTP on success and increments attempt counters on invalid codes."],
    },
    ("GET", IMAGES_RANDOM_ROUTE): {
        "summary": "Select the next image for the active participant flow (survey or attention step).",
        "auth": "none",
        "idempotency": "n/a",
        "rate_limit": "none",
        "query": [
            "public_id=<participant_public_id> (optional)",
            "exclude=image_001,image_002 (optional)",
        ],
        "headers": [],
        "body": None,
        "notes": [
            "Pass previously shown image ids via `exclude` to avoid immediate repeats in the client.",
            "Providing `public_id` enables participant-aware sequencing for the 2-step submission flow.",
            "Current backend flow expects exactly 2 submissions per participant session.",
        ],
    },
    ("POST", SUBMIT_ROUTE): {
        "summary": "Submit an image description, feedback, and engagement telemetry for the active survey image.",
        "auth": "participant public_id + consented participant state",
        "idempotency": "required",
        "rate_limit": SUBMIT_RATE_LIMIT,
        "headers": ["Content-Type: application/json", "X-Idempotency-Key: <uuid>"],
        "body": {
            "public_id": "<participant_public_id>",
            "session_id": "<participant_session_id_optional>",
            "image_id": "1.svg",
            "description": "A detailed 60+ word description of the image content goes here.",
            "feedback": "The task instructions were clear.",
            "rating": 4,
            "time_spent_seconds": 94,
            "survey_index": 1,
            "tab_switch_count": 0,
            "page_close_attempts": 0,
            "network_disconnects": 0,
            "survey_time_spent_seconds": 91,
            "survey_page_views": 1,
            "survey_tab_switches": 0,
            "survey_page_close_attempts": 0,
            "survey_network_disconnects": 0,
            "survey_max_scroll_depth_pct": 100,
            "survey_clicks": 4,
            "survey_keypresses": 102,
            "confidence_score": 4,
            "difficulty_self_report": 3,
            "time_before_typing_seconds": 1.2,
            "edit_count": 5,
            "backspace_count": 10,
            "first_view_duration_seconds": 1.2,
            "writing_duration_seconds": 82,
            "avg_keystroke_interval_seconds": None,
            "keystroke_variance": None,
            "pause_count": 0,
            "avg_pause_duration_seconds": None,
            "turnstile_token": "<turnstile-token>",
        },
        "notes": [
            "Requires a valid participant public_id and a participant that is already consented.",
            "Stores both survey output and engagement telemetry.",
            "Backend determines whether a submission is survey vs attention from image assignment; client flags are not required.",
            "`survey_index` is backend-owned simple submission order for the participant across both attention-check and survey images.",
            "Protected with idempotency because duplicate submission writes are materially harmful.",
        ],
    },
}

_DOCS_EXCLUDED = {
    ROOT_ROUTE,
    API_DOCS_ROUTE,
    API_DOCS_ENDPOINTS_ROUTE,
    API_DOCS_ERRORS_ROUTE,
    API_DOCS_EXAMPLES_ROUTE,
    "/static/<path:filename>",
}

_ORDER = [
    ("GET", HEALTH_ROUTE),
    ("GET", CHECK_USERNAME_ROUTE),
    ("GET", CHECK_EMAIL_ROUTE),
    ("POST", CLIENT_ERROR_ROUTE),
    ("POST", PARTICIPANTS_ROUTE),
    ("POST", CONSENT_ROUTE),
    ("GET", PARTICIPANT_SESSION_ROUTE),
    ("GET", PARTICIPANT_OPTIONS_ROUTE),
    ("POST", EMAIL_OTP_REQUEST_ROUTE),
    ("POST", EMAIL_OTP_VERIFY_ROUTE),
    ("GET", IMAGES_RANDOM_ROUTE),
    ("POST", SUBMIT_ROUTE),
]


def _normalize_rule(rule: str) -> str:
    return rule.replace("<", "{").replace(">", "}")


def _example_url(base_url: str, path: str, query: list[str] | None) -> str:
    url = f"{base_url}{path}"
    if query:
        raw_pairs = []
        for item in query:
            pair = item.split(" ", 1)[0]
            raw_pairs.append(pair)
        url = f"{url}?{'&'.join(raw_pairs)}"
    return url


def _build_curl_example(base_url: str, method: str, path: str, meta: dict[str, Any]) -> str:
    lines = [f'curl -X {method} "{_example_url(base_url, path, meta.get("query"))}"']
    for header in meta.get("headers") or []:
        lines.append(f'  -H "{header}"')
    body = meta.get("body")
    if body is not None:
        body_json = json.dumps(body, indent=2)
        lines.append(f"  -d '{body_json}'")
    return " \\\n".join(lines)


def build_endpoint_docs() -> list[dict[str, Any]]:
    docs = []
    endpoint_to_doc = {endpoint: app.view_functions[endpoint].__doc__ or "" for endpoint in app.view_functions}
    order_index = {key: idx for idx, key in enumerate(_ORDER)}

    for rule in app.url_map.iter_rules():
        if rule.rule in _DOCS_EXCLUDED:
            continue
        methods = [m for m in sorted(rule.methods or ()) if m in {"GET", "POST"}]
        if not methods:
            continue
        normalized_path = _normalize_rule(rule.rule)
        docstring = " ".join(endpoint_to_doc.get(rule.endpoint, "").split())
        for method in methods:
            key = (method, rule.rule)
            meta = _ENDPOINT_METADATA.get(key)
            if not meta:
                continue
            summary = meta.get("summary") or docstring or f"{method} {normalized_path}"
            search_text = " ".join(
                [method.lower(), normalized_path.lower(), summary.lower(), " ".join((meta.get("notes") or [])).lower()]
            )
            docs.append({
                "method": method,
                "path": normalized_path,
                "summary": summary,
                "auth": meta["auth"],
                "idempotency": meta["idempotency"],
                "rate_limit": meta["rate_limit"],
                "query": meta.get("query") or [],
                "headers": meta.get("headers") or [],
                "body": meta.get("body"),
                "notes": meta.get("notes") or [],
                "search_text": search_text,
                "curl_example": _build_curl_example(DOCS_BASE_URL, method, normalized_path, meta),
                "order": order_index.get(key, 999),
            })
    return sorted(docs, key=lambda item: (item["order"], item["path"], item["method"]))


def build_error_docs() -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for error_key, error_def in sorted(ERROR_CODES.items(), key=lambda item: (item[1].get("category", ""), item[1].get("code", ""))):
        category = str(error_def.get("category") or "SYS")
        grouped.setdefault(category, []).append({
            "key": error_key,
            "code": error_def.get("code"),
            "message": error_def.get("message"),
            "status": error_def.get("status"),
            "field": error_def.get("field"),
            "reason": error_def.get("reason"),
        })
    return [{"category": category, "errors": errors} for category, errors in grouped.items()]


def build_example_docs() -> list[dict[str, Any]]:
    return [{
        "method": endpoint["method"],
        "path": endpoint["path"],
        "summary": endpoint["summary"],
        "curl_example": endpoint["curl_example"],
        "notes": endpoint["notes"],
    } for endpoint in build_endpoint_docs()]
