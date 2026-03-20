"""
Vercel Serverless Function Entry Point
Exports the Flask app for Vercel's Python runtime.
"""

import sys
import os

# Set up path for imports - Vercel's runtime needs this
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Import the Flask app from main (which imports from app.extensions)
from main import app  # noqa: E402

# WSGI compatibility alias used by some runtimes.
application = app
