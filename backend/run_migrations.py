#!/usr/bin/env python3
"""
Database Migration Runner for C.O.G.N.I.T.

This script runs SQL migration files in the correct order.
It's designed to be idempotent and safe to run multiple times.

Usage:
    python run_migrations.py
"""

import os
import sys
from pathlib import Path
from sqlalchemy import create_engine, text
import traceback


def get_database_url():
    """Get database URL from environment variable."""
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        print("ERROR: DATABASE_URL environment variable is required")
        sys.exit(1)

    if database_url.startswith("postgres://"):
        database_url = database_url.replace("postgres://", "postgresql://", 1)

    return database_url


def run_migration_file(engine, migration_file):
    """Run a single migration file."""
    print(f"\n{'='*60}")
    print(f"Running migration: {migration_file.name}")
    print(f"{'='*60}")

    try:
        with open(migration_file, 'r') as f:
            sql = f.read()

        with engine.connect() as conn:
            conn.execute(text(sql))
            conn.commit()

        print(f"✅ Successfully executed {migration_file.name}")
        return True

    except Exception as e:
        print(f"❌ Failed to execute {migration_file.name}")
        print(f"Error: {str(e)}")
        traceback.print_exc()
        return False


def main():
    """Main migration runner."""
    print("C.O.G.N.I.T. Database Migration Runner")
    print("=" * 60)

    database_url = get_database_url()
    print(f"Database URL: {database_url[:20]}...")

    try:
        engine = create_engine(database_url)
        print("✅ Database connection established")

        migrations_dir = Path(__file__).parent / "migrations"

        if not migrations_dir.exists():
            print(f"❌ Migrations directory not found: {migrations_dir}")
            sys.exit(1)

        # Get all migration files in correct order
        migration_files = sorted(migrations_dir.glob("*.sql"))

        if not migration_files:
            print("❌ No migration files found")
            sys.exit(1)

        print(f"\nFound {len(migration_files)} migration files:")
        for i, f in enumerate(migration_files, 1):
            print(f"  {i}. {f.name}")

        print("\nStarting migrations...")

        failed_migrations = []
        for migration_file in migration_files:
            if not run_migration_file(engine, migration_file):
                failed_migrations.append(migration_file.name)

        print(f"\n{'='*60}")
        if failed_migrations:
            print(f"❌ Migration completed with {len(failed_migrations)} failure(s)")
            print(f"Failed migrations: {', '.join(failed_migrations)}")
            sys.exit(1)
        else:
            print("✅ All migrations completed successfully!")
            print("\nNext steps:")
            print("  1. Verify the schema changes")
            print("  2. Run the verification queries in migration files")
            print("  3. Test the application with the new schema")

    except Exception as e:
        print(f"\n❌ Fatal error during migration: {str(e)}")
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
