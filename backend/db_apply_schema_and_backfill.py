import os
import subprocess
import sys
from pathlib import Path

from dotenv import dotenv_values
from sqlalchemy import create_engine, text

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"


def load_database_url() -> str:
    env_values = dotenv_values(BACKEND / ".env")
    database_url = (
        os.environ.get("DATABASE_URL")
        or env_values.get("DATABASE_URL")
        or env_values.get("POSTGRES_URL")
        or env_values.get("NEON_DATABASE_URL")
    )
    if not database_url:
        raise RuntimeError("DATABASE_URL is not set and was not found in backend/.env")
    os.environ["DATABASE_URL"] = database_url
    return database_url


MIGRATION_STATEMENTS = [
    """
    ALTER TABLE submissions
        ADD COLUMN IF NOT EXISTS too_fast_score NUMERIC(5,4)
        CHECK (too_fast_score BETWEEN 0 AND 1)
    """,
    """
    ALTER TABLE submissions
        ADD COLUMN IF NOT EXISTS too_fast_threshold_seconds REAL
        CHECK (too_fast_threshold_seconds >= 0)
    """,
    """
    ALTER TABLE submissions
        ADD COLUMN IF NOT EXISTS too_fast_margin_seconds REAL
    """,
    """
    ALTER TABLE submissions
        ADD COLUMN IF NOT EXISTS copy_paste_likelihood_score NUMERIC(5,4)
        CHECK (copy_paste_likelihood_score BETWEEN 0 AND 1)
    """,
    """
    ALTER TABLE submissions
        ADD COLUMN IF NOT EXISTS typing_effort_risk NUMERIC(5,4)
        CHECK (typing_effort_risk BETWEEN 0 AND 1)
    """,
    """
    ALTER TABLE submissions
        ADD COLUMN IF NOT EXISTS speed_risk NUMERIC(5,4)
        CHECK (speed_risk BETWEEN 0 AND 1)
    """,
    """
    ALTER TABLE submissions
        ADD COLUMN IF NOT EXISTS session_integrity_risk NUMERIC(5,4)
        CHECK (session_integrity_risk BETWEEN 0 AND 1)
    """,
    """
    ALTER TABLE submissions
        ADD COLUMN IF NOT EXISTS watchlist_triggered BOOLEAN NOT NULL DEFAULT FALSE
    """,
    """
    ALTER TABLE submissions
        ADD COLUMN IF NOT EXISTS soft_review_recommended BOOLEAN NOT NULL DEFAULT FALSE
    """,
    """
    ALTER TABLE submissions
        ADD COLUMN IF NOT EXISTS enforcement_status VARCHAR(16) NOT NULL DEFAULT 'normal'
        CHECK (enforcement_status IN ('normal','watchlist','soft_flag','hard_flag'))
    """,
    """
    ALTER TABLE participant_attention_stats
        ADD COLUMN IF NOT EXISTS participant_enforcement_score NUMERIC(5,4) NOT NULL DEFAULT 0
        CHECK (participant_enforcement_score BETWEEN 0 AND 1)
    """,
    """
    ALTER TABLE participant_attention_stats
        ADD COLUMN IF NOT EXISTS watchlist_triggered BOOLEAN NOT NULL DEFAULT FALSE
    """,
    """
    ALTER TABLE participant_attention_stats
        ADD COLUMN IF NOT EXISTS enforcement_status VARCHAR(16) NOT NULL DEFAULT 'normal'
        CHECK (enforcement_status IN ('normal','watchlist','soft_flag','hard_flag'))
    """,
]


def apply_schema_changes(database_url: str) -> None:
    engine = create_engine(database_url, pool_pre_ping=True)
    with engine.begin() as conn:
        for index, statement in enumerate(MIGRATION_STATEMENTS, start=1):
            print(f"applying schema statement {index}/{len(MIGRATION_STATEMENTS)}...", flush=True)
            conn.execute(text(statement))
    print("schema changes applied", flush=True)


def run_backfill() -> None:
    print("starting chunked backfill...", flush=True)
    subprocess.run([sys.executable, str(BACKEND / "db_backfill.py")], check=True, cwd=str(ROOT), env=os.environ.copy())


def main() -> None:
    database_url = load_database_url()
    apply_schema_changes(database_url)
    run_backfill()


if __name__ == "__main__":
    main()
