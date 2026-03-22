"""Image routes module for C.O.G.N.I.T. backend."""

import time

from flask import request, g
from sqlalchemy import text

from app.constants.log_messages import LOG_RANDOM_IMAGE_FAILED
from app.constants.route_constants import IMAGES_RANDOM_ROUTE
from app.database import get_db
from app.utils.helpers import create_error_response, success_response
from app.utils.decorators import track_performance
from app.utils.runtime_cache import resolve_participant_id
from app.config import ATTENTION_INTERVAL, FORCE_ATTENTION_IMAGES
from app.services.image_service import (
    select_random_image_for_participant,
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
    """Get a random image with deterministic attention-check placement."""
    exclude = request.args.get("exclude", "")
    excluded = [x.strip() for x in exclude.split(",") if x.strip()]
    excluded_set = set(excluded)
    public_id = (request.args.get("public_id") or "").strip()
    force_attention_raw = (request.args.get("force_attention") or "").strip().lower()
    force_attention_requested = force_attention_raw in ("1", "true", "yes", "on")

    try:
        db = get_db()
        now_ts = int(time.time())
        if ATTENTION_INTERVAL <= 0:
            raise ValueError("ATTENTION_INTERVAL must be > 0")

        should_prioritize_attention = False
        force_attention = False
        participant_id = None
        if public_id:
            participant_id = resolve_participant_id(db, public_id)
            if participant_id:
                total_submissions = db.execute(text("""
                    SELECT COUNT(*) FROM submissions
                    WHERE participant_id = :pid
                """), {"pid": participant_id}).scalar() or 0
                should_prioritize_attention = ((total_submissions + 1) % ATTENTION_INTERVAL) == 0

        # Safe override to force attention images (gated by env).
        if force_attention_requested and FORCE_ATTENTION_IMAGES:
            force_attention = True

        row = select_random_image_for_participant(
            db,
            excluded_set=excluded_set,
            participant_id=participant_id,
            should_prioritize_attention=should_prioritize_attention,
            now_ts=now_ts,
            force_attention=force_attention,
        )

        if not row:
            return create_error_response("NO_IMAGES") if force_attention else create_error_response("INTERNAL_ERROR")

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
        return create_error_response("DATABASE_ERROR")
