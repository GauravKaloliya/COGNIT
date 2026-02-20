-- =====================================================
-- Migration: Critical Bug Fixes and Data Integrity Improvements
-- Version: 6.0.0
-- =====================================================
-- This migration addresses critical bugs, data integrity risks,
-- concurrency issues, and security issues identified in the codebase.

-- =====================================================
-- 1. Fix survey_index to allow NULL for non-survey submissions
-- =====================================================

-- Drop the old constraint
ALTER TABLE submissions DROP CONSTRAINT IF EXISTS unique_participant_survey_index;

-- Allow NULL for survey_index
ALTER TABLE submissions ALTER COLUMN survey_index DROP NOT NULL;

-- Create partial unique index (only applies when survey_index IS NOT NULL)
CREATE UNIQUE INDEX IF NOT EXISTS unique_survey_index
ON submissions(participant_fk, survey_index)
WHERE survey_index IS NOT NULL;

-- =====================================================
-- 2. Add CHECK constraints for gender and native_language
-- =====================================================

ALTER TABLE participants
DROP CONSTRAINT IF EXISTS valid_gender;

ALTER TABLE participants
ADD CONSTRAINT valid_gender CHECK (
    gender IS NULL OR
    gender IN ('male', 'female', 'non-binary', 'prefer-not-say', 'other')
);

ALTER TABLE participants
DROP CONSTRAINT IF EXISTS valid_native_language;

ALTER TABLE participants
ADD CONSTRAINT valid_native_language CHECK (
    native_language IS NULL OR
    native_language IN (
        'english', 'hindi', 'bengali', 'telugu', 'marathi', 'tamil', 'urdu',
        'gujarati', 'kannada', 'malayalam', 'other'
    )
);

-- =====================================================
-- 3. Add composite index for analytics queries
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_submissions_participant_created
ON submissions(participant_fk, created_at DESC);

-- =====================================================
-- 4. Improve email validation constraint
-- =====================================================

-- Drop old constraint
ALTER TABLE participants DROP CONSTRAINT IF EXISTS valid_email;

-- Add improved constraint
ALTER TABLE participants
ADD CONSTRAINT valid_email CHECK (
    email IS NULL OR
    email ~ '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
);

-- =====================================================
-- NOTES:
-- =====================================================
-- The following fixes are implemented in app.py and do not require schema changes:
--
-- - Quality score calculation (attention_passed = None is now treated as neutral)
-- - IPv6 support in get_ip_hash()
-- - Random image selection using offset instead of ORDER BY RANDOM()
-- - CSP policy construction with proper directives
-- - Session_id length validation (10-100 characters)
-- - Improved word count regex (counts alphabetic tokens only)
-- - Atomic SQL operations for participant stats and attention stats
-- - Transaction isolation level set to REPEATABLE_READ
-- - Performance logging with sampling (10% by default)
-- - Bot detection for submissions
--
-- ProxyFix note:
-- If deploying behind a reverse proxy, you MUST configure ProxyFix:
-- from werkzeug.middleware.proxy_fix import ProxyFix
-- app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)
