-- =====================================================================
-- EXTENSIONS
-- =====================================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gin;

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
('male','Male',1),
('female','Female',2),
('non-binary','Non-binary',3),
('prefer-not-say','Prefer not to say',4),
('other','Other',5)
ON CONFLICT (code) DO NOTHING;


CREATE TABLE IF NOT EXISTS languages (
    code        VARCHAR(20) PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    native_name VARCHAR(100),
    active      BOOLEAN DEFAULT TRUE
);

INSERT INTO languages (code, name, native_name)
VALUES
('en','English','English'),
('hi','Hindi','हिन्दी'),
('bn','Bengali','বাংলা'),
('te','Telugu','తెలుగు'),
('mr','Marathi','मराठी'),
('ta','Tamil','தமிழ்'),
('ur','Urdu','اُردُو'),
('gu','Gujarati','ગુજરાતી'),
('kn','Kannada','ಕನ್ನಡ'),
('ml','Malayalam','മലയാളം'),
('other','Other',NULL)
ON CONFLICT (code) DO NOTHING;


-- =====================================================================
-- PARTICIPANTS
-- =====================================================================
CREATE TABLE IF NOT EXISTS participants (
    id               BIGSERIAL PRIMARY KEY,
    public_id        UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    session_id       VARCHAR(128) NOT NULL,
    username         VARCHAR(50) NOT NULL UNIQUE,
    email            VARCHAR(255) NOT NULL UNIQUE,
    phone            VARCHAR(20) NOT NULL UNIQUE CHECK (phone ~ '^[0-9+ -]{8,15}$'),
    gender_code      VARCHAR(32) REFERENCES genders(code),
    age              SMALLINT CHECK (age >= 13 AND age <= 100),
    location         VARCHAR(120),
    language_code    VARCHAR(20) REFERENCES languages(code),
    prior_experience VARCHAR(120),
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

CREATE UNIQUE INDEX idx_participants_active_username
    ON participants (username)
    WHERE is_deleted = false;

CREATE UNIQUE INDEX idx_participants_active_email
    ON participants (email)
    WHERE is_deleted = false;

CREATE UNIQUE INDEX idx_participants_active_phone_number
    ON participants (phone)
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

CREATE POLICY participants_owner_policy ON participants
    USING (id = current_setting('app.current_participant_id', true)::bigint)
    WITH CHECK (id = current_setting('app.current_participant_id', true)::bigint);

CREATE OR REPLACE FUNCTION prevent_random_key_update()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.random_key IS DISTINCT FROM OLD.random_key THEN
        RAISE EXCEPTION 'random_key cannot be updated';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_random_key_change
BEFORE UPDATE ON images
FOR EACH ROW EXECUTE FUNCTION prevent_random_key_update();

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
    ip_hash            CHAR(64) NOT NULL,
    user_agent         VARCHAR(512),
    extra_metadata     JSONB NOT NULL DEFAULT '{}',
    -- Engagement tracking
    tab_switch_count   INTEGER NOT NULL DEFAULT 0,
    page_close_attempts INTEGER NOT NULL DEFAULT 0,
    network_disconnects INTEGER NOT NULL DEFAULT 0,
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
CREATE INDEX idx_submissions_attention            ON submissions (is_attention_check, attention_passed);


-- =====================================================================
-- PARTICIPANT ATTENTION STATS
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
-- PARTICIPANT ACTIVITY STATS
-- =====================================================================
CREATE TABLE IF NOT EXISTS participant_activity_stats (
    participant_id   BIGINT PRIMARY KEY REFERENCES participants(id) ON DELETE CASCADE,
    total_words      BIGINT NOT NULL DEFAULT 0,
    total_submissions INTEGER NOT NULL DEFAULT 0,
    survey_rounds    INTEGER NOT NULL DEFAULT 0,
    priority_eligible BOOLEAN NOT NULL DEFAULT FALSE,
    last_reward_check TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER trg_activity_stats_updated
    BEFORE UPDATE ON participant_activity_stats
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_activity_priority_eligible
    ON participant_activity_stats (priority_eligible);


-- =====================================================================
-- SECURE AUTO UPI PAYMENTS (UPGRADED)
-- =====================================================================
CREATE TABLE IF NOT EXISTS payments (
    id                    BIGSERIAL PRIMARY KEY,
    participant_id        BIGINT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    public_id             UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    transaction_id        VARCHAR(120),
    amount                NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    currency              VARCHAR(10) NOT NULL DEFAULT 'INR',
    upi_vpa               VARCHAR(120),
    upi_note              VARCHAR(255),
    upi_txn_ref           VARCHAR(120),
    extracted_text        TEXT,
    fraud_score           NUMERIC(5,2) DEFAULT 0 CHECK (fraud_score >= 0),
    auto_rejected BOOLEAN DEFAULT FALSE,
    verification_attempts SMALLINT DEFAULT 0 CHECK (verification_attempts >= 0),
    signature             CHAR(64) NOT NULL CHECK (length(signature) = 64),
    expires_at            TIMESTAMPTZ NOT NULL,
    timer_activated_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gateway               VARCHAR(60),
    status                VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','processing','success','failed','rejected_fraud','expired','refunded')),
    verified_at           TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    detected_app          VARCHAR(60),

    verification_details JSONB NOT NULL DEFAULT '{}',

    metadata              JSONB NOT NULL DEFAULT '{}',
    created_at            TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Expiry checks (moved here for clarity)
    CONSTRAINT chk_expires_after_create  CHECK (expires_at > created_at),
    CONSTRAINT chk_timer_after_create  CHECK (timer_activated_at >= created_at)
);

CREATE UNIQUE INDEX idx_payments_unique_upi_ref
    ON payments (upi_txn_ref)
    WHERE upi_txn_ref IS NOT NULL;

CREATE INDEX idx_payments_expired_pending
ON payments (expires_at)
WHERE status = 'pending';

CREATE UNIQUE INDEX idx_payments_one_active_per_participant
    ON payments (participant_id)
    WHERE status IN ('pending','processing');

CREATE INDEX idx_payments_participant ON payments (participant_id);
CREATE INDEX idx_payments_status ON payments (status);

CREATE OR REPLACE FUNCTION check_payment_fraud_threshold()
RETURNS TRIGGER AS $$    
BEGIN
    IF NEW.fraud_score >= 75 OR EXISTS (
        SELECT 1 FROM payment_fraud_signals
        WHERE payment_id = NEW.id AND signal_score >= 40 AND signal_type IN ('device_mismatch', 'location_jump', 'rapid_attempts', 'high_risk_vpa')
    ) THEN
        NEW.status := 'rejected_fraud';
        NEW.auto_rejected := TRUE;
    END IF;
    RETURN NEW;
END;
    $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_check_fraud_threshold
BEFORE UPDATE OF fraud_score, status ON payments
FOR EACH ROW WHEN (NEW.status = 'processing')
EXECUTE FUNCTION check_payment_fraud_threshold();

-- =====================================================================
-- PAYMENT FILES (S3-backed secure storage)
-- =====================================================================

CREATE TABLE IF NOT EXISTS payment_files (
    id              BIGSERIAL PRIMARY KEY,

    payment_id      BIGINT NOT NULL
        REFERENCES payments(id)
        ON DELETE CASCADE,

    -- S3 location
    bucket_name     VARCHAR(120) NOT NULL DEFAULT 'cognitapi',
    object_key      VARCHAR(512) NOT NULL,

    -- File integrity
    sha256          CHAR(64) NOT NULL CHECK (length(sha256) = 64),
    etag            VARCHAR(128),
    file_size       BIGINT CHECK (file_size >= 0),
    content_type    VARCHAR(120),

    -- Metadata
    uploaded_by_ip_hash CHAR(64),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Prevent duplicate object reuse
    CONSTRAINT chk_payment_files_key_prefix
        CHECK (object_key LIKE 'payments/%')
);

CREATE TRIGGER trg_payments_updated_at
BEFORE UPDATE ON payments
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Fast lookup by payment
CREATE INDEX idx_payment_files_payment
ON payment_files (payment_id);

-- Prevent duplicate object keys
CREATE UNIQUE INDEX idx_payment_files_object_key_unique
ON payment_files (object_key);

CREATE UNIQUE INDEX idx_one_file_per_payment
ON payment_files (payment_id);

CREATE TABLE payment_submissions (
    payment_id    BIGINT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
    submission_id BIGINT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
    PRIMARY KEY (payment_id, submission_id)
);

CREATE INDEX idx_payment_submissions_payment
ON payment_submissions (payment_id);

CREATE INDEX idx_payment_submissions_submission
ON payment_submissions (submission_id);

CREATE INDEX idx_payment_submissions_submission_payment
ON payment_submissions (submission_id, payment_id);

-- =====================================================================
-- PAYMENT FRAUD SIGNALS
-- =====================================================================
CREATE TABLE IF NOT EXISTS payment_fraud_signals (
    id            BIGSERIAL PRIMARY KEY,
    payment_id    BIGINT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
    signal_type   VARCHAR(80) NOT NULL,
    signal_score  NUMERIC(5,2) NOT NULL CHECK (signal_score >= 0),
    details       JSONB NOT NULL DEFAULT '{}',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_fraud_signals_payment
    ON payment_fraud_signals (payment_id);

CREATE UNIQUE INDEX idx_unique_signal_per_payment
ON payment_fraud_signals (payment_id, signal_type);


-- =====================================================================
-- SYNC PARTICIPANT PAYMENT STATUS
-- =====================================================================
CREATE OR REPLACE FUNCTION sync_participant_payment_status()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'success' THEN
        UPDATE participants SET payment_status = 'paid'
        WHERE id = NEW.participant_id;

    ELSIF NEW.status IN ('failed','expired','rejected_fraud') THEN
        UPDATE participants SET payment_status = 'failed'
        WHERE id = NEW.participant_id;

    ELSIF NEW.status = 'refunded' THEN
        UPDATE participants SET payment_status = 'refunded'
        WHERE id = NEW.participant_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_payment_status
AFTER UPDATE ON payments
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION sync_participant_payment_status();


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

CREATE INDEX idx_reward_winners_status ON reward_winners (status);
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

CREATE INDEX idx_audit_created ON audit_log (created_at DESC);
CREATE INDEX idx_audit_participant ON audit_log (participant_id);
CREATE INDEX idx_audit_event_type ON audit_log (event_type);


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

CREATE INDEX idx_perf_created ON performance_metrics (created_at DESC);
CREATE INDEX idx_perf_endpoint ON performance_metrics (endpoint, created_at);

CREATE OR REPLACE FUNCTION reject_expired_pending_payments()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status IN ('pending', 'processing')
       AND NEW.expires_at <= CURRENT_TIMESTAMP THEN
        NEW.status := 'expired';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_reject_expired_pending
BEFORE INSERT OR UPDATE OF status, expires_at
ON payments
FOR EACH ROW EXECUTE FUNCTION reject_expired_pending_payments();

-- =====================================================================
-- ROW LEVEL SECURITY
-- =====================================================================
ALTER TABLE participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE participants FORCE ROW LEVEL SECURITY;
ALTER TABLE payments FORCE ROW LEVEL SECURITY;
ALTER TABLE payment_files FORCE ROW LEVEL SECURITY;
ALTER TABLE payment_submissions FORCE ROW LEVEL SECURITY;

CREATE POLICY participants_active_policy ON participants
    USING (is_deleted = false)
    WITH CHECK (is_deleted = false);

ALTER TABLE submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY submissions_owner_policy ON submissions
    USING (participant_id = current_setting('app.current_participant_id', true)::bigint)
    WITH CHECK (participant_id = current_setting('app.current_participant_id', true)::bigint);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY payments_owner_policy
ON payments
USING (
    participant_id =
    current_setting('app.current_participant_id', true)::bigint
)
WITH CHECK (
    participant_id =
    current_setting('app.current_participant_id', true)::bigint
);

ALTER TABLE payment_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY payment_files_owner_policy
ON payment_files
USING (
    payment_id IN (
        SELECT id FROM payments
        WHERE participant_id =
        current_setting('app.current_participant_id', true)::bigint
    )
)
WITH CHECK (
    payment_id IN (
        SELECT id FROM payments
        WHERE participant_id =
        current_setting('app.current_participant_id', true)::bigint
    )
);

ALTER TABLE payment_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY payment_submissions_owner_policy
ON payment_submissions
USING (
    payment_id IN (
        SELECT id FROM payments
        WHERE participant_id =
        current_setting('app.current_participant_id', true)::bigint
    )
)
WITH CHECK (
    payment_id IN (
        SELECT id FROM payments
        WHERE participant_id =
        current_setting('app.current_participant_id', true)::bigint
    )
);

-- 1. Enable Row Level Security on all relevant tables
ALTER TABLE images                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE images                    FORCE ROW LEVEL SECURITY;

ALTER TABLE attention_checks          ENABLE ROW LEVEL SECURITY;
ALTER TABLE attention_checks          FORCE ROW LEVEL SECURITY;

ALTER TABLE participant_attention_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE participant_attention_stats FORCE ROW LEVEL SECURITY;

ALTER TABLE participant_activity_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE participant_activity_stats FORCE ROW LEVEL SECURITY;

ALTER TABLE reward_winners            ENABLE ROW LEVEL SECURITY;
ALTER TABLE reward_winners            FORCE ROW LEVEL SECURITY;

ALTER TABLE audit_log                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log                 FORCE ROW LEVEL SECURITY;

ALTER TABLE performance_metrics       ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance_metrics       FORCE ROW LEVEL SECURITY;

-- 2. Read policy — images and attention_checks are world-readable (SELECT only)
CREATE POLICY images_read_all ON images
    FOR SELECT
    USING (true);

CREATE POLICY attention_checks_read_all ON attention_checks
    FOR SELECT
    USING (true);

-- 3. Write policies — default-deny writes (INSERT/UPDATE/DELETE) on images & attention_checks
--    → only possible via functions / roles that bypass RLS or have special policies
CREATE POLICY images_write_deny ON images
    FOR ALL        -- or explicitly: INSERT, UPDATE, DELETE
    USING (false)
    WITH CHECK (false);

CREATE POLICY attention_checks_write_deny ON attention_checks
    FOR ALL
    USING (false)
    WITH CHECK (false);

-- 4. Participant-owned stats & rewards — only owner can read/write their own rows
CREATE POLICY participant_attention_stats_owner ON participant_attention_stats
    USING  (participant_id = current_setting('app.current_participant_id', true)::bigint)
    WITH CHECK (participant_id = current_setting('app.current_participant_id', true)::bigint);

CREATE POLICY participant_activity_stats_owner ON participant_activity_stats
    USING  (participant_id = current_setting('app.current_participant_id', true)::bigint)
    WITH CHECK (participant_id = current_setting('app.current_participant_id', true)::bigint);

CREATE POLICY reward_winners_owner ON reward_winners
    USING  (participant_id = current_setting('app.current_participant_id', true)::bigint)
    WITH CHECK (participant_id = current_setting('app.current_participant_id', true)::bigint);

-- 5. Audit & metrics — allow audit inserts, deny read access
CREATE POLICY audit_log_insert_policy ON audit_log
    FOR INSERT
    WITH CHECK (true);

CREATE POLICY audit_log_select_deny ON audit_log
    FOR SELECT
    USING (false);

CREATE POLICY performance_metrics_deny_all ON performance_metrics
    USING (false)
    WITH CHECK (false);

-- 6. Lookup tables — no RLS needed (public read access)
ALTER TABLE genders   DISABLE ROW LEVEL SECURITY;
ALTER TABLE languages DISABLE ROW LEVEL SECURITY;
