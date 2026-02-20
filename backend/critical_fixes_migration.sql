-- =====================================================
-- Migration: Critical Security & Data Integrity Fixes
-- Version: 7.0.0
-- =====================================================
-- This migration addresses critical database schema issues
-- identified in the security audit.

-- =====================================================
-- 1. Fix CHAR(64) to VARCHAR(64) for ip_hash columns
-- =====================================================
-- CHAR pads with spaces internally which can cause:
-- - Comparison inconsistencies
-- - Index inefficiencies
-- - Hidden whitespace bugs

ALTER TABLE participants ALTER COLUMN ip_hash TYPE VARCHAR(64);
ALTER TABLE submissions ALTER COLUMN ip_hash TYPE VARCHAR(64);
ALTER TABLE consent_records ALTER COLUMN ip_hash TYPE VARCHAR(64);
ALTER TABLE audit_log ALTER COLUMN ip_hash TYPE VARCHAR(64);

-- =====================================================
-- 2. Remove redundant participant_id columns from child tables
-- =====================================================
-- Problem: participant_id was duplicated across all child tables
-- Risk: Data divergence if bugs change participant_id in parent
-- Solution: Rely exclusively on participant_fk foreign key

-- attention_stats
ALTER TABLE attention_stats DROP COLUMN IF EXISTS participant_id;
DROP INDEX IF EXISTS idx_attention_stats_participant_id;
DROP CONSTRAINT IF EXISTS unique_attention_stats_participant_id;

-- submissions
ALTER TABLE submissions DROP COLUMN IF EXISTS participant_id;
DROP INDEX IF EXISTS idx_submissions_participant_id;

-- consent_records
ALTER TABLE consent_records DROP COLUMN IF EXISTS participant_id;
DROP INDEX IF EXISTS idx_consent_participant_id;

-- participant_stats
ALTER TABLE participant_stats DROP COLUMN IF EXISTS participant_id;
DROP INDEX IF EXISTS idx_participant_stats_participant_id;

-- reward_winners
ALTER TABLE reward_winners DROP COLUMN IF EXISTS participant_id;
DROP INDEX IF EXISTS idx_reward_winners_participant_id;

-- audit_log
ALTER TABLE audit_log DROP COLUMN IF EXISTS participant_id;
DROP INDEX IF EXISTS idx_audit_participant_id;

-- =====================================================
-- 3. Remove redundant image_url from submissions
-- =====================================================
-- Problem: image_url denormalized when image_id already references images table
-- Risk: Image URL updates won't propagate, storage bloat, data drift
ALTER TABLE submissions DROP COLUMN IF EXISTS image_url;

-- =====================================================
-- 4. Add composite index for session_id + participant_fk queries
-- =====================================================
-- Performance improvement for submissions filtered by session and participant
CREATE INDEX IF NOT EXISTS idx_submissions_session_participant 
ON submissions(session_id, participant_fk);

-- =====================================================
-- 5. Increase audit_log.details length constraint
-- =====================================================
-- Current constraint of 2000 is too small for transaction_id, gateway, amount
-- Expand to accommodate longer values
ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_details_check;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_details_check 
CHECK (details IS NULL OR length(details) <= 4000);

-- =====================================================
-- 6. Add DB-level validation for session_id, username, phone
-- =====================================================
-- Add CHECK constraints for better data integrity

-- session_id format validation (10-100 characters, alphanumeric + _-)
ALTER TABLE participants DROP CONSTRAINT IF EXISTS valid_session_id_format;
ALTER TABLE participants ADD CONSTRAINT valid_session_id_format
CHECK (length(session_id) BETWEEN 10 AND 100 AND session_id ~ '^[a-zA-Z0-9_-]+$');

-- username format validation (3-100 characters)
ALTER TABLE participants DROP CONSTRAINT IF EXISTS valid_username_format;
ALTER TABLE participants ADD CONSTRAINT valid_username_format
CHECK (username IS NULL OR (length(username) BETWEEN 3 AND 100));

-- phone format validation (basic Indian phone number patterns)
ALTER TABLE participants DROP CONSTRAINT IF EXISTS valid_phone_format;
ALTER TABLE participants ADD CONSTRAINT valid_phone_format
CHECK (phone IS NULL OR (
    (length(phone) BETWEEN 10 AND 15) AND
    phone ~ '^[0-9+()-\s]+$'
));

-- =====================================================
-- NOTES
-- =====================================================
-- The following app.py fixes are applied separately:
--
-- 1. _log_performance_metric() now commits its own transaction
-- 2. confirm_payment() uses FOR UPDATE in a single query to avoid race conditions
-- 3. Submissions duplicate check removed (rely on unique index)
-- 4. Consent timestamps now use datetime objects instead of ISO strings
-- 5. Email domains configurable via ALLOWED_EMAIL_DOMAINS env var
-- 6. IP hash security improved with TRUST_X_FORWARDED_FOR env var
-- 7. Performance metrics logging improved with better error handling
-- 8. Database transaction isolation considerations for critical sections