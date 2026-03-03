"""
Vercel Serverless Function Entry Point
Converts Flask WSGI app to Vercel-compatible response format.
"""

from app.logging_config import configure_logging
configure_logging()

import json
import io
from flask import Flask
from werkzeug.wrappers import Request, Response

from main import app as flask_app


def handler(request):
    """
    Vercel serverless function handler.
    Converts Vercel request to WSGI, calls Flask, then converts WSGI response back.
    """
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
        'wsgi.errors': __import__('sys').stderr,
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
    if request.path.startswith('/api/') or request.path.startswith('/docs') or request.path.startswith('/health') or request.path.startswith('/check-'):
        if 'content-type' not in resp_headers:
            resp_headers['content-type'] = 'application/json'

    return {
        'statusCode': response_status,
        'headers': resp_headers,
        'body': response_body.decode('utf-8') if response_body else '',
    }
