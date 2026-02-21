"""
Routes package for C.O.G.N.I.T. backend.
Blueprint-based modular routing following Flask best practices.
"""

from app.routes.participant import participant_bp
from app.routes.image import image_bp
from app.routes.submission import submission_bp
from app.routes.payment import payment_bp


__all__ = [
    'participant_bp',
    'image_bp',
    'submission_bp',
    'payment_bp',
]