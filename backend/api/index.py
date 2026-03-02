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
configure_logging(os.getenv("LOG_LEVEL", "INFO"))

# Import the Flask application
from main import app as flask_app

# Export the Flask app for Vercel's Python runtime
# Vercel looks for a variable named 'app' in the handler file
app = flask_app


# For Vercel's Python runtime, the WSGI app is automatically detected
# when we export it as 'app'. Additional handlers below are for
# explicit serverless function patterns if needed.

def handler(event, context):
    """
    Lambda-style handler for Vercel serverless functions.
    This provides an alternative entry point if needed.
    
    Args:
        event: The event dict containing request data
        context: The runtime context
    
    Returns:
        Response dict compatible with Vercel's output format
    """
    return flask_app(event, context)
