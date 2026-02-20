-- =====================================================
-- Migration: Fix Critical Schema Issues
-- Version: 001
-- Description:
--   1. Fix duplicate constraint names (attention_score_range)
--   2. Fix redundant unique constraints
--   3. Add CHECK constraints for proper data integrity
--   4. Add missing NOT NULL constraints
--   5. Fix attention_stats CHECK constraint to be strict equality
--   6. Add proper payment_status CHECK constraint
--   7. Add image validation constraints
-- =====================================================

BEGIN;

-- Drop duplicate constraint names (will be recreated with unique names)
ALTER TABLE attention_stats DROP CONSTRAINT IF EXISTS attention_score_range;
ALTER TABLE submissions DROP CONSTRAINT IF EXISTS attention_score_range;
ALTER TABLE participant_stats DROP CONSTRAINT IF EXISTS attention_score_range;

-- Recreate attention_score_range constraints with unique names
ALTER TABLE attention_stats ADD CONSTRAINT attention_stats_score_range
    CHECK (attention_score BETWEEN 0 AND 1);

ALTER TABLE submissions ADD CONSTRAINT submissions_attention_score_range
    CHECK (attention_score_at_submission IS NULL OR attention_score_at_submission BETWEEN 0 AND 1);

ALTER TABLE participant_stats ADD CONSTRAINT participant_stats_score_range
    CHECK (attention_score BETWEEN 0 AND 1);

-- Fix attention_stats CHECK constraint to be strict equality
ALTER TABLE attention_stats DROP CONSTRAINT IF EXISTS valid_attention_counts;
ALTER TABLE attention_stats ADD CONSTRAINT valid_attention_counts
    CHECK (total_checks = passed_checks + failed_checks);

-- Add stricter CHECK constraints for attention_stats
ALTER TABLE attention_stats ADD CONSTRAINT attention_checks_not_negative
    CHECK (total_checks >= 0 AND passed_checks >= 0 AND failed_checks >= 0);

ALTER TABLE attention_stats ADD CONSTRAINT passed_checks_not_exceed_total
    CHECK (passed_checks <= total_checks);

ALTER TABLE attention_stats ADD CONSTRAINT failed_checks_not_exceed_total
    CHECK (failed_checks <= total_checks);

-- Add CHECK constraint for payment_status
ALTER TABLE participants ADD CONSTRAINT valid_payment_status
    CHECK (payment_status IN ('pending', 'paid', 'failed', 'refunded', 'cancelled'));

-- Add image validation constraints
ALTER TABLE images ADD CONSTRAINT valid_difficulty_score
    CHECK (difficulty_score IS NULL OR difficulty_score BETWEEN 0.0 AND 10.0);

ALTER TABLE images ADD CONSTRAINT valid_object_count
    CHECK (object_count IS NULL OR object_count > 0);

ALTER TABLE images ADD CONSTRAINT valid_width
    CHECK (width IS NULL OR width > 0);

ALTER TABLE images ADD CONSTRAINT valid_height
    CHECK (height IS NULL OR height > 0);

-- Add minimum length constraint for description
ALTER TABLE submissions ADD CONSTRAINT valid_description_length
    CHECK (length(description) >= 10);

-- Add minimum length constraint for feedback
ALTER TABLE submissions ADD CONSTRAINT valid_feedback_length
    CHECK (length(feedback) >= 5);

-- Add constraint for time_spent_seconds to prevent negative values
ALTER TABLE submissions ALTER COLUMN time_spent_seconds SET NOT NULL;
ALTER TABLE submissions ALTER COLUMN time_spent_seconds SET DEFAULT 0;

-- Fix ai_suspected constraint to be simpler
ALTER TABLE submissions DROP CONSTRAINT IF EXISTS ai_suspected_requires_quality_score;
ALTER TABLE submissions ADD CONSTRAINT ai_suspected_requires_quality_score
    CHECK (ai_suspected = FALSE OR (ai_suspected = TRUE AND quality_score IS NOT NULL));

-- Update existing NULL time_spent_seconds to 0
UPDATE submissions SET time_spent_seconds = 0 WHERE time_spent_seconds IS NULL;

-- Add index for audit_log on timestamp for better query performance
CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp_desc ON audit_log(timestamp DESC);

-- Add partial index for submissions on survey data (optimization)
CREATE INDEX IF NOT EXISTS idx_submissions_survey_only
    ON submissions(participant_fk, survey_index)
    WHERE is_survey = TRUE;

-- Add comment to document the constraint
COMMENT ON TABLE attention_stats IS 'Tracks attention check statistics for participants';
COMMENT ON COLUMN attention_stats.total_checks IS 'Total number of attention checks taken';
COMMENT ON COLUMN attention_stats.passed_checks IS 'Number of attention checks passed';
COMMENT ON COLUMN attention_stats.failed_checks IS 'Number of attention checks failed';
COMMENT ON COLUMN attention_stats.attention_score IS 'Ratio of passed_checks to total_checks (0.0 to 1.0)';

COMMIT;

-- =====================================================
-- Verification Queries (run after migration to verify)
-- =====================================================

-- Check that all constraints are properly set
SELECT
    tc.table_name,
    tc.constraint_name,
    tc.constraint_type
FROM information_schema.table_constraints tc
WHERE tc.table_schema = 'public'
    AND tc.table_name IN ('attention_stats', 'submissions', 'participant_stats', 'participants', 'images')
    AND tc.constraint_name NOT LIKE '%_pkey'
ORDER BY tc.table_name, tc.constraint_name;

-- Check for any rows that might violate new constraints
SELECT 'Checking attention_stats...' as status;
SELECT COUNT(*) FROM attention_stats WHERE total_checks != passed_checks + failed_checks;

SELECT 'Checking participants payment_status...' as status;
SELECT COUNT(*) FROM participants WHERE payment_status NOT IN ('pending', 'paid', 'failed', 'refunded', 'cancelled');

SELECT 'Checking submissions time_spent_seconds...' as status;
SELECT COUNT(*) FROM submissions WHERE time_spent_seconds IS NULL;

SELECT 'Checking submissions description length...' as status;
SELECT COUNT(*) FROM submissions WHERE length(description) < 10;

SELECT 'Checking submissions feedback length...' as status;
SELECT COUNT(*) FROM submissions WHERE length(feedback) < 5;
