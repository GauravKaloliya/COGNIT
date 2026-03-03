"""
Vercel Serverless Function Entry Point
Converts Flask WSGI app to Vercel-compatible response format.
"""

import json
import io
import sys

# Set up path for imports
sys.path.insert(0, '/home/engine/project/backend')

# Import and configure logging early
from app.logging_config import configure_logging
configure_logging()

from flask import Flask, jsonify
from werkzeug.wrappers import Request, Response

# Create a minimal Flask app for Vercel - we'll import the actual app from main
_vercel_app = None

def get_flask_app():
    """Lazy-load the Flask app to avoid circular imports during Vercel detection."""
    global _vercel_app
    if _vercel_app is None:
        from main import app as flask_app
        _vercel_app = flask_app
    return _vercel_app


def handler(request):
    """
    Vercel serverless function handler.
    Converts Vercel request to WSGI, calls Flask, then converts WSGI response back.
    """
    # Get the Flask app
    flask_app = get_flask_app()
    
    # Get the request body
    body = request.body
    if body is None:
        body = b''
    
    # Build headers dict from Vercel request headers
    headers = {}
    for key, value in request.headers.items():
        headers[key] = value
    
    # Create a WSGI environment from the Vercel request
    environ = {
        'REQUEST_METHOD': request.method,
        'SCRIPT_NAME': '',
        'PATH_INFO': request.path,
        'QUERY_STRING': request.query if request.query else '',
        'SERVER_NAME': headers.get('Host', 'localhost'),
        'SERVER_PORT': '443',  # Vercel uses 443 for https
        'SERVER_PROTOCOL': 'HTTP/1.1',
        'HTTP_HOST': headers.get('Host', 'localhost'),
        'HTTP_ACCEPT': headers.get('Accept', '*/*'),
        'HTTP_ACCEPT_ENCODING': headers.get('Accept-Encoding', ''),
        'HTTP_ACCEPT_LANGUAGE': headers.get('Accept-Language', ''),
        'HTTP_USER_AGENT': headers.get('User-Agent', ''),
        'HTTP_X_FORWARDED_FOR': headers.get('X-Forwarded-For', ''),
        'CONTENT_TYPE': headers.get('Content-Type', ''),
        'CONTENT_LENGTH': str(len(body)) if body else '0',
        'wsgi.url_scheme': 'https',
        'wsgi.input': io.BytesIO(body),
        'wsgi.errors': sys.stderr,
        'wsgi.multithread': True,
        'wsgi.multiprocess': True,
        'wsgi.run_once': False,
    }

    # Collect response from Flask
    response_parts = []
    response_headers = []
    response_status = 200

    def start_response(status, headers, exc_info=None):
        nonlocal response_status, response_headers
        response_status = int(status.split()[0])
        response_headers = dict(headers)
        return lambda x: response_parts.append(x)

    # Call the Flask app
    wsgi_response = flask_app(environ, start_response)
    
    # Combine response parts
    response_body = b''.join(wsgi_response)
    if isinstance(response_body, str):
        response_body = response_body.encode('utf-8')

    # Convert headers to Vercel format
    resp_headers = {}
    for key, value in response_headers.items():
        resp_headers[key.lower()] = value

    # Default content-type to JSON for API routes
    path = request.path
    if path.startswith('/api/') or path.startswith('/docs') or path.startswith('/health') or path.startswith('/check-') or path.startswith('/participants') or path.startswith('/images') or path.startswith('/submit') or path.startswith('/consent') or path.startswith('/payments') or path.startswith('/engagement'):
        if 'content-type' not in resp_headers:
            resp_headers['content-type'] = 'application/json'

    return {
        'statusCode': response_status,
        'headers': resp_headers,
        'body': response_body.decode('utf-8') if response_body else '',
    }
