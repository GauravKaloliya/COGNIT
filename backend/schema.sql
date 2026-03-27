-- =====================================================================
-- C.O.G.N.I.T. Database Schema
-- Compatible with NeonDB (serverless PostgreSQL)
-- =====================================================================

-- =====================================================================
-- EXTENSIONS (NeonDB supports standard PostgreSQL extensions)
-- =====================================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gin;

-- =====================================================================
-- HELPER FUNCTIONS
-- =====================================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_last_seen()
RETURNS TRIGGER AS $$
BEGIN
    NEW.last_seen_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION set_participant_stage_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.stage IS DISTINCT FROM OLD.stage THEN
        NEW.stage_updated_at = CURRENT_TIMESTAMP;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sync_attention_stats_from_submission()
RETURNS TRIGGER AS $$
DECLARE
    total_checks_count INTEGER := 0;
    passed_checks_count INTEGER := 0;
    failed_checks_count INTEGER := 0;
    consecutive_failures_count INTEGER := 0;
    suspicious_recent_count INTEGER := 0;
    weighted_total NUMERIC := 0.0;
    weight_sum NUMERIC := 0.0;
    recent_attention_score_value NUMERIC(5,4);
    hard_flag BOOLEAN := FALSE;
    soft_flag BOOLEAN := FALSE;
    tier_value TEXT;
    confidence_value NUMERIC;
    assessment_index INTEGER := 0;
    checked_at_value TIMESTAMPTZ := COALESCE(NEW.created_at, CURRENT_TIMESTAMP);
BEGIN
    IF NEW.is_attention_check IS DISTINCT FROM TRUE THEN
        RETURN NEW;
    END IF;

    SELECT
        COUNT(*),
        COUNT(*) FILTER (WHERE attention_passed = TRUE),
        COUNT(*) FILTER (WHERE attention_passed = FALSE)
    INTO total_checks_count, passed_checks_count, failed_checks_count
    FROM submissions
    WHERE participant_id = NEW.participant_id
      AND is_attention_check = TRUE;

    FOR tier_value, confidence_value IN
        SELECT
            attention_tier,
            COALESCE(attention_confidence, 0.0)
        FROM submissions
        WHERE participant_id = NEW.participant_id
          AND is_attention_check = TRUE
        ORDER BY created_at DESC, id DESC
        LIMIT 10
    LOOP
        EXIT WHEN tier_value = 'pass';
        consecutive_failures_count := consecutive_failures_count + 1;
    END LOOP;

    FOR tier_value, confidence_value IN
        SELECT attention_tier, COALESCE(attention_confidence, 0.0)
        FROM (
            SELECT attention_tier, attention_confidence, created_at, id
            FROM submissions
            WHERE participant_id = NEW.participant_id
              AND is_attention_check = TRUE
            ORDER BY created_at DESC, id DESC
            LIMIT 10
        ) recent
        ORDER BY created_at ASC, id ASC
    LOOP
        assessment_index := assessment_index + 1;
        weight_sum := weight_sum + assessment_index;
        weighted_total := weighted_total + assessment_index * (
            0.75 * CASE tier_value
                WHEN 'pass' THEN 1.0
                WHEN 'weak_pass' THEN 0.78
                WHEN 'suspicious' THEN 0.32
                ELSE 0.0
            END
            + 0.25 * LEAST(GREATEST(COALESCE(confidence_value, 0.0), 0.0), 1.0)
        );

        IF tier_value IN ('suspicious', 'fail') THEN
            suspicious_recent_count := suspicious_recent_count + 1;
        END IF;
    END LOOP;

    recent_attention_score_value := CASE
        WHEN weight_sum > 0 THEN ROUND(weighted_total / weight_sum, 4)
        ELSE NULL
    END;

    hard_flag := (
        consecutive_failures_count >= 2
        OR suspicious_recent_count >= 3
        OR COALESCE(NEW.hard_flag_triggered, FALSE)
    );
    soft_flag := (
        (
            total_checks_count >= 4
            AND recent_attention_score_value IS NOT NULL
            AND recent_attention_score_value < 0.50
        )
        OR suspicious_recent_count >= 2
        OR COALESCE(NEW.soft_flag_triggered, FALSE)
    );

    INSERT INTO participant_attention_stats (
        participant_id,
        total_checks,
        passed_checks,
        failed_checks,
        attention_score,
        recent_attention_score,
        consecutive_failures,
        hard_flag_triggered,
        soft_flag_triggered,
        is_flagged,
        last_checked_at
    ) VALUES (
        NEW.participant_id,
        total_checks_count,
        passed_checks_count,
        failed_checks_count,
        COALESCE(recent_attention_score_value, 1.0),
        recent_attention_score_value,
        consecutive_failures_count,
        hard_flag,
        soft_flag,
        hard_flag OR soft_flag,
        checked_at_value
    )
    ON CONFLICT (participant_id) DO UPDATE SET
        total_checks = total_checks_count,
        passed_checks = passed_checks_count,
        failed_checks = failed_checks_count,
        attention_score = COALESCE(recent_attention_score_value, participant_attention_stats.attention_score),
        recent_attention_score = COALESCE(recent_attention_score_value, participant_attention_stats.recent_attention_score),
        consecutive_failures = consecutive_failures_count,
        hard_flag_triggered = hard_flag,
        soft_flag_triggered = soft_flag,
        is_flagged = participant_attention_stats.is_flagged OR hard_flag OR soft_flag,
        last_checked_at = checked_at_value;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION validate_attention_event_consistency()
RETURNS TRIGGER AS $$
DECLARE
    sub_participant_id BIGINT;
    sub_image_id BIGINT;
    sub_is_attention BOOLEAN;
BEGIN
    SELECT s.participant_id, s.image_id, s.is_attention_check
    INTO sub_participant_id, sub_image_id, sub_is_attention
    FROM submissions s
    WHERE s.id = NEW.submission_id;

    IF sub_participant_id IS NULL THEN
        RAISE EXCEPTION 'attention_event submission does not exist: %', NEW.submission_id;
    END IF;

    IF sub_is_attention IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'attention_event must reference an attention-check submission: %', NEW.submission_id;
    END IF;

    IF NEW.participant_id IS DISTINCT FROM sub_participant_id THEN
        RAISE EXCEPTION 'attention_event participant mismatch for submission %', NEW.submission_id;
    END IF;

    IF NEW.image_id IS DISTINCT FROM sub_image_id THEN
        RAISE EXCEPTION 'attention_event image mismatch for submission %', NEW.submission_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION prevent_attention_event_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'attention_events is append-only';
END;
$$ LANGUAGE plpgsql;

-- =====================================================================
-- LOOKUP TABLES
-- =====================================================================
CREATE TABLE IF NOT EXISTS genders (
    code         VARCHAR(32) PRIMARY KEY,
    display_name VARCHAR(100) NOT NULL,
    sort_order   SMALLINT DEFAULT 0,
    active       BOOLEAN DEFAULT TRUE
);

INSERT INTO genders (code, display_name, sort_order)
VALUES
    ('male',          'Male',           1),
    ('female',        'Female',         2),
    ('non-binary',    'Non-binary',     3),
    ('prefer-not-say','Prefer not to say',4),
    ('other',         'Other',          5)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS languages (
    code        VARCHAR(20) PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    native_name VARCHAR(100),
    active      BOOLEAN DEFAULT TRUE
);

INSERT INTO languages (code, name, native_name)
VALUES
    ('en',   'English',   'English'),
    ('hi',   'Hindi',     'हिन्दी'),
    ('bn',   'Bengali',   'বাংলা'),
    ('te',   'Telugu',    'తెలుగు'),
    ('mr',   'Marathi',   'मराठी'),
    ('ta',   'Tamil',     'தமிழ்'),
    ('ur',   'Urdu',      'اُردُو'),
    ('gu',   'Gujarati',  'ગુજરાતી'),
    ('kn',   'Kannada',   'ಕನ್ನಡ'),
    ('ml',   'Malayalam', 'മലയാളം'),
    ('other','Other',     NULL)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS prior_experiences (
    code             VARCHAR(64) PRIMARY KEY,
    display_name     VARCHAR(120) NOT NULL,
    group_label      VARCHAR(80) NOT NULL,
    group_sort_order SMALLINT NOT NULL DEFAULT 0,
    sort_order       SMALLINT NOT NULL DEFAULT 0,
    active           BOOLEAN DEFAULT TRUE
);

INSERT INTO prior_experiences (code, display_name, group_label, group_sort_order, sort_order)
VALUES
    ('programming_software_development', 'Programming/Software Development', 'Technical Skills', 1, 1),
    ('data_science_machine_learning', 'Data Science/Machine Learning', 'Technical Skills', 1, 2),
    ('web_development', 'Web Development', 'Technical Skills', 1, 3),
    ('mobile_app_development', 'Mobile App Development', 'Technical Skills', 1, 4),
    ('database_administration', 'Database Administration', 'Technical Skills', 1, 5),
    ('cloud_computing', 'Cloud Computing', 'Technical Skills', 1, 6),
    ('cybersecurity', 'Cybersecurity', 'Technical Skills', 1, 7),
    ('network_administration', 'Network Administration', 'Technical Skills', 1, 8),
    ('devops_ci_cd', 'DevOps/CI-CD', 'Technical Skills', 1, 9),
    ('computer_vision_ai', 'Computer Vision/AI', 'Technical Skills', 1, 10),
    ('writing_content_creation', 'Writing/Content Creation', 'General Skills', 2, 1),
    ('public_speaking', 'Public Speaking', 'General Skills', 2, 2),
    ('photography', 'Photography', 'General Skills', 2, 3),
    ('art_design_creative', 'Art/Design/Creative', 'General Skills', 2, 4),
    ('music_performance', 'Music/Performance', 'General Skills', 2, 5),
    ('sports_athletics', 'Sports/Athletics', 'General Skills', 2, 6),
    ('cooking_culinary', 'Cooking/Culinary', 'General Skills', 2, 7),
    ('none', 'None', 'Other', 99, 1)
ON CONFLICT (code) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_genders_active_sort
    ON genders (active, sort_order, display_name);
CREATE INDEX IF NOT EXISTS idx_languages_active_name
    ON languages (active, name);
CREATE INDEX IF NOT EXISTS idx_prior_experiences_active_sort
    ON prior_experiences (active, group_sort_order, sort_order, display_name);

-- =====================================================================
-- MAIN TABLES
-- =====================================================================
-- App-layer ownership note:
-- participant progression and submission workflow
-- eligibility are enforced in backend services. The schema keeps structural
-- integrity, timestamp convenience triggers, and immutable audit protections.
CREATE TABLE IF NOT EXISTS participants (
    id               BIGSERIAL PRIMARY KEY,
    public_id        UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    session_id       VARCHAR(128) NOT NULL,
    username         VARCHAR(50) NOT NULL,
    email            VARCHAR(255),
    gender_code      VARCHAR(32) REFERENCES genders(code),
    age              SMALLINT CHECK (age >= 13 AND age <= 100),
    location         VARCHAR(120),
    language_code    VARCHAR(20) REFERENCES languages(code),
    prior_experience VARCHAR(64) REFERENCES prior_experiences(code),
    consent_given    BOOLEAN NOT NULL DEFAULT FALSE,
    consent_at       TIMESTAMPTZ,
    email_verified   BOOLEAN NOT NULL DEFAULT FALSE,
    email_verified_at TIMESTAMPTZ,
    stage VARCHAR(32) NOT NULL DEFAULT 'consent'
        CHECK (stage IN ('consent','user-details','survey','post-survey')),
    stage_updated_at TIMESTAMPTZ,
    ip_hash          CHAR(64) NOT NULL CHECK (length(ip_hash) = 64),
    user_agent       VARCHAR(512),
    extra_metadata   JSONB NOT NULL DEFAULT '{}',
    is_deleted       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_email_format    CHECK (email ~* '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$' OR email IS NULL)
);

-- Convenience triggers: timestamp bookkeeping only.
CREATE TRIGGER trg_participants_updated_at
    BEFORE UPDATE ON participants
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_participants_stage_updated_at
    BEFORE UPDATE OF stage ON participants
    FOR EACH ROW EXECUTE FUNCTION set_participant_stage_updated_at();

-- Active-only unique constraints
CREATE UNIQUE INDEX IF NOT EXISTS idx_participants_active_username ON participants (username) WHERE is_deleted = false;
CREATE UNIQUE INDEX IF NOT EXISTS idx_participants_active_email    ON participants (email)    WHERE is_deleted = false AND email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_participants_public_id     ON participants (public_id);
CREATE INDEX IF NOT EXISTS idx_participants_session_id    ON participants (session_id);
CREATE INDEX IF NOT EXISTS idx_participants_email         ON participants (email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_participants_public_not_deleted
    ON participants (public_id, is_deleted);
CREATE INDEX IF NOT EXISTS idx_participants_public_email_not_deleted
    ON participants (public_id, email)
    WHERE is_deleted = false AND email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_participants_email_not_deleted
    ON participants (email, is_deleted) WHERE email IS NOT NULL;

COMMENT ON COLUMN participants.stage IS
    'App-owned participant progression stage used by frontend/backends to coordinate flow.';
COMMENT ON COLUMN participants.stage_updated_at IS
    'Convenience timestamp updated only when stage changes.';

-- Participant sessions (normalized session lifecycle model).
CREATE TABLE IF NOT EXISTS participant_sessions (
    id             BIGSERIAL PRIMARY KEY,
    participant_id BIGINT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    session_id     VARCHAR(128) NOT NULL,
    started_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at       TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uq_participant_sessions_participant_session UNIQUE (participant_id, session_id)
);

CREATE TRIGGER trg_participant_sessions_updated_at
    BEFORE UPDATE ON participant_sessions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_participant_sessions_participant_created
    ON participant_sessions (participant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_participant_sessions_session_id
    ON participant_sessions (session_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_participant_sessions_id_participant
    ON participant_sessions (id, participant_id);
CREATE INDEX IF NOT EXISTS idx_participant_sessions_active
    ON participant_sessions (participant_id, last_seen_at DESC)
    WHERE ended_at IS NULL;

-- Email OTPs (verification)
CREATE TABLE IF NOT EXISTS email_otps (
    id           BIGSERIAL PRIMARY KEY,
    public_id    UUID NOT NULL,
    email        VARCHAR(255) NOT NULL,
    otp_hash     CHAR(64) NOT NULL,
    attempts     SMALLINT NOT NULL DEFAULT 0,
    is_used      BOOLEAN NOT NULL DEFAULT FALSE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at   TIMESTAMPTZ NOT NULL,
    verified_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_email_otps_public_email ON email_otps (public_id, email);
CREATE INDEX IF NOT EXISTS idx_email_otps_expires_at ON email_otps (expires_at);
CREATE INDEX IF NOT EXISTS idx_email_otps_public_email_created
    ON email_otps (public_id, email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_otps_active_lookup
    ON email_otps (public_id, email, is_used, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_participants_consent       ON participants (consent_given);
CREATE INDEX IF NOT EXISTS idx_participants_active        ON participants (is_deleted) WHERE is_deleted = false;

-- =====================================================================
-- IMAGES & ATTENTION CHECKS
-- =====================================================================
CREATE TABLE IF NOT EXISTS images (
    id           BIGSERIAL PRIMARY KEY,
    image_id     VARCHAR(64) NOT NULL UNIQUE,
    url          TEXT NOT NULL,
    width        INTEGER CHECK (width > 0),
    height       INTEGER CHECK (height > 0),
    object_count SMALLINT CHECK (object_count >= 0),
    difficulty   NUMERIC(3,2) CHECK (difficulty BETWEEN 0 AND 10),
    tags         TEXT[],
    created_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER trg_images_updated_at
    BEFORE UPDATE ON images
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_images_image_id   ON images (image_id);
CREATE INDEX IF NOT EXISTS idx_images_difficulty ON images (difficulty);

CREATE TABLE IF NOT EXISTS attention_checks (
    id            BIGSERIAL PRIMARY KEY,
    image_id      BIGINT NOT NULL REFERENCES images(id) ON DELETE CASCADE,
    expected_word TEXT NOT NULL,
    is_strict     BOOLEAN NOT NULL DEFAULT TRUE,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT one_active_check_per_image UNIQUE (image_id)
        DEFERRABLE INITIALLY DEFERRED
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_attention_checks_active_unique
    ON attention_checks (image_id) WHERE is_active = true;

CREATE TABLE IF NOT EXISTS ground_truth_labels (
    image_id   BIGINT REFERENCES images(id) ON DELETE CASCADE,
    object     TEXT NOT NULL,
    is_present BOOLEAN NOT NULL DEFAULT TRUE,

    CONSTRAINT ground_truth_labels_pk PRIMARY KEY (image_id, object)
);

CREATE INDEX IF NOT EXISTS idx_ground_truth_labels_image
    ON ground_truth_labels (image_id);

CREATE TABLE IF NOT EXISTS image_reservations (
    image_public_id VARCHAR(64) PRIMARY KEY REFERENCES images(image_id) ON DELETE CASCADE,
    participant_id  BIGINT REFERENCES participants(id) ON DELETE CASCADE,
    reserved_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    released_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_image_reservations_participant_active
    ON image_reservations (participant_id, reserved_at DESC)
    WHERE released_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_image_reservations_expires_active
    ON image_reservations (expires_at)
    WHERE released_at IS NULL;

-- =====================================================================
-- SUBMISSIONS
-- =====================================================================
CREATE TABLE IF NOT EXISTS submissions (
    id                  BIGSERIAL PRIMARY KEY,
    request_id          UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    participant_id      BIGINT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    participant_session_id BIGINT,
    image_id            BIGINT NOT NULL REFERENCES images(id) ON DELETE RESTRICT,
    survey_index        INTEGER,
    description         TEXT NOT NULL CHECK (length(description) BETWEEN 60 AND 10000),
    word_count          INTEGER NOT NULL CHECK (word_count >= 0),
    rating              SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    feedback            TEXT NOT NULL CHECK (length(feedback) BETWEEN 5 AND 2000),
    time_spent_seconds  REAL NOT NULL DEFAULT 0 CHECK (time_spent_seconds >= 0),
    is_survey           BOOLEAN NOT NULL DEFAULT FALSE,
    is_attention_check  BOOLEAN NOT NULL DEFAULT FALSE,
    attention_passed    BOOLEAN,
    attention_tier      VARCHAR(16) CHECK (attention_tier IN ('pass','weak_pass','suspicious','fail')),
    attention_confidence NUMERIC(5,4) CHECK (attention_confidence BETWEEN 0 AND 1),
    expected_term_recall NUMERIC(5,4) CHECK (expected_term_recall BETWEEN 0 AND 1),
    matched_term_count  SMALLINT CHECK (matched_term_count >= 0),
    expected_term_count SMALLINT CHECK (expected_term_count >= 0),
    distinct_word_count SMALLINT CHECK (distinct_word_count >= 0),
    descriptive_token_count SMALLINT CHECK (descriptive_token_count >= 0),
    flagged_too_fast    BOOLEAN NOT NULL DEFAULT FALSE,
    quality_score       NUMERIC(5,4) CHECK (quality_score BETWEEN 0 AND 1),
    writing_quality_score NUMERIC(5,4) CHECK (writing_quality_score BETWEEN 0 AND 1),
    behavior_risk_score NUMERIC(5,4) CHECK (behavior_risk_score BETWEEN 0 AND 1),
    alignment_score     NUMERIC(5,4) CHECK (alignment_score BETWEEN 0 AND 1),
    alignment_precision NUMERIC(5,4) CHECK (alignment_precision BETWEEN 0 AND 1),
    alignment_recall NUMERIC(5,4) CHECK (alignment_recall BETWEEN 0 AND 1),
    alignment_object_f1 NUMERIC(5,4) CHECK (alignment_object_f1 BETWEEN 0 AND 1),
    alignment_relation_score NUMERIC(5,4) CHECK (alignment_relation_score BETWEEN 0 AND 1),
    alignment_scene_consistency_score NUMERIC(5,4) CHECK (alignment_scene_consistency_score BETWEEN 0 AND 1),
    alignment_wrong_object_penalty NUMERIC(5,4) CHECK (alignment_wrong_object_penalty BETWEEN 0 AND 1),
    alignment_natural_language_score NUMERIC(5,4) CHECK (alignment_natural_language_score BETWEEN 0 AND 1),
    alignment_stuffing_penalty NUMERIC(5,4) CHECK (alignment_stuffing_penalty BETWEEN 0 AND 1),
    supporting_signals  JSONB NOT NULL DEFAULT '{}',
    consecutive_failures SMALLINT NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
    hard_flag_triggered BOOLEAN NOT NULL DEFAULT FALSE,
    soft_flag_triggered BOOLEAN NOT NULL DEFAULT FALSE,
    ip_hash             CHAR(64) NOT NULL,
    user_agent          VARCHAR(512),
    device_type         VARCHAR(20),
    extra_metadata      JSONB NOT NULL DEFAULT '{}',
    tab_switch_count    INTEGER NOT NULL DEFAULT 0 CHECK (tab_switch_count >= 0),
    page_close_attempts INTEGER NOT NULL DEFAULT 0 CHECK (page_close_attempts >= 0),
    network_disconnects INTEGER NOT NULL DEFAULT 0 CHECK (network_disconnects >= 0),
    survey_time_spent_seconds REAL NOT NULL DEFAULT 0 CHECK (survey_time_spent_seconds >= 0),
    survey_page_views INTEGER NOT NULL DEFAULT 0 CHECK (survey_page_views >= 0),
    survey_tab_switches INTEGER NOT NULL DEFAULT 0 CHECK (survey_tab_switches >= 0),
    survey_page_close_attempts INTEGER NOT NULL DEFAULT 0 CHECK (survey_page_close_attempts >= 0),
    survey_network_disconnects INTEGER NOT NULL DEFAULT 0 CHECK (survey_network_disconnects >= 0),
    survey_max_scroll_depth_pct INTEGER NOT NULL DEFAULT 0 CHECK (survey_max_scroll_depth_pct BETWEEN 0 AND 100),
    survey_clicks INTEGER NOT NULL DEFAULT 0 CHECK (survey_clicks >= 0),
    survey_keypresses INTEGER NOT NULL DEFAULT 0 CHECK (survey_keypresses >= 0),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_submissions_participant_session
        FOREIGN KEY (participant_session_id, participant_id)
        REFERENCES participant_sessions(id, participant_id),
    CONSTRAINT unique_participant_survey UNIQUE (participant_id, survey_index) DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT chk_attention_passed_consistent CHECK (NOT (is_attention_check = true AND attention_passed IS NULL)),
    CONSTRAINT chk_submission_sequence_positive CHECK (survey_index IS NULL OR survey_index > 0)
);

-- Computed/scored submission columns kept as idempotent in-file migrations.
ALTER TABLE submissions
    ADD COLUMN IF NOT EXISTS attention_tier VARCHAR(16)
    CHECK (attention_tier IN ('pass','weak_pass','suspicious','fail'));
ALTER TABLE submissions
    ADD COLUMN IF NOT EXISTS attention_confidence NUMERIC(5,4)
    CHECK (attention_confidence BETWEEN 0 AND 1);
ALTER TABLE submissions
    ADD COLUMN IF NOT EXISTS expected_term_recall NUMERIC(5,4)
    CHECK (expected_term_recall BETWEEN 0 AND 1);
ALTER TABLE submissions
    ADD COLUMN IF NOT EXISTS matched_term_count SMALLINT
    CHECK (matched_term_count >= 0);
ALTER TABLE submissions
    ADD COLUMN IF NOT EXISTS expected_term_count SMALLINT
    CHECK (expected_term_count >= 0);
ALTER TABLE submissions
    ADD COLUMN IF NOT EXISTS distinct_word_count SMALLINT
    CHECK (distinct_word_count >= 0);
ALTER TABLE submissions
    ADD COLUMN IF NOT EXISTS descriptive_token_count SMALLINT
    CHECK (descriptive_token_count >= 0);
ALTER TABLE submissions
    ADD COLUMN IF NOT EXISTS writing_quality_score NUMERIC(5,4)
    CHECK (writing_quality_score BETWEEN 0 AND 1);
ALTER TABLE submissions
    ADD COLUMN IF NOT EXISTS behavior_risk_score NUMERIC(5,4)
    CHECK (behavior_risk_score BETWEEN 0 AND 1);
ALTER TABLE submissions
    ADD COLUMN IF NOT EXISTS alignment_precision NUMERIC(5,4)
    CHECK (alignment_precision BETWEEN 0 AND 1);
ALTER TABLE submissions
    ADD COLUMN IF NOT EXISTS alignment_recall NUMERIC(5,4)
    CHECK (alignment_recall BETWEEN 0 AND 1);
ALTER TABLE submissions
    ADD COLUMN IF NOT EXISTS alignment_object_f1 NUMERIC(5,4)
    CHECK (alignment_object_f1 BETWEEN 0 AND 1);
ALTER TABLE submissions
    ADD COLUMN IF NOT EXISTS alignment_relation_score NUMERIC(5,4)
    CHECK (alignment_relation_score BETWEEN 0 AND 1);
ALTER TABLE submissions
    ADD COLUMN IF NOT EXISTS alignment_scene_consistency_score NUMERIC(5,4)
    CHECK (alignment_scene_consistency_score BETWEEN 0 AND 1);
ALTER TABLE submissions
    ADD COLUMN IF NOT EXISTS alignment_wrong_object_penalty NUMERIC(5,4)
    CHECK (alignment_wrong_object_penalty BETWEEN 0 AND 1);
ALTER TABLE submissions
    ADD COLUMN IF NOT EXISTS alignment_natural_language_score NUMERIC(5,4)
    CHECK (alignment_natural_language_score BETWEEN 0 AND 1);
ALTER TABLE submissions
    ADD COLUMN IF NOT EXISTS alignment_stuffing_penalty NUMERIC(5,4)
    CHECK (alignment_stuffing_penalty BETWEEN 0 AND 1);
ALTER TABLE submissions
    ADD COLUMN IF NOT EXISTS supporting_signals JSONB NOT NULL DEFAULT '{}';
ALTER TABLE submissions
    ADD COLUMN IF NOT EXISTS consecutive_failures SMALLINT NOT NULL DEFAULT 0
    CHECK (consecutive_failures >= 0);
ALTER TABLE submissions
    ADD COLUMN IF NOT EXISTS hard_flag_triggered BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE submissions
    ADD COLUMN IF NOT EXISTS soft_flag_triggered BOOLEAN NOT NULL DEFAULT FALSE;

-- Derived stats trigger kept intentionally small and local to submissions.
CREATE TRIGGER trg_sync_attention_stats_from_submission
    AFTER INSERT ON submissions
    FOR EACH ROW
    WHEN (NEW.is_attention_check = true AND NEW.attention_passed IS NOT NULL)
    EXECUTE FUNCTION sync_attention_stats_from_submission();

CREATE INDEX IF NOT EXISTS idx_submissions_participant_created ON submissions (participant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_submissions_participant_session
    ON submissions (participant_session_id)
    WHERE participant_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_submissions_participant_quality ON submissions (participant_id, quality_score DESC, created_at DESC) WHERE is_survey = true;
CREATE INDEX IF NOT EXISTS idx_submissions_attention ON submissions (is_attention_check, attention_passed);
CREATE INDEX IF NOT EXISTS idx_submissions_attention_quality ON submissions (is_attention_check, attention_passed, quality_score);
CREATE INDEX IF NOT EXISTS idx_submissions_participant_survey
    ON submissions (participant_id, is_survey, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_submissions_participant_survey_index_desc
    ON submissions (participant_id, survey_index DESC)
    WHERE survey_index IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_submissions_participant_image_non_survey
    ON submissions (participant_id, image_id, created_at DESC) WHERE is_survey = false;

-- =====================================================================
-- SUBMISSION BEHAVIOR METRICS (PHASE 2)
-- =====================================================================
CREATE TABLE IF NOT EXISTS submission_behavior_metrics (
    submission_id BIGINT PRIMARY KEY REFERENCES submissions(id) ON DELETE CASCADE,
    time_before_typing_seconds REAL,
    edit_count INTEGER,
    backspace_count INTEGER,
    avg_keystroke_interval_seconds REAL,
    keystroke_variance REAL,
    pause_count INTEGER,
    avg_pause_duration_seconds REAL,
    revision_bursts INTEGER NOT NULL DEFAULT 0 CHECK (revision_bursts >= 0),
    hesitation_score REAL NOT NULL DEFAULT 0 CHECK (hesitation_score BETWEEN 0 AND 1),
    submitted_without_typing_pause BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE submission_behavior_metrics
    ADD COLUMN IF NOT EXISTS revision_bursts INTEGER NOT NULL DEFAULT 0 CHECK (revision_bursts >= 0);
ALTER TABLE submission_behavior_metrics
    ADD COLUMN IF NOT EXISTS hesitation_score REAL NOT NULL DEFAULT 0 CHECK (hesitation_score BETWEEN 0 AND 1);
ALTER TABLE submission_behavior_metrics
    ADD COLUMN IF NOT EXISTS submitted_without_typing_pause BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_submission_behavior_pause_count
    ON submission_behavior_metrics (pause_count);
CREATE INDEX IF NOT EXISTS idx_submission_behavior_hesitation
    ON submission_behavior_metrics (hesitation_score DESC);

-- =====================================================================
-- SUBMISSION COGNITIVE METRICS (NO-DUP SOURCE OF TRUTH)
-- =====================================================================
CREATE TABLE IF NOT EXISTS submission_cognitive_metrics (
    submission_id BIGINT PRIMARY KEY REFERENCES submissions(id) ON DELETE CASCADE,
    confidence_score SMALLINT CHECK (confidence_score BETWEEN 1 AND 5),
    difficulty_self_report SMALLINT CHECK (difficulty_self_report BETWEEN 1 AND 5),
    first_view_duration_seconds REAL NOT NULL DEFAULT 0 CHECK (first_view_duration_seconds >= 0),
    writing_duration_seconds REAL NOT NULL DEFAULT 0 CHECK (writing_duration_seconds >= 0),
    object_mention_count SMALLINT NOT NULL DEFAULT 0 CHECK (object_mention_count >= 0),
    spatial_mention_count SMALLINT NOT NULL DEFAULT 0 CHECK (spatial_mention_count >= 0),
    reference_coverage REAL NOT NULL DEFAULT 0 CHECK (reference_coverage BETWEEN 0 AND 1),
    detail_density_score REAL NOT NULL DEFAULT 0 CHECK (detail_density_score BETWEEN 0 AND 1),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE submission_cognitive_metrics
    ADD COLUMN IF NOT EXISTS object_mention_count SMALLINT NOT NULL DEFAULT 0 CHECK (object_mention_count >= 0);
ALTER TABLE submission_cognitive_metrics
    ADD COLUMN IF NOT EXISTS spatial_mention_count SMALLINT NOT NULL DEFAULT 0 CHECK (spatial_mention_count >= 0);
ALTER TABLE submission_cognitive_metrics
    ADD COLUMN IF NOT EXISTS reference_coverage REAL NOT NULL DEFAULT 0 CHECK (reference_coverage BETWEEN 0 AND 1);
ALTER TABLE submission_cognitive_metrics
    ADD COLUMN IF NOT EXISTS detail_density_score REAL NOT NULL DEFAULT 0 CHECK (detail_density_score BETWEEN 0 AND 1);
CREATE INDEX IF NOT EXISTS idx_submission_cognitive_confidence
    ON submission_cognitive_metrics (confidence_score);
CREATE INDEX IF NOT EXISTS idx_submission_cognitive_difficulty
    ON submission_cognitive_metrics (difficulty_self_report);
CREATE INDEX IF NOT EXISTS idx_submission_cognitive_reference_coverage
    ON submission_cognitive_metrics (reference_coverage DESC);

-- =====================================================================
-- SUBMISSION ALIGNMENT MENTIONS (NO-DUP SOURCE OF TRUTH)
-- =====================================================================
CREATE TABLE IF NOT EXISTS submission_alignment_mentions (
    id BIGSERIAL PRIMARY KEY,
    submission_id BIGINT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
    mention_type VARCHAR(16) NOT NULL CHECK (mention_type IN ('object', 'spatial')),
    mention VARCHAR(80) NOT NULL,
    mention_order SMALLINT NOT NULL DEFAULT 0 CHECK (mention_order >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_submission_alignment_mention UNIQUE (submission_id, mention_type, mention)
);
CREATE INDEX IF NOT EXISTS idx_submission_alignment_submission
    ON submission_alignment_mentions (submission_id, mention_type, mention_order);
CREATE INDEX IF NOT EXISTS idx_submission_alignment_lookup
    ON submission_alignment_mentions (mention_type, mention);
CREATE INDEX IF NOT EXISTS idx_alignment_fast_lookup
    ON submission_alignment_mentions (mention, mention_type);

-- =====================================================================
-- ATTENTION EVENTS (IMMUTABLE AUDIT)
-- =====================================================================
CREATE TABLE IF NOT EXISTS attention_events (
    id                 BIGSERIAL PRIMARY KEY,
    participant_id     BIGINT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    submission_id      BIGINT NOT NULL UNIQUE REFERENCES submissions(id) ON DELETE CASCADE,
    image_id           BIGINT NOT NULL REFERENCES images(id) ON DELETE RESTRICT,
    expected_terms     TEXT[] NOT NULL DEFAULT '{}',
    matched_terms      TEXT[] NOT NULL DEFAULT '{}',
    failure_reasons    TEXT[] NOT NULL DEFAULT '{}',
    hard_fail_reasons  TEXT[] NOT NULL DEFAULT '{}',
    soft_risk_reasons  TEXT[] NOT NULL DEFAULT '{}',
    is_strict          BOOLEAN NOT NULL DEFAULT TRUE,
    repetition_metrics JSONB NOT NULL DEFAULT '{}',
    response_seconds   REAL,
    content_fingerprint CHAR(64),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE attention_events
    ADD COLUMN IF NOT EXISTS hard_fail_reasons TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE attention_events
    ADD COLUMN IF NOT EXISTS soft_risk_reasons TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE attention_events
    ADD COLUMN IF NOT EXISTS repetition_metrics JSONB NOT NULL DEFAULT '{}';
ALTER TABLE attention_events
    DROP COLUMN IF EXISTS attention_passed;
ALTER TABLE attention_events
    DROP COLUMN IF EXISTS attention_tier;
ALTER TABLE attention_events
    DROP COLUMN IF EXISTS attention_confidence;
ALTER TABLE attention_events
    DROP COLUMN IF EXISTS expected_term_recall;
ALTER TABLE attention_events
    DROP COLUMN IF EXISTS matched_term_count;
ALTER TABLE attention_events
    DROP COLUMN IF EXISTS expected_term_count;
ALTER TABLE attention_events
    DROP COLUMN IF EXISTS descriptive_token_count;
ALTER TABLE attention_events
    DROP COLUMN IF EXISTS alignment_recall;
ALTER TABLE attention_events
    DROP COLUMN IF EXISTS supporting_signals;
ALTER TABLE attention_events
    DROP COLUMN IF EXISTS distinct_word_count;

CREATE INDEX IF NOT EXISTS idx_attention_events_participant_created
    ON attention_events (participant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_attention_events_fingerprint
    ON attention_events (content_fingerprint) WHERE content_fingerprint IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_attention_events_image_fingerprint
    ON attention_events (image_id, content_fingerprint, created_at DESC)
    WHERE content_fingerprint IS NOT NULL;

-- Immutable audit protections for append-only attention events.
CREATE TRIGGER trg_attention_events_no_update
    BEFORE UPDATE ON attention_events
    FOR EACH ROW EXECUTE FUNCTION prevent_attention_event_mutation();

CREATE TRIGGER trg_attention_events_no_delete
    BEFORE DELETE ON attention_events
    FOR EACH ROW EXECUTE FUNCTION prevent_attention_event_mutation();

CREATE TRIGGER trg_attention_events_consistency
    BEFORE INSERT ON attention_events
    FOR EACH ROW EXECUTE FUNCTION validate_attention_event_consistency();

-- =====================================================================
-- PARTICIPANT STATS TABLES
-- =====================================================================
CREATE TABLE IF NOT EXISTS participant_attention_stats (
    participant_id  BIGINT PRIMARY KEY REFERENCES participants(id) ON DELETE CASCADE,
    total_checks    INTEGER NOT NULL DEFAULT 0 CHECK (total_checks >= 0),
    passed_checks   INTEGER NOT NULL DEFAULT 0 CHECK (passed_checks >= 0),
    failed_checks   INTEGER NOT NULL DEFAULT 0 CHECK (failed_checks >= 0),
    attention_score NUMERIC(5,4) NOT NULL DEFAULT 1.0 CHECK (attention_score BETWEEN 0 AND 1),
    recent_attention_score NUMERIC(5,4) CHECK (recent_attention_score BETWEEN 0 AND 1),
    consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
    hard_flag_triggered BOOLEAN NOT NULL DEFAULT FALSE,
    soft_flag_triggered BOOLEAN NOT NULL DEFAULT FALSE,
    is_flagged      BOOLEAN NOT NULL DEFAULT FALSE,
    last_checked_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_attention_counts_consistent CHECK (total_checks = passed_checks + failed_checks)
);

ALTER TABLE participant_attention_stats
    ADD COLUMN IF NOT EXISTS recent_attention_score NUMERIC(5,4)
    CHECK (recent_attention_score BETWEEN 0 AND 1);
ALTER TABLE participant_attention_stats
    ADD COLUMN IF NOT EXISTS consecutive_failures INTEGER NOT NULL DEFAULT 0
    CHECK (consecutive_failures >= 0);
ALTER TABLE participant_attention_stats
    ADD COLUMN IF NOT EXISTS hard_flag_triggered BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE participant_attention_stats
    ADD COLUMN IF NOT EXISTS soft_flag_triggered BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TRIGGER trg_attention_stats_updated
    BEFORE UPDATE ON participant_attention_stats
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_attention_flagged_score ON participant_attention_stats (is_flagged, attention_score DESC) INCLUDE (participant_id);

-- =====================================================================
-- SECURITY / AUDIT
-- =====================================================================
CREATE TABLE IF NOT EXISTS device_fingerprints (
    id               BIGSERIAL PRIMARY KEY,
    participant_id   BIGINT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    fingerprint_hash CHAR(64) NOT NULL CHECK (length(fingerprint_hash) = 64),
    fingerprint_data JSONB NOT NULL,
    risk_score       NUMERIC(5,2) DEFAULT 0 CHECK (risk_score BETWEEN 0 AND 100),
    risk_signals     JSONB NOT NULL DEFAULT '[]',
    last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT unique_participant_fingerprint UNIQUE (participant_id, fingerprint_hash)
);

CREATE TRIGGER trg_device_fingerprint_last_seen
    BEFORE UPDATE ON device_fingerprints
    FOR EACH ROW EXECUTE FUNCTION update_last_seen();

CREATE INDEX IF NOT EXISTS idx_device_fingerprints_participant ON device_fingerprints (participant_id);
CREATE INDEX IF NOT EXISTS idx_device_fingerprints_participant_created
    ON device_fingerprints (participant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_device_fingerprints_hash      ON device_fingerprints (fingerprint_hash);
CREATE INDEX IF NOT EXISTS idx_device_fingerprints_risk      ON device_fingerprints (risk_score DESC);

CREATE TABLE IF NOT EXISTS audit_log (
    id           BIGSERIAL PRIMARY KEY,
    event_type   VARCHAR(60) NOT NULL,
    participant_id BIGINT REFERENCES participants(id) ON DELETE SET NULL,
    endpoint     VARCHAR(120),
    http_method  VARCHAR(10),
    status_code  SMALLINT,
    ip_hash      CHAR(64),
    user_agent   VARCHAR(512),
    details      TEXT CHECK (length(details) <= 8000),
    request_id   UUID,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_created     ON audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_participant ON audit_log (participant_id);
CREATE INDEX IF NOT EXISTS idx_audit_event_type  ON audit_log (event_type);

CREATE TABLE IF NOT EXISTS idempotency_keys (
    id                    BIGSERIAL PRIMARY KEY,
    endpoint              VARCHAR(120) NOT NULL,
    idempotency_key       VARCHAR(128) NOT NULL,
    participant_public_id UUID,
    request_hash          CHAR(64) NOT NULL CHECK (length(request_hash) = 64),
    response_body         JSONB NOT NULL DEFAULT '{}',
    status_code           INTEGER NOT NULL DEFAULT 200,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at            TIMESTAMPTZ,
    deleted_at            TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_idempotency_unique
    ON idempotency_keys (endpoint, idempotency_key, participant_public_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_idempotency_unique_endpoint_key_hash
    ON idempotency_keys (endpoint, idempotency_key, request_hash);
CREATE INDEX IF NOT EXISTS idx_idempotency_lookup_active
    ON idempotency_keys (endpoint, idempotency_key, participant_public_id, created_at DESC)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_idempotency_created
    ON idempotency_keys (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_idempotency_deleted
    ON idempotency_keys (deleted_at);

-- =====================================================================
-- DURABLE EVENT QUEUE
-- =====================================================================
CREATE TABLE IF NOT EXISTS durable_event_queue (
    id              BIGSERIAL PRIMARY KEY,
    event_type      VARCHAR(120) NOT NULL,
    idempotency_key VARCHAR(128),
    payload         JSONB NOT NULL DEFAULT '{}',
    status          VARCHAR(20) NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'processing', 'retry', 'done', 'dead')),
    attempt_count   INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    max_attempts    INTEGER NOT NULL DEFAULT 8 CHECK (max_attempts > 0),
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_error      TEXT,
    processed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE durable_event_queue
    ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(128);

CREATE TRIGGER trg_durable_event_queue_updated_at
    BEFORE UPDATE ON durable_event_queue
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_durable_queue_ready
    ON durable_event_queue (status, next_attempt_at, created_at);
CREATE INDEX IF NOT EXISTS idx_durable_queue_event_created
    ON durable_event_queue (event_type, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_durable_queue_dedupe
    ON durable_event_queue (event_type, idempotency_key)
    WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_durable_queue_dead
    ON durable_event_queue (status, updated_at DESC)
    WHERE status = 'dead';

-- =====================================================================
-- PERFORMANCE METRICS (optional but useful)
-- =====================================================================
CREATE TABLE IF NOT EXISTS performance_metrics (
    id                BIGSERIAL PRIMARY KEY,
    endpoint          VARCHAR(120) NOT NULL,
    response_time_seconds REAL NOT NULL CHECK (response_time_seconds >= 0),
    status_code       SMALLINT,
    request_size_bytes  INTEGER,
    response_size_bytes INTEGER,
    slo_target_seconds REAL NOT NULL DEFAULT 1.2 CHECK (slo_target_seconds > 0),
    slo_breached      BOOLEAN NOT NULL DEFAULT FALSE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_perf_created  ON performance_metrics (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_perf_endpoint ON performance_metrics (endpoint, created_at);
CREATE INDEX IF NOT EXISTS idx_perf_slo_breached ON performance_metrics (slo_breached, created_at DESC);
