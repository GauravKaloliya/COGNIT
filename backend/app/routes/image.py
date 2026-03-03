"""
Image routes module for C.O.G.N.I.T. backend.
Handles random image selection for survey.
"""

from flask import jsonify, request
from sqlalchemy import text

from app.database import get_db
from app.utils.helpers import create_error_response
from app.utils.decorators import track_performance
from app.config import ATTENTION_INTERVAL


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
    """Get a random image with deterministic attention-check placement."""
    exclude = request.args.get("exclude", "")
    excluded = [x.strip() for x in exclude.split(",") if x.strip()]
    public_id = (request.args.get("public_id") or "").strip()

    try:
        db = get_db()
        if ATTENTION_INTERVAL <= 0:
            raise ValueError("ATTENTION_INTERVAL must be > 0")

        should_prioritize_attention = False
        participant_id = None
        if public_id:
            p_row = db.execute(text("""
                SELECT id FROM participants
                WHERE public_id = :pub AND is_deleted = false
            """), {"pub": public_id}).fetchone()
            if p_row:
                participant_id = p_row[0]
                total_submissions = db.execute(text("""
                    SELECT COUNT(*) FROM submissions
                    WHERE participant_id = :pid
                """), {"pid": participant_id}).scalar() or 0
                should_prioritize_attention = ((total_submissions + 1) % ATTENTION_INTERVAL) == 0

        excluded_clause = "AND i.image_id NOT IN :ex" if excluded else ""
        params = {"ex": tuple(excluded)} if excluded else {}

        attention_row = None
        if should_prioritize_attention:
            attention_row = db.execute(text(f"""
                SELECT i.image_id, i.url
                FROM images i
                JOIN attention_checks ac ON ac.image_id = i.id
                WHERE ac.is_active = true
                {excluded_clause}
                ORDER BY random()
                LIMIT 1
            """), params).fetchone()

        row = attention_row
        if not row:
            row = db.execute(text(f"""
                SELECT i.image_id, i.url
                FROM images i
                LEFT JOIN attention_checks ac ON ac.image_id = i.id AND ac.is_active = true
                WHERE ac.image_id IS NULL
                {excluded_clause}
                ORDER BY random()
                LIMIT 1
            """), params).fetchone()

        if not row and should_prioritize_attention:
            row = db.execute(text(f"""
                SELECT i.image_id, i.url
                FROM images i
                {('WHERE i.image_id NOT IN :ex' if excluded else '')}
                ORDER BY random()
                LIMIT 1
            """), params).fetchone()

        if not row:
            return create_error_response("INTERNAL_ERROR")

        return jsonify({"image_id": row[0], "url": row[1]})
    except Exception as e:
        print(f"[ERROR] random_image failed: {e}", flush=True)
        return create_error_response("DATABASE_ERROR")
