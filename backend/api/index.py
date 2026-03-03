"""
Vercel Serverless Function Entry Point
Exports the Flask app for Vercel's Python runtime.
"""

import sys
import os

# Set up path for imports - Vercel's runtime needs this
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Import and configure logging first
from app.logging_config import configure_logging
configure_logging()

# Import the Flask app from main (which imports from app.extensions)
from main import app
