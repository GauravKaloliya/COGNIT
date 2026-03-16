"""
Database module for C.O.G.N.I.T. backend.
Handles SQLAlchemy engine, session management, and database connection lifecycle.
"""

from flask import g
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, scoped_session
from sqlalchemy.pool import QueuePool

from app.config import (
    DATABASE_URL,
    DATABASE_SSLMODE,
    DB_POOL_SIZE,
    DB_MAX_OVERFLOW,
    DB_POOL_TIMEOUT_SECONDS,
    DB_POOL_RECYCLE_SECONDS,
)
from app.extensions import app


# ────────────────────────────────────────────────
# Engine Configuration
# ────────────────────────────────────────────────

def _database_connect_args():
    # Respect explicit URL sslmode first.
    if "sslmode" in DATABASE_URL:
        return {}

    # Allow local Postgres without SSL while preserving production defaults.
    mode = (DATABASE_SSLMODE or "auto").strip().lower()
    if mode in {"disable", "allow", "prefer", "require", "verify-ca", "verify-full"}:
        return {"sslmode": mode}

    if mode == "auto":
        local_hosts = ("localhost", "127.0.0.1")
        if any(host in DATABASE_URL for host in local_hosts):
            return {"sslmode": "disable"}
        return {"sslmode": "require"}

    return {}


engine = create_engine(
    DATABASE_URL,
    poolclass=QueuePool,
    pool_size=max(1, DB_POOL_SIZE),
    max_overflow=max(0, DB_MAX_OVERFLOW),
    pool_timeout=max(1, DB_POOL_TIMEOUT_SECONDS),
    pool_recycle=max(30, DB_POOL_RECYCLE_SECONDS),
    pool_pre_ping=True,
    connect_args=_database_connect_args()
)


# ────────────────────────────────────────────────
# Session Factory
# ────────────────────────────────────────────────

SessionLocal = scoped_session(sessionmaker(bind=engine))


# ────────────────────────────────────────────────
# Database Helper Functions
# ────────────────────────────────────────────────

def get_db():
    """Get database session from Flask application context."""
    if "db" not in g:
        g.db = SessionLocal()
    return g.db


@app.teardown_appcontext
def teardown_db(exception):
    """Clean up database session on application context teardown."""
    db = g.pop("db", None)
    if db is not None:
        db.close()
    SessionLocal.remove()


@app.teardown_request
def rollback_on_exception(exception):
    """
    Ensure failed requests don't leave the session in an aborted state.
    This prevents 'current transaction is aborted' errors on subsequent requests.
    """
    if exception is None:
        return
    db = g.get("db")
    if db is None:
        return
    try:
        db.rollback()
    except Exception:
        # Never raise from teardown
        pass
