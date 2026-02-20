-- =====================================================
-- Migration for Critical Fixes
-- Version: 6.0.0
-- =====================================================

BEGIN;

-- =====================================================
-- 1. Remove participant_id redundancy from child tables
-- =====================================================

-- Drop unique constraints on participant_id in child tables
ALTER TABLE attention_stats DROP CONSTRAINT IF EXISTS unique_attention_stats_participant_id;
ALTER TABLE consent_records DROP CONSTRAINT IF EXISTS consent_records_participant_id_key;
ALTER TABLE participant_stats DROP CONSTRAINT IF EXISTS unique_participant_stats_participant_id;
ALTER TABLE reward_winners DROP CONSTRAINT IF EXISTS unique_reward_participant_id;

-- Drop participant_id columns
ALTER TABLE attention_stats DROP COLUMN IF EXISTS participant_id;
ALTER TABLE consent_records DROP COLUMN IF EXISTS participant_id;
ALTER TABLE participant_stats DROP COLUMN IF EXISTS participant_id;
ALTER TABLE reward_winners DROP COLUMN IF EXISTS participant_id;
ALTER TABLE submissions DROP COLUMN IF EXISTS participant_id;

-- =====================================================
-- 2. Change ip_hash from CHAR(64) to VARCHAR(64)
-- =====================================================

ALTER TABLE participants ALTER COLUMN ip_hash TYPE VARCHAR(64);
ALTER TABLE consent_records ALTER COLUMN ip_hash TYPE VARCHAR(64);
ALTER TABLE submissions ALTER COLUMN ip_hash TYPE VARCHAR(64);
ALTER TABLE audit_log ALTER COLUMN ip_hash TYPE VARCHAR(64);

-- =====================================================
-- 3. Remove redundant image_url from submissions
-- =====================================================

ALTER TABLE submissions DROP COLUMN IF EXISTS image_url;

-- =====================================================
-- 4. Increase audit_log.details constraint from 2000 to 10000
-- =====================================================

ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_details_check;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_details_check CHECK (length(details) <= 10000);

-- =====================================================
-- 5. Add DB-level validation constraints
-- =====================================================

-- Add session_id format constraint to participants
ALTER TABLE participants ADD CONSTRAINT IF NOT EXISTS valid_session_id
CHECK (session_id ~ '^[a-zA-Z0-9_-]{10,100}$');

-- Add username format constraint to participants
ALTER TABLE participants ADD CONSTRAINT IF NOT EXISTS valid_username
CHECK (username ~ '^[a-zA-Z0-9_]{3,50}$');

-- Add phone format constraint to participants (Indian phone numbers)
ALTER TABLE participants ADD CONSTRAINT IF NOT EXISTS valid_phone_format
CHECK (phone IS NULL OR phone ~ '^[+]?[91]?[6-9]\d{9}$');

-- =====================================================
-- 6. Add partial unique index for reward_winners paid status
-- =====================================================

-- This ensures only one row per participant can have status='paid'
CREATE UNIQUE INDEX IF NOT EXISTS unique_reward_participant_paid
ON reward_winners(participant_fk)
WHERE status = 'paid';

-- =====================================================
-- 7. Drop redundant indexes on participant_id
-- =====================================================

DROP INDEX IF EXISTS idx_submissions_participant_id;
DROP INDEX IF EXISTS idx_consent_participant_id;
DROP INDEX IF EXISTS idx_attention_stats_participant_id;
DROP INDEX IF EXISTS idx_participant_stats_participant_id;
DROP INDEX IF EXISTS idx_reward_winners_participant_id;
DROP INDEX IF EXISTS idx_audit_participant_id;

-- =====================================================
-- 8. Add composite index on submissions(session_id, participant_fk)
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_submissions_session_participant
ON submissions(session_id, participant_fk);

COMMIT;
