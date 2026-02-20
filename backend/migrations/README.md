# Database Migrations

This directory contains SQL migration files to fix critical bugs, security issues, data integrity problems, and performance concerns in the C.O.G.N.I.T. database schema.

## Migration Order

Migrations must be run in the following order to ensure proper dependencies:

1. **000_create_updated_at_function.sql** - Creates the reusable function for updating `updated_at` columns
2. **001_fix_critical_schema_issues.sql** - Fixes critical schema constraints and data integrity issues
3. **002_fix_redundant_columns.sql** - Adds optimization indexes, timestamps, and documentation

## Running Migrations

### Using psql (Direct Database Connection)

```bash
# Run all migrations in order
psql $DATABASE_URL -f migrations/000_create_updated_at_function.sql
psql $DATABASE_URL -f migrations/001_fix_critical_schema_issues.sql
psql $DATABASE_URL -f migrations/002_fix_redundant_columns.sql
```

### Using Python (Application Context)

```python
from sqlalchemy import text

def run_migration(engine, migration_file):
    with open(migration_file, 'r') as f:
        sql = f.read()
    with engine.connect() as conn:
        conn.execute(text(sql))
        conn.commit()
```

## Migration Details

### Migration 000: Create update_updated_at_column Function

**Purpose**: Creates a reusable PostgreSQL function for automatically updating `updated_at` timestamp columns.

**Changes**:
- Creates `update_updated_at_column()` function

### Migration 001: Fix Critical Schema Issues

**Purpose**: Addresses critical schema constraint problems that could cause data corruption and migration failures.

**Critical Fixes**:
- **Duplicate constraint names**: Fixed `attention_score_range` being used in multiple tables (PostgreSQL requires globally unique constraint names)
- **Attention stats validation**: Changed from `>=` to strict `=` equality for `total_checks = passed_checks + failed_checks`
- **Payment status validation**: Added CHECK constraint for valid payment states
- **Image validation**: Added constraints for difficulty_score, object_count, width, height
- **Time spent validation**: Made `time_spent_seconds` NOT NULL with default 0
- **Description/feedback length**: Added minimum length constraints
- **AI suspected constraint**: Simplified and made more logical

**Changes**:
- Drops and recreates `attention_score_range` constraints with unique names
- Adds strict equality CHECK constraint for attention_stats
- Adds comprehensive validation constraints
- Adds partial indexes for performance optimization

### Migration 002: Fix Redundant Columns and Add Optimizations

**Purpose**: Improves query performance, adds audit trails, and better documents the schema.

**Changes**:
- Adds `updated_at` timestamp columns to all major tables with automatic triggers
- Creates partial indexes for common query patterns
- Adds unique constraint on `images.image_url`
- Adds comprehensive table/column comments for documentation

## Verification

Each migration file includes verification queries at the bottom. Run these after applying each migration to ensure everything was applied correctly.

## Rollback

Migrations are designed to be applied safely to production databases. However, if you need to rollback:

1. Review the migration file to understand what changes were made
2. Manually revert the changes using DDL statements
3. For most migrations involving constraints and indexes, you can simply drop and recreate them

## Important Notes

- Always test migrations on a staging database first
- These migrations fix issues identified in the comprehensive audit
- Some migrations may take time to complete on large tables due to index creation
- The `updated_at` function migration (000) is a prerequisite for migration 002

## Future Improvements

While these migrations address the most critical issues, there are additional improvements that could be made in future migrations:

- Full removal of redundant `participant_id` columns (requires application code changes)
- Table partitioning for high-growth tables (`audit_log`, `performance_metrics`)
- Row-Level Security (RLS) for multi-tenant scenarios
- Soft-delete mechanism implementation
- Data archival policies for old logs and metrics
