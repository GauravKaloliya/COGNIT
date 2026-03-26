"""Image routes module for C.O.G.N.I.T. backend."""

import time
from copy import deepcopy

from flask import request, g
from sqlalchemy import text

from app.constants.log_messages import LOG_RANDOM_IMAGE_FAILED
from app.constants.route_constants import IMAGES_RANDOM_ROUTE
from app.database import get_db
from app.services.state_machine_service import StateTransitionError, require_participant_stage
from app.utils.helpers import create_error_response, success_response
from app.utils.decorators import track_performance
from app.services.image_service import (
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


# ────────────────────────────────────────────────
# Routes
# ────────────────────────────────────────────────


@image_bp.route(IMAGES_RANDOM_ROUTE)
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
