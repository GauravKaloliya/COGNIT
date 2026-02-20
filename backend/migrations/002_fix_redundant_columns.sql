-- =====================================================
-- Migration: Address Redundant Columns and Add Optimizations
-- Version: 002
-- Description:
--   1. Add updated_at timestamps to all tables
--   2. Create partial indexes for better performance
--   3. Add comments for documentation
--   4. Optimize index structure
-- Note: Full denormalization removal requires application changes
-- This migration focuses on safety improvements and optimizations
-- =====================================================

BEGIN;

-- Add updated_at columns to all major tables
ALTER TABLE participants ADD COLUMN updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;
CREATE TRIGGER update_participants_updated_at
    BEFORE UPDATE ON participants
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE images ADD COLUMN updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;
CREATE TRIGGER update_images_updated_at
    BEFORE UPDATE ON images
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE attention_checks ADD COLUMN updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;
CREATE TRIGGER update_attention_checks_updated_at
    BEFORE UPDATE ON attention_checks
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE attention_stats ADD COLUMN updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;
CREATE TRIGGER update_attention_stats_updated_at
    BEFORE UPDATE ON attention_stats
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE submissions ADD COLUMN updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;
CREATE TRIGGER update_submissions_updated_at
    BEFORE UPDATE ON submissions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE consent_records ADD COLUMN updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;
CREATE TRIGGER update_consent_records_updated_at
    BEFORE UPDATE ON consent_records
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE participant_stats ADD COLUMN updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;
CREATE TRIGGER update_participant_stats_updated_at
    BEFORE UPDATE ON participant_stats
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE reward_winners ADD COLUMN updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;
CREATE TRIGGER update_reward_winners_updated_at
    BEFORE UPDATE ON reward_winners
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Create partial index for active attention checks (optimization)
CREATE INDEX idx_attention_checks_active_only
    ON attention_checks(image_id)
    WHERE is_active = TRUE;

-- Create partial index for flagged attention stats (optimization)
CREATE INDEX idx_attention_stats_flagged_only
    ON attention_stats(participant_fk)
    WHERE is_flagged = TRUE;

-- Create partial index for survey submissions (optimization)
CREATE INDEX idx_submissions_is_survey_true
    ON submissions(participant_fk, created_at DESC)
    WHERE is_survey = TRUE;

-- Create partial index for attention submissions (optimization)
CREATE INDEX idx_submissions_is_attention_true
    ON submissions(participant_fk, created_at DESC)
    WHERE is_attention = TRUE;

-- Create partial index for high-quality submissions (optimization)
CREATE INDEX idx_submissions_high_quality
    ON submissions(participant_fk, quality_score DESC)
    WHERE quality_score >= 0.8;

-- Create partial index for AI-suspected submissions (optimization)
CREATE INDEX idx_submissions_ai_suspected_true
    ON submissions(participant_fk, created_at DESC)
    WHERE ai_suspected = TRUE;

-- Create partial index for paid participants (optimization)
CREATE INDEX idx_participants_paid
    ON participants(participant_id)
    WHERE payment_status = 'paid';

-- Create partial index for participants who gave consent (optimization)
CREATE INDEX idx_participants_consent_given
    ON participants(participant_id)
    WHERE consent_given = TRUE;

-- Add unique constraint on images.image_url to prevent duplicates
ALTER TABLE images ADD CONSTRAINT unique_image_url
    UNIQUE (image_url);

-- Add comments for better documentation
COMMENT ON COLUMN participants.updated_at IS 'Timestamp of last update to this record';
COMMENT ON COLUMN images.updated_at IS 'Timestamp of last update to this record';
COMMENT ON COLUMN submissions.updated_at IS 'Timestamp of last update to this record';
COMMENT ON COLUMN attention_stats.updated_at IS 'Timestamp of last update to attention statistics';
COMMENT ON COLUMN participant_stats.updated_at IS 'Timestamp of last update to participant statistics';

-- Add index for composite queries (optimization)
CREATE INDEX idx_submissions_participant_survey_quality
    ON submissions(participant_fk, is_survey, quality_score DESC);

CREATE INDEX idx_participant_stats_priority_eligible_true
    ON participant_stats(participant_fk, attention_score DESC)
    WHERE priority_eligible = TRUE;

COMMIT;

-- =====================================================
-- Verification Queries
-- =====================================================

-- Check that all updated_at columns exist
SELECT
    table_name,
    column_name
FROM information_schema.columns
WHERE table_schema = 'public'
    AND column_name = 'updated_at'
ORDER BY table_name;

-- Check that partial indexes were created
SELECT
    indexname,
    tablename
FROM pg_indexes
WHERE schemaname = 'public'
    AND indexdef LIKE '%WHERE%'
ORDER BY tablename, indexname;

-- Check that triggers were created
SELECT
    trigger_name,
    event_object_table
FROM information_schema.triggers
WHERE trigger_name LIKE '%updated_at%'
ORDER BY event_object_table;
