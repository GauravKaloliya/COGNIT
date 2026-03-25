"""
C.O.G.N.I.T. Backend Application Package
Modular Flask application following 2025 best practices.
"""

from app.extensions import app, limiter
from app.database import engine, SessionLocal, get_db, teardown_db
from app.routes import participant_bp, image_bp, submission_bp


__all__ = [
    'app',
    'limiter',
    'engine',
    'SessionLocal',
    'get_db',
    'teardown_db',
    'participant_bp',
    'image_bp',
    'submission_bp',
]
