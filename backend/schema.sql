-- =====================================================================
-- C.O.G.N.I.T. PostgreSQL Schema – Neon / modern Postgres compatible
-- Fully fixed version – no invalid CONSTRAINT ... WHERE inside CREATE TABLE
-- =====================================================================

-- =====================================================================
-- SCHEMA MIGRATION: Ensure public_id column exists for existing databases
-- =====================================================================
DO $
BEGIN
    -- Check if participants table exists but public_id column doesn't
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'participants' AND table_schema = 'public'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'participants' AND column_name = 'public_id'
    ) THEN
        -- Add public_id column to existing table
        ALTER TABLE participants ADD COLUMN public_id UUID DEFAULT gen_random_uuid();
        
        -- Update existing rows with generated UUIDs
        UPDATE participants SET public_id = gen_random_uuid() WHERE public_id IS NULL;
        
        -- Add NOT NULL constraint after populating data
        ALTER TABLE participants ALTER COLUMN public_id SET NOT NULL;
        
        -- Add unique constraint
        ALTER TABLE participants ADD CONSTRAINT unique_public_id UNIQUE (public_id);
        
        -- Create index
        CREATE INDEX idx_participants_public_id ON participants (public_id);
    END IF;
END $;

-- =====================================================================
-- EXTENSIONS
-- =====================================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;     -- optional, keep if using crypto functions
CREATE EXTENSION IF NOT EXISTS btree_gin;    -- optional, for future GIN needs

-- gen_random_uuid() is built-in → no uuid-ossp needed


-- =====================================================================
-- HELPER FUNCTION
-- =====================================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
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
    ('male',          'Male',              1),
    ('female',        'Female',            2),
    ('non-binary',    'Non-binary',        3),
    ('prefer-not-say','Prefer not to say', 4),
    ('other',         'Other',             5)
ON CONFLICT (code) DO NOTHING;


CREATE TABLE IF NOT EXISTS languages (
    code        VARCHAR(20) PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    native_name VARCHAR(100),
    active      BOOLEAN DEFAULT TRUE
);

INSERT INTO languages (code, name, native_name)
VALUES
    ('en',  'English',   'English'),
    ('hi',  'Hindi',     'हिन्दी'),
    ('bn',  'Bengali',   'বাংলা'),
    ('te',  'Telugu',    'తెలుగు'),
    ('mr',  'Marathi',   'मराठी'),
    ('ta',  'Tamil',     'தமிழ்'),
    ('ur',  'Urdu',      'اُردُو'),
    ('gu',  'Gujarati',  'ગુજરાતી'),
    ('kn',  'Kannada',   'ಕನ್ನಡ'),
    ('ml',  'Malayalam', 'മലയാളം'),
    ('other','Other',    NULL)
ON CONFLICT (code) DO NOTHING;


-- =====================================================================
-- PARTICIPANTS
-- =====================================================================
CREATE TABLE IF NOT EXISTS participants (
    id               BIGSERIAL PRIMARY KEY,
    public_id        UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    session_id       VARCHAR(128) NOT NULL,
    username         VARCHAR(50) NOT NULL,
    email            VARCHAR(255),
    phone            VARCHAR(20),
    gender_code      VARCHAR(32) REFERENCES genders(code),
    age              SMALLINT CHECK (age >= 13 AND age <= 120),
    location         VARCHAR(120),
    language_code    VARCHAR(20) REFERENCES languages(code),
    prior_experience  VARCHAR(120),
    consent_given    BOOLEAN NOT NULL DEFAULT FALSE,
    consent_at       TIMESTAMPTZ,
    payment_status   VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (payment_status IN ('pending','paid','failed','refunded','cancelled')),
    ip_hash          CHAR(64) NOT NULL CHECK (length(ip_hash) = 64),
    user_agent       VARCHAR(512),
    extra_metadata   JSONB NOT NULL DEFAULT '{}',
    is_deleted       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_valid_email CHECK (
        email IS NULL OR email ~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$'
    )
);

CREATE TRIGGER trg_participants_updated_at
    BEFORE UPDATE ON participants
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_participants_public_id      ON participants (public_id);
CREATE INDEX idx_participants_session_id     ON participants (session_id);
CREATE INDEX idx_participants_email          ON participants (email) WHERE email IS NOT NULL;
CREATE INDEX idx_participants_payment_status ON participants (payment_status);
CREATE INDEX idx_participants_consent        ON participants (consent_given);
CREATE INDEX idx_participants_active         ON participants (is_deleted) WHERE is_deleted = false;

-- Enforces unique username only among non-deleted records
CREATE UNIQUE INDEX idx_participants_active_username
    ON participants (username)
    WHERE is_deleted = false;


-- =====================================================================
-- IMAGES
-- =====================================================================
CREATE TABLE IF NOT EXISTS images (
    id            BIGSERIAL PRIMARY KEY,
    image_id      VARCHAR(64) NOT NULL UNIQUE,
    url           TEXT NOT NULL,
    width         INTEGER CHECK (width > 0),
    height        INTEGER CHECK (height > 0),
    object_count  SMALLINT CHECK (object_count >= 0),
    difficulty    NUMERIC(3,2) CHECK (difficulty BETWEEN 0 AND 10),
    tags          TEXT[],
    random_key    DOUBLE PRECISION DEFAULT random(),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER trg_images_updated_at
    BEFORE UPDATE ON images
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_images_image_id   ON images (image_id);
CREATE INDEX idx_images_random_key ON images (random_key);
CREATE INDEX idx_images_difficulty ON images (difficulty);


-- =====================================================================
-- ATTENTION CHECKS
-- =====================================================================
CREATE TABLE IF NOT EXISTS attention_checks (
    id            BIGSERIAL PRIMARY KEY,
    image_id      BIGINT NOT NULL REFERENCES images(id) ON DELETE CASCADE,
    expected_word VARCHAR(120) NOT NULL,
    is_strict     BOOLEAN NOT NULL DEFAULT TRUE,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Enforces at most one active check per image
CREATE UNIQUE INDEX idx_attention_checks_active_unique
    ON attention_checks (image_id)
    WHERE is_active = true;


-- =====================================================================
-- SUBMISSIONS
-- =====================================================================
CREATE TABLE IF NOT EXISTS submissions (
    id                 BIGSERIAL PRIMARY KEY,
    request_id         UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    participant_id     BIGINT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    image_id           BIGINT NOT NULL REFERENCES images(id) ON DELETE RESTRICT,
    survey_index       INTEGER,
    description        TEXT NOT NULL CHECK (length(description) BETWEEN 60 AND 10000),
    word_count         INTEGER NOT NULL CHECK (word_count >= 0),
    rating             SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 10),
    feedback           TEXT NOT NULL CHECK (length(feedback) BETWEEN 5 AND 2000),
    time_spent_seconds REAL CHECK (time_spent_seconds >= 0),
    is_survey          BOOLEAN NOT NULL DEFAULT FALSE,
    is_attention_check BOOLEAN NOT NULL DEFAULT FALSE,
    attention_passed   BOOLEAN,
    flagged_too_fast   BOOLEAN NOT NULL DEFAULT FALSE,
    quality_score      NUMERIC(5,4) CHECK (quality_score BETWEEN 0 AND 1),
    ai_suspected       BOOLEAN NOT NULL DEFAULT FALSE,
    ip_hash            CHAR(64) NOT NULL,
    user_agent         VARCHAR(512),
    extra_metadata     JSONB NOT NULL DEFAULT '{}',
    created_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT unique_participant_survey UNIQUE (participant_id, survey_index) DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT chk_attention_passed_consistent CHECK (
        NOT (is_attention_check = true AND attention_passed IS NULL)
    ),
    CONSTRAINT chk_survey_fields_symmetric CHECK (
        (survey_index IS NULL AND is_survey = false) OR
        (survey_index IS NOT NULL AND is_survey = true)
    )
);

CREATE INDEX idx_submissions_participant_created  ON submissions (participant_id, created_at DESC);
CREATE INDEX idx_submissions_participant_quality  ON submissions (participant_id, quality_score DESC, created_at DESC) WHERE is_survey = true;
CREATE INDEX idx_submissions_ai_suspected         ON submissions (ai_suspected) WHERE ai_suspected = true;
CREATE INDEX idx_submissions_attention            ON submissions (is_attention_check, attention_passed);


-- =====================================================================
-- PARTICIPANT ATTENTION STATISTICS
-- =====================================================================
CREATE TABLE IF NOT EXISTS participant_attention_stats (
    participant_id  BIGINT PRIMARY KEY REFERENCES participants(id) ON DELETE CASCADE,
    total_checks    INTEGER NOT NULL DEFAULT 0 CHECK (total_checks >= 0),
    passed_checks   INTEGER NOT NULL DEFAULT 0 CHECK (passed_checks >= 0),
    failed_checks   INTEGER NOT NULL DEFAULT 0 CHECK (failed_checks >= 0),
    attention_score NUMERIC(5,4) NOT NULL DEFAULT 1.0 CHECK (attention_score BETWEEN 0 AND 1),
    is_flagged      BOOLEAN NOT NULL DEFAULT FALSE,
    last_checked_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_attention_counts_consistent CHECK (
        total_checks = passed_checks + failed_checks
    )
);

CREATE TRIGGER trg_attention_stats_updated
    BEFORE UPDATE ON participant_attention_stats
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_attention_flagged_score
    ON participant_attention_stats (is_flagged, attention_score DESC) INCLUDE (participant_id);


-- =====================================================================
-- PARTICIPANT ACTIVITY STATISTICS
-- =====================================================================
CREATE TABLE IF NOT EXISTS participant_activity_stats (
    participant_id    BIGINT PRIMARY KEY REFERENCES participants(id) ON DELETE CASCADE,
    total_words       BIGINT NOT NULL DEFAULT 0,
    total_submissions  INTEGER NOT NULL DEFAULT 0,
    survey_rounds     INTEGER NOT NULL DEFAULT 0,
    priority_eligible  BOOLEAN NOT NULL DEFAULT FALSE,
    last_reward_check  TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER trg_activity_stats_updated
    BEFORE UPDATE ON participant_activity_stats
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_activity_priority_eligible
    ON participant_activity_stats (priority_eligible);


-- =====================================================================
-- PAYMENTS
-- =====================================================================
CREATE TABLE IF NOT EXISTS payments (
    id             BIGSERIAL PRIMARY KEY,
    participant_id BIGINT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    transaction_id VARCHAR(120) NOT NULL UNIQUE,
    amount         NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    gateway        VARCHAR(60),
    status         VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','success','failed','refunded')),
    metadata       JSONB NOT NULL DEFAULT '{}',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_payments_participant ON payments (participant_id);
CREATE INDEX idx_payments_status     ON payments (status);


-- =====================================================================
-- REWARD WINNERS
-- =====================================================================
CREATE TABLE IF NOT EXISTS reward_winners (
    id              BIGSERIAL PRIMARY KEY,
    participant_id  BIGINT NOT NULL UNIQUE REFERENCES participants(id) ON DELETE CASCADE,
    reward_amount   INTEGER NOT NULL CHECK (reward_amount > 0),
    reason_code     VARCHAR(60),
    selected_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status          VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','paid','cancelled','expired')),
    paid_at         TIMESTAMPTZ,
    transaction_ref VARCHAR(120),
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER trg_reward_winners_updated
    BEFORE UPDATE ON reward_winners
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_reward_winners_status     ON reward_winners (status);
CREATE INDEX idx_reward_winners_participant ON reward_winners (participant_id);


-- =====================================================================
-- AUDIT LOG
-- =====================================================================
CREATE TABLE IF NOT EXISTS audit_log (
    id            BIGSERIAL PRIMARY KEY,
    event_type    VARCHAR(60) NOT NULL,
    participant_id BIGINT REFERENCES participants(id) ON DELETE SET NULL,
    endpoint      VARCHAR(120),
    http_method   VARCHAR(10),
    status_code   SMALLINT,
    ip_hash       CHAR(64),
    user_agent    VARCHAR(512),
    details       TEXT CHECK (length(details) <= 8000),
    request_id    UUID,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_audit_created     ON audit_log (created_at DESC);
CREATE INDEX idx_audit_participant ON audit_log (participant_id);
CREATE INDEX idx_audit_event_type  ON audit_log (event_type);


-- =====================================================================
-- PERFORMANCE METRICS
-- =====================================================================
CREATE TABLE IF NOT EXISTS performance_metrics (
    id                  BIGSERIAL PRIMARY KEY,
    endpoint            VARCHAR(120) NOT NULL,
    response_time_ms    INTEGER NOT NULL CHECK (response_time_ms >= 0),
    status_code         SMALLINT,
    request_size_bytes  INTEGER,
    response_size_bytes INTEGER,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_perf_created  ON performance_metrics (created_at DESC);
CREATE INDEX idx_perf_endpoint ON performance_metrics (endpoint, created_at);


-- =====================================================================
-- ROW LEVEL SECURITY
-- =====================================================================
ALTER TABLE participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE participants FORCE ROW LEVEL SECURITY;

CREATE POLICY participants_active_policy ON participants
    USING (is_deleted = false)
    WITH CHECK (is_deleted = false);


ALTER TABLE submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY submissions_owner_policy ON submissions
    USING (participant_id = current_setting('app.current_participant_id', true)::bigint)
    WITH CHECK (participant_id = current_setting('app.current_participant_id', true)::bigint);
