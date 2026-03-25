"""Database engine and persistence config section."""

from __future__ import annotations

from .env import str_env, required_env


DATABASE_URL = required_env("DATABASE_URL")
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)
DATABASE_SSLMODE = str_env(
    "DATABASE_SSLMODE",
    "auto",
    choices={"auto", "disable", "allow", "prefer", "require", "verify-ca", "verify-full"},
)

DB_POOL_SIZE = 10
DB_MAX_OVERFLOW = 20
DB_POOL_TIMEOUT_SECONDS = 30
DB_POOL_RECYCLE_SECONDS = 1800
DB_SLOW_QUERY_LOG_THRESHOLD_MS = 120
ENABLE_DB_QUERY_TIMING = True
IDEMPOTENCY_TTL_SECONDS = 86400

