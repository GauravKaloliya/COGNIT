-- =====================================================
-- Migration: Create update_updated_at_column Function
-- Version: 000 (must be run before other migrations)
-- Description:
--   Creates a reusable function for updating updated_at columns
--   This is a prerequisite for migrations that add updated_at triggers
-- =====================================================

BEGIN;

-- Create or replace the function (safe to run multiple times)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add comment
COMMENT ON FUNCTION update_updated_at_column() IS 'Automatically updates updated_at column to current timestamp on row update';

COMMIT;

-- Verification
SELECT routine_name, routine_type
FROM information_schema.routines
WHERE routine_schema = 'public'
    AND routine_name = 'update_updated_at_column';
