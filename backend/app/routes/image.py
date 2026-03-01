"""
Image routes module for C.O.G.N.I.T. backend.
Handles random image selection for survey.
"""

import random

from flask import jsonify, request, current_app
from sqlalchemy import text

from app.database import get_db
from app.utils.helpers import create_error_response
from app.utils.decorators import track_performance


# ────────────────────────────────────────────────
# Blueprint Setup
# ────────────────────────────────────────────────

from flask import Blueprint
image_bp = Blueprint('image', __name__)


# ────────────────────────────────────────────────
# Routes
# ────────────────────────────────────────────────

@image_bp.route("/images/random")
@track_performance
def random_image():
    """Get a random image for the survey, optionally excluding specific images."""
    exclude = request.args.get("exclude", "")
    excluded = [x.strip() for x in exclude.split(",") if x.strip()]

    try:
        db = get_db()
        where = "WHERE image_id NOT IN :ex" if excluded else ""
        params = {"ex": tuple(excluded)} if excluded else {}

        count = db.execute(text(f"SELECT COUNT(*) FROM images {where}"), params).scalar()
        if count == 0:
            return create_error_response("NO_IMAGES")

        offset = random.randint(0, count - 1)
        row = db.execute(text(f"""
            SELECT image_id, url
            FROM images
            {where}
            OFFSET :off LIMIT 1
        """), {**params, "off": offset}).fetchone()

        if not row:
            return create_error_response("INTERNAL_ERROR")

        return jsonify({"image_id": row[0], "url": row[1]})
    except Exception:
        current_app.logger.exception("random_image failed")
        return create_error_response("DATABASE_ERROR")
