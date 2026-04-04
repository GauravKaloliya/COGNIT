"""Database engine and persistence config section."""

from __future__ import annotations

from .env import int_env, str_env, required_env, truthy_env


DATABASE_URL = required_env("DATABASE_URL")
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)
DATABASE_SSLMODE = str_env(
    "DATABASE_SSLMODE",
    "auto",
    choices={"auto", "disable", "allow", "prefer", "require", "verify-ca", "verify-full"},
)
RUNNING_ON_VERCEL = truthy_env("VERCEL")

DB_POOL_SIZE = int_env("DB_POOL_SIZE", 12, min_value=1, max_value=50)
DB_MAX_OVERFLOW = int_env("DB_MAX_OVERFLOW", 24, min_value=0, max_value=100)
DB_POOL_TIMEOUT_SECONDS = int_env("DB_POOL_TIMEOUT_SECONDS", 15, min_value=1, max_value=120)
DB_POOL_RECYCLE_SECONDS = int_env("DB_POOL_RECYCLE_SECONDS", 300 if RUNNING_ON_VERCEL else 1800, min_value=30, max_value=86400)
DB_SLOW_QUERY_LOG_THRESHOLD_MS = 1000
ENABLE_DB_QUERY_TIMING = True
IDEMPOTENCY_TTL_SECONDS = 3600
