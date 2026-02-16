import sys
import os

# Add parent directory to path so we can import app.py
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import app

# Vercel serverless function handler
# This handler is used when deploying as a Vercel serverless function
def handler(event, context):
    """
    Vercel serverless function handler.
    Vercel will automatically detect and call this function.
    """
    return app

# Export the Flask app for Vercel
# Vercel's Python runtime will use this as the default handler
app = app
