"""Image routes module for C.O.G.N.I.T. backend."""

import time
from copy import deepcopy

from flask import request, g
from sqlalchemy import text

from app.constants.log_messages import LOG_RANDOM_IMAGE_FAILED
from app.constants.route_constants import IMAGES_RANDOM_ROUTE
from app.constants.route_constants import IMAGES_RESERVATION_RENEW_ROUTE
from app.constants.request_keys import REQUEST_KEY_IMAGE_ID, REQUEST_KEY_PUBLIC_ID
from app.constants.response_keys import RESPONSE_KEY_EXPIRES_AT
from app.config import IMAGES_RANDOM_RATE_LIMIT, PARTICIPANT_PUBLIC_COOKIE_NAME, PARTICIPANT_SESSION_RATE_LIMIT
from app.database import get_db
from app.extensions import limiter
from app.services.state_machine_service import StateTransitionError, require_participant_stage
from app.utils.helpers import create_error_response, success_response
from app.utils.decorators import track_performance
from app.services.image_service import (
    renew_participant_image_reservation,
    select_random_image_for_participant,
)
from app.services.submission_query_service import update_participant_metadata
from app.services.survey_sequence_service import (
    REQUIRED_SUBMISSIONS,
    STEP_ATTENTION,
    expected_step_for_submission_count,
    resolve_two_step_sequence,
)


# ────────────────────────────────────────────────
# Blueprint Setup
# ────────────────────────────────────────────────

from flask import Blueprint
image_bp = Blueprint('image', __name__)

QUERY_FETCH_PARTICIPANT_RESERVATION_CONTEXT = text(
    """
    SELECT
        p.id,
        p.stage,
        COUNT(s.id) AS total_submissions
    FROM participants p
    LEFT JOIN submissions s ON s.participant_id = p.id
    WHERE p.public_id = :pub AND p.is_deleted = false
    GROUP BY p.id, p.stage
    """
)


# ────────────────────────────────────────────────
# Routes
# ────────────────────────────────────────────────


@image_bp.route(IMAGES_RANDOM_ROUTE)
@limiter.limit(IMAGES_RANDOM_RATE_LIMIT)
@track_performance
def random_image():
    """Get a random image with two-step participant-specific sequence enforcement."""
    exclude = request.args.get("exclude", "")
    excluded = [x.strip() for x in exclude.split(",") if x.strip()]
    excluded_set = set(excluded)
    public_id = (request.args.get("public_id") or "").strip()

    try:
        db = get_db()
        now_ts = int(time.time())

        should_prioritize_attention = False
        participant_id = None
        if public_id:
            participant_row = db.execute(
                text(
                    """
                    SELECT
                        p.id,
                        p.extra_metadata,
                        p.stage,
                        COUNT(s.id) AS total_submissions
                    FROM participants p
                    LEFT JOIN submissions s ON s.participant_id = p.id
                    WHERE p.public_id = :pub AND p.is_deleted = false
                    GROUP BY p.id, p.extra_metadata, p.stage
                    """
                ),
                {"pub": public_id},
            ).fetchone()
            if participant_row:
                participant_id = int(participant_row[0])
                participant_meta = participant_row[1] if isinstance(participant_row[1], dict) else {}
                participant_stage = str(participant_row[2] or "")
                try:
                    participant_stage = require_participant_stage(
                        participant_stage,
                        allowed_stages={"survey"},
                        event="random_image",
                    )
                except StateTransitionError:
                    return create_error_response(
                        "VAL_INVALID_STATE",
                        {"current_stage": participant_stage},
                    )
                total_submissions = int(participant_row[3] or 0)

                if total_submissions >= REQUIRED_SUBMISSIONS:
                    return create_error_response(
                        "VAL_INVALID_STATE",
                        {
                            "current_stage": "post-survey",
                            "reason": "submission_limit_reached",
                        },
                    )

                sequence_order, sequence_created = resolve_two_step_sequence(participant_meta)
                if sequence_created:
                    update_participant_metadata(
                        db,
                        participant_id=participant_id,
                        participant_meta=deepcopy(participant_meta),
                    )
                expected_step = expected_step_for_submission_count(sequence_order, total_submissions)
                if expected_step == STEP_ATTENTION:
                    should_prioritize_attention = True

        row = select_random_image_for_participant(
            db,
            excluded_set=excluded_set,
            participant_id=participant_id,
            should_prioritize_attention=should_prioritize_attention,
            now_ts=now_ts,
        )

        if not row:
            return create_error_response("NF_NO_IMAGES_AVAILABLE")

        is_attention_check = bool(row[3]) if len(row) > 3 else False
        return success_response({
            "image_id": row[0],
            "url": row[1],
            "is_survey": (bool(row[2]) if len(row) > 2 else True) and not is_attention_check,
            "is_attention_check": is_attention_check,
        })
    except Exception as e:
        # Keep errors logged but avoid noisy prints in production.
        import logging
        logging.getLogger(__name__).error(LOG_RANDOM_IMAGE_FAILED, e, getattr(g, "request_id", None))
        return create_error_response("SYS_RANDOM_IMAGE_QUERY_FAILED")


@image_bp.route(IMAGES_RESERVATION_RENEW_ROUTE, methods=["POST"])
@limiter.limit(PARTICIPANT_SESSION_RATE_LIMIT)
@track_performance
def renew_image_reservation():
    payload = request.json or {}
    public_id = str(payload.get(REQUEST_KEY_PUBLIC_ID) or request.cookies.get(PARTICIPANT_PUBLIC_COOKIE_NAME) or "").strip()
    image_id = str(payload.get(REQUEST_KEY_IMAGE_ID) or "").strip()

    if not public_id or not image_id:
        return success_response({"renewed": False, RESPONSE_KEY_EXPIRES_AT: None})

    try:
        db = get_db()
        participant_row = db.execute(
            QUERY_FETCH_PARTICIPANT_RESERVATION_CONTEXT,
            {"pub": public_id},
        ).fetchone()
        if participant_row is None:
            return success_response({"renewed": False, RESPONSE_KEY_EXPIRES_AT: None})

        participant_id = int(participant_row[0])
        participant_stage = str(participant_row[1] or "").strip()
        total_submissions = int(participant_row[2] or 0)
        if participant_stage != "survey" or total_submissions >= REQUIRED_SUBMISSIONS:
            return success_response({"renewed": False, RESPONSE_KEY_EXPIRES_AT: None})

        renewed_expires_at = renew_participant_image_reservation(
            db,
            participant_id=participant_id,
            image_id=image_id,
        )
        if renewed_expires_at is None:
            return success_response({"renewed": False, RESPONSE_KEY_EXPIRES_AT: None})

        db.commit()
        return success_response({
            "renewed": True,
            RESPONSE_KEY_EXPIRES_AT: renewed_expires_at.isoformat(),
        })
    except Exception:
        return success_response({"renewed": False, RESPONSE_KEY_EXPIRES_AT: None})
