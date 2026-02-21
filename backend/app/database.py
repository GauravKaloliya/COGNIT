"""
Database module for C.O.G.N.I.T. backend.
Handles SQLAlchemy engine, session management, and database connection lifecycle.
"""

from flask import g
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, scoped_session
from sqlalchemy.pool import NullPool

from app.config import DATABASE_URL
from app.extensions import app


# ────────────────────────────────────────────────
# Engine Configuration
# ────────────────────────────────────────────────

engine = create_engine(
    DATABASE_URL,
    poolclass=NullPool,
    pool_pre_ping=True,
    connect_args={"sslmode": "require"} if "sslmode" not in DATABASE_URL else {}
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