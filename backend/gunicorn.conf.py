"""
Gunicorn configuration file for C.O.G.N.I.T. backend
This file provides production-optimized Gunicorn settings for deployment.

Updated for modular app structure - now uses application factory pattern.
"""

import os
import multiprocessing

# WSGI application entry point (modular structure)
wsgi_app = 'main:app'

# Server socket
bind = os.getenv("GUNICORN_BIND", "0.0.0.0:5000")
backlog = 2048

# Worker processes
# Calculate workers based on CPU cores (2-4 workers is recommended for most applications)
workers = int(os.getenv("GUNICORN_WORKERS", max(2, multiprocessing.cpu_count() * 2 + 1)))
worker_class = os.getenv("GUNICORN_WORKER_CLASS", "sync")
threads = int(os.getenv("GUNICORN_THREADS", "4"))
worker_connections = 1000
max_requests = int(os.getenv("GUNICORN_MAX_REQUESTS", "1000"))
max_requests_jitter = int(os.getenv("GUNICORN_MAX_REQUESTS_JITTER", "50"))
timeout = int(os.getenv("GUNICORN_TIMEOUT", "60"))
keepalive = int(os.getenv("GUNICORN_KEEPALIVE", "5"))

# Process naming
proc_name = "cognit-backend"

# Server mechanics
daemon = False
pidfile = None
umask = 0
user = None
group = None
tmp_upload_dir = None

# Logging
accesslog = "-"
errorlog = "-"
loglevel = os.getenv("GUNICORN_LOG_LEVEL", "info")
access_log_format = os.getenv(
    "GUNICORN_ACCESS_LOG_FORMAT",
    '%(m)s %(U)s %(s)s %(L)ss'
)

# Process naming
def when_ready(server):
    """Called just after the server is started."""
    print(f"Gunicorn server is ready. Listening on {bind}")

def pre_fork(server, worker):
    """Called just before a worker is forked."""
    pass

def post_fork(server, worker):
    """Called just after a worker has been forked."""
    print(f"Worker spawned (pid: {worker.pid})")

def pre_exec(server):
    """Called just before a new master process is forked."""
    print("Forked child, re-executing.")

def worker_int(worker):
    """Called when a worker receives the INT or QUIT signal."""
    print(f"Worker received INT or QUIT signal (pid: {worker.pid})")

def worker_abort(worker):
    """Called when a worker receives the SIGABRT signal."""
    print(f"Worker received SIGABRT signal (pid: {worker.pid})")

def child_exit(server, worker):
    """Called just after a worker has been exited."""
    print(f"Worker exited (pid: {worker.pid})")

# SSL (if needed)
keyfile = None
certfile = None
ssl_version = None
cert_reqs = 0  # 0 = ssl.CERT_NONE, None causes error
ca_certs = None
suppress_ragged_eofs = True
do_handshake_on_connect = True
ciphers = None

# Server hooks
def on_starting(server):
    """Called just before the master process is initialized."""
    print("Starting Gunicorn server...")

def nworkers_changed(server, new_value, old_value):
    """Called when the number of workers changes."""
    print(f"Number of workers changed from {old_value} to {new_value}")
