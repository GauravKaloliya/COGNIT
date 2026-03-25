"""
Database module for C.O.G.N.I.T. backend.
Handles SQLAlchemy engine, session management, and database connection lifecycle.
"""

from contextlib import suppress
import logging
import time

from flask import g
from sqlalchemy import create_engine
from sqlalchemy import event
from sqlalchemy.orm import sessionmaker, scoped_session
from sqlalchemy.pool import QueuePool

from app.config import (
    DATABASE_URL,
    DATABASE_SSLMODE,
    DB_POOL_SIZE,
    DB_MAX_OVERFLOW,
    DB_POOL_TIMEOUT_SECONDS,
    DB_POOL_RECYCLE_SECONDS,
    DB_SLOW_QUERY_LOG_THRESHOLD_MS,
    ENABLE_DB_QUERY_TIMING,
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

logger = logging.getLogger(__name__)


if ENABLE_DB_QUERY_TIMING:
    @event.listens_for(engine, "before_cursor_execute")
    def _before_cursor_execute(conn, _cursor, statement, _parameters, _context, _executemany):
        conn.info["query_start_time"] = time.perf_counter()
        conn.info["query_statement"] = statement


    @event.listens_for(engine, "after_cursor_execute")
    def _after_cursor_execute(conn, _cursor, statement, _parameters, _context, _executemany):
        start = conn.info.pop("query_start_time", None)
        _ = conn.info.pop("query_statement", None)
        if start is None:
            return
        elapsed_ms = (time.perf_counter() - start) * 1000.0
        if elapsed_ms < DB_SLOW_QUERY_LOG_THRESHOLD_MS:
            return
        normalized = " ".join(str(statement or "").split())
        logger.warning(
            "db_slow_query threshold_ms=%s duration_ms=%.1f sql=%s",
            DB_SLOW_QUERY_LOG_THRESHOLD_MS,
            elapsed_ms,
            normalized[:400],
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
def teardown_db(_exception):
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
    with suppress(Exception):
        db.rollback()
