"""Image routes module for C.O.G.N.I.T. backend."""

import time
from copy import deepcopy

from flask import request, g
from sqlalchemy import text

from app.constants.log_messages import LOG_RANDOM_IMAGE_FAILED
from app.constants.participant_constants import PARTICIPANT_STAGE_SURVEY
from app.constants.route_constants import IMAGES_RANDOM_ROUTE
from app.database import get_db
from app.utils.helpers import create_error_response, success_response
from app.utils.decorators import track_performance
from app.config import FORCE_ATTENTION_IMAGES
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
        force_attention = False
        participant_id = None
        if public_id:
            participant_row = db.execute(
                text(
                    """
                    SELECT id, extra_metadata, stage
                    FROM participants
                    WHERE public_id = :pub AND is_deleted = false
                    """
                ),
                {"pub": public_id},
            ).fetchone()
            if participant_row:
                participant_id = int(participant_row[0])
                participant_meta = participant_row[1] if isinstance(participant_row[1], dict) else {}
                participant_stage = str(participant_row[2] or "")
                if participant_stage != PARTICIPANT_STAGE_SURVEY:
                    return create_error_response(
                        "VAL_INVALID_STATE",
                        {"current_stage": participant_stage},
                    )
                total_submissions = db.execute(text("""
                    SELECT COUNT(*) FROM submissions
                    WHERE participant_id = :pid
                """), {"pid": participant_id}).scalar() or 0
                total_submissions = int(total_submissions)

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

        # Force attention images if env var is set.
        force_attention = FORCE_ATTENTION_IMAGES or should_prioritize_attention

        row = select_random_image_for_participant(
            db,
            excluded_set=excluded_set,
            participant_id=participant_id,
            should_prioritize_attention=should_prioritize_attention,
            now_ts=now_ts,
            force_attention=force_attention,
        )

        if not row:
            return create_error_response("NF_NO_IMAGES_AVAILABLE") if force_attention else create_error_response("SYS_RANDOM_IMAGE_FALLBACK_FAILED")

        return success_response({
            "image_id": row[0],
            "url": row[1],
            "is_survey": bool(row[2]) if len(row) > 2 else True,
            "is_attention_check": bool(row[3]) if len(row) > 3 else False,
        })
    except Exception as e:
        # Keep errors logged but avoid noisy prints in production.
        import logging
        logging.getLogger(__name__).error(LOG_RANDOM_IMAGE_FAILED, e, getattr(g, "request_id", None))
        return create_error_response("SYS_RANDOM_IMAGE_QUERY_FAILED")
