"""
Vercel Python Runtime WSGI handler.
Main entry point for Vercel serverless functions.
This module adapts the Flask application for Vercel's serverless runtime.
"""

import sys
import os

# Add the backend directory to Python path for imports
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

# Import and configure logging first
from app.logging_config import configure_logging
configure_logging()

from main import app as flask_app

app = flask_app
