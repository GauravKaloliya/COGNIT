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

CREATE OR REPLACE FUNCTION prevent_random_key_update()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.random_key IS DISTINCT FROM OLD.random_key THEN
        RAISE EXCEPTION 'random_key cannot be updated';
    END IF;
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

CREATE OR REPLACE FUNCTION sync_participant_payment_status()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE participants
    SET payment_status = CASE
        WHEN NEW.status = 'success' THEN 'paid'
        WHEN NEW.status IN ('failed', 'expired', 'rejected_fraud') THEN 'failed'
        WHEN NEW.status = 'refunded' THEN 'refunded'
        ELSE payment_status
    END,
    current_stage = CASE
        WHEN NEW.status = 'success' THEN 'survey'
        WHEN NEW.status IN ('failed', 'expired', 'rejected_fraud') THEN 'payment'
        ELSE current_stage
    END,
    stage_updated_at = CASE
        WHEN NEW.status = 'success' OR NEW.status IN ('failed', 'expired', 'rejected_fraud') THEN CURRENT_TIMESTAMP
        ELSE stage_updated_at
    END
    WHERE id = NEW.participant_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

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

CREATE OR REPLACE FUNCTION validate_payment_status_transition()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status IN ('success', 'rejected_fraud', 'expired', 'failed') THEN
        RAISE EXCEPTION 'Cannot change payment status from final state: %', OLD.status;
    END IF;

    IF OLD.status = 'pending' AND NEW.status NOT IN ('processing', 'expired', 'failed', 'rejected_fraud') THEN
        RAISE EXCEPTION 'Invalid transition from pending to %', NEW.status;
    END IF;

    IF OLD.status = 'processing' AND NEW.status NOT IN ('success', 'rejected_fraud', 'failed') THEN
        RAISE EXCEPTION 'Invalid transition from processing to %', NEW.status;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION set_stage_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.current_stage IS DISTINCT FROM OLD.current_stage THEN
        NEW.stage_updated_at = CURRENT_TIMESTAMP;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION validate_payment_for_submission()
RETURNS TRIGGER AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM participants
        WHERE id = NEW.participant_id AND payment_status = 'paid'
    ) THEN
        RAISE EXCEPTION 'Cannot create submission: participant payment_status is not "paid"';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION validate_payment_stage_consistency()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.payment_status IN ('pending', 'failed', 'cancelled')
       AND NEW.current_stage IN ('survey', 'finished') THEN
        RAISE EXCEPTION 'Cannot be in survey/finished stage with payment status: %', NEW.payment_status;
    END IF;
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

-- =====================================================================
-- MAIN TABLES
-- =====================================================================
CREATE TABLE IF NOT EXISTS participants (
    id               BIGSERIAL PRIMARY KEY,
    public_id        UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    session_id       VARCHAR(128) NOT NULL,
    username         VARCHAR(50) NOT NULL,
    email            VARCHAR(255),
    phone            VARCHAR(20),
    gender_code      VARCHAR(32) REFERENCES genders(code),
    age              SMALLINT CHECK (age >= 13 AND age <= 100),
    location         VARCHAR(120),
    language_code    VARCHAR(20) REFERENCES languages(code),
    prior_experience VARCHAR(120),
    consent_given    BOOLEAN NOT NULL DEFAULT FALSE,
    consent_at       TIMESTAMPTZ,
    payment_status   VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (payment_status IN ('pending','paid','failed','refunded','cancelled')),
    current_stage    VARCHAR(32) NOT NULL DEFAULT 'consent'
        CHECK (current_stage IN ('consent','user-details','payment-content','payment-link','payment','survey','finished')),
    stage_updated_at TIMESTAMPTZ,
    ip_hash          CHAR(64) NOT NULL CHECK (length(ip_hash) = 64),
    user_agent       VARCHAR(512),
    extra_metadata   JSONB NOT NULL DEFAULT '{}',
    is_deleted       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_email_format    CHECK (email ~* '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$' OR email IS NULL),
    CONSTRAINT chk_phone_format    CHECK (phone ~ '^[0-9+ -]{8,15}$' OR phone IS NULL)
);

CREATE TRIGGER trg_participants_updated_at
    BEFORE UPDATE ON participants
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_participants_stage_updated_at
    BEFORE UPDATE OF current_stage ON participants
    FOR EACH ROW EXECUTE FUNCTION set_stage_updated_at();

CREATE TRIGGER trg_validate_payment_stage_consistency
    BEFORE UPDATE ON participants
    FOR EACH ROW
    WHEN (OLD.payment_status IS DISTINCT FROM NEW.payment_status OR OLD.current_stage IS DISTINCT FROM NEW.current_stage)
    EXECUTE FUNCTION validate_payment_stage_consistency();

-- Active-only unique constraints
CREATE UNIQUE INDEX IF NOT EXISTS idx_participants_active_username ON participants (username) WHERE is_deleted = false;
CREATE UNIQUE INDEX IF NOT EXISTS idx_participants_active_email    ON participants (email)    WHERE is_deleted = false AND email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_participants_active_phone    ON participants (phone)    WHERE is_deleted = false AND phone IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_participants_public_id     ON participants (public_id);
CREATE INDEX IF NOT EXISTS idx_participants_session_id    ON participants (session_id);
CREATE INDEX IF NOT EXISTS idx_participants_email         ON participants (email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_participants_payment_status ON participants (payment_status);
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
    random_key   DOUBLE PRECISION DEFAULT random(),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER trg_images_updated_at
    BEFORE UPDATE ON images
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_prevent_random_key_change
    BEFORE UPDATE ON images
    FOR EACH ROW EXECUTE FUNCTION prevent_random_key_update();

CREATE INDEX IF NOT EXISTS idx_images_image_id   ON images (image_id);
CREATE INDEX IF NOT EXISTS idx_images_random_key ON images (random_key);
CREATE INDEX IF NOT EXISTS idx_images_difficulty ON images (difficulty);

CREATE TABLE IF NOT EXISTS attention_checks (
    id            BIGSERIAL PRIMARY KEY,
    image_id      BIGINT NOT NULL REFERENCES images(id) ON DELETE CASCADE,
    expected_word VARCHAR(120) NOT NULL,
    is_strict     BOOLEAN NOT NULL DEFAULT TRUE,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT one_active_check_per_image UNIQUE (image_id)
        DEFERRABLE INITIALLY DEFERRED
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_attention_checks_active_unique
    ON attention_checks (image_id) WHERE is_active = true;

-- =====================================================================
-- SUBMISSIONS
-- =====================================================================
CREATE TABLE IF NOT EXISTS submissions (
    id                  BIGSERIAL PRIMARY KEY,
    request_id          UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    participant_id      BIGINT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    image_id            BIGINT NOT NULL REFERENCES images(id) ON DELETE RESTRICT,
    survey_index        INTEGER,
    description         TEXT NOT NULL CHECK (length(description) BETWEEN 60 AND 10000),
    word_count          INTEGER NOT NULL CHECK (word_count >= 0),
    rating              SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 10),
    feedback            TEXT NOT NULL CHECK (length(feedback) BETWEEN 5 AND 2000),
    time_spent_seconds  REAL CHECK (time_spent_seconds >= 0),
    is_survey           BOOLEAN NOT NULL DEFAULT FALSE,
    is_attention_check  BOOLEAN NOT NULL DEFAULT FALSE,
    attention_passed    BOOLEAN,
    flagged_too_fast    BOOLEAN NOT NULL DEFAULT FALSE,
    quality_score       NUMERIC(5,4) CHECK (quality_score BETWEEN 0 AND 1),
    ip_hash             CHAR(64) NOT NULL,
    user_agent          VARCHAR(512),
    extra_metadata      JSONB NOT NULL DEFAULT '{}',
    tab_switch_count    INTEGER NOT NULL DEFAULT 0,
    page_close_attempts INTEGER NOT NULL DEFAULT 0,
    network_disconnects INTEGER NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT unique_participant_survey UNIQUE (participant_id, survey_index) DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT chk_attention_passed_consistent CHECK (NOT (is_attention_check = true AND attention_passed IS NULL)),
    CONSTRAINT chk_survey_fields_symmetric CHECK ((survey_index IS NULL) = (is_survey = false))
);

CREATE TRIGGER trg_validate_payment_submission
    BEFORE INSERT ON submissions
    FOR EACH ROW EXECUTE FUNCTION validate_payment_for_submission();

CREATE INDEX IF NOT EXISTS idx_submissions_participant_created ON submissions (participant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_submissions_participant_quality ON submissions (participant_id, quality_score DESC, created_at DESC) WHERE is_survey = true;
CREATE INDEX IF NOT EXISTS idx_submissions_attention ON submissions (is_attention_check, attention_passed);

-- =====================================================================
-- PARTICIPANT STATS TABLES
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

    CONSTRAINT chk_attention_counts_consistent CHECK (total_checks = passed_checks + failed_checks)
);

CREATE TRIGGER trg_attention_stats_updated
    BEFORE UPDATE ON participant_attention_stats
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_attention_flagged_score ON participant_attention_stats (is_flagged, attention_score DESC) INCLUDE (participant_id);

CREATE TABLE IF NOT EXISTS participant_activity_stats (
    participant_id  BIGINT PRIMARY KEY REFERENCES participants(id) ON DELETE CASCADE,
    total_words        BIGINT NOT NULL DEFAULT 0,
    total_submissions  INTEGER NOT NULL DEFAULT 0,
    survey_rounds      INTEGER NOT NULL DEFAULT 0,
    priority_eligible  BOOLEAN NOT NULL DEFAULT FALSE,
    last_reward_check  TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER trg_activity_stats_updated
    BEFORE UPDATE ON participant_activity_stats
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_activity_priority_eligible ON participant_activity_stats (priority_eligible);

-- =====================================================================
-- PAYMENTS & FRAUD
-- =====================================================================
CREATE TABLE IF NOT EXISTS payments (
    id                   BIGSERIAL PRIMARY KEY,
    participant_id       BIGINT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    public_id            UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    
    amount               NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    currency             VARCHAR(10) NOT NULL DEFAULT 'INR',
    extracted_text       TEXT,
    fraud_score          NUMERIC(5,2) DEFAULT 0 CHECK (fraud_score >= 0),
    auto_rejected        BOOLEAN DEFAULT FALSE,
    verification_attempts SMALLINT DEFAULT 0 CHECK (verification_attempts >= 0),
    signature            CHAR(64) NOT NULL CHECK (length(signature) = 64),
    expires_at           TIMESTAMPTZ NOT NULL,
    timer_activated_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status               VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','processing','success','failed','rejected_fraud','expired','refunded')),
    verified_at          TIMESTAMPTZ,
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    detected_app         VARCHAR(60),
    verification_details JSONB NOT NULL DEFAULT '{}',
    metadata             JSONB NOT NULL DEFAULT '{}',
    created_at           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_expires_after_create CHECK (expires_at > created_at),
    CONSTRAINT chk_timer_after_create   CHECK (timer_activated_at >= created_at)
);

CREATE TRIGGER trg_payments_updated_at
    BEFORE UPDATE ON payments
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_reject_expired_pending
    BEFORE INSERT OR UPDATE OF status, expires_at
    ON payments
    FOR EACH ROW EXECUTE FUNCTION reject_expired_pending_payments();

CREATE TRIGGER trg_validate_payment_status_transition
    BEFORE UPDATE OF status ON payments
    FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION validate_payment_status_transition();

CREATE TRIGGER trg_sync_payment_status
    AFTER UPDATE OF status ON payments
    FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION sync_participant_payment_status();

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_one_active_per_participant
    ON payments (participant_id)
    WHERE status IN ('pending','processing');

CREATE INDEX IF NOT EXISTS idx_payments_expired_pending ON payments (expires_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_payments_participant ON payments (participant_id);
CREATE INDEX IF NOT EXISTS idx_payments_status     ON payments (status);

CREATE TABLE IF NOT EXISTS payment_files (
    id                BIGSERIAL PRIMARY KEY,
    payment_id        BIGINT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
    bucket_name       VARCHAR(120) NOT NULL DEFAULT 'cognitapi',
    object_key        VARCHAR(512) NOT NULL,
    sha256            CHAR(64) NOT NULL CHECK (length(sha256) = 64),
    etag              VARCHAR(128),
    file_size         BIGINT CHECK (file_size >= 0),
    content_type      VARCHAR(120),
    uploaded_by_ip_hash CHAR(64),
    image_phash       VARCHAR(64),
    image_quality_score NUMERIC(5,2),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_payment_files_key_prefix CHECK (object_key LIKE 'payments/%')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_files_object_key_unique ON payment_files (object_key);
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_file_per_payment            ON payment_files (payment_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_files_sha256_unique     ON payment_files (sha256);

CREATE INDEX IF NOT EXISTS idx_payment_files_payment  ON payment_files (payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_files_sha256   ON payment_files (sha256);
CREATE INDEX IF NOT EXISTS idx_payment_files_phash    ON payment_files (image_phash) WHERE image_phash IS NOT NULL;

CREATE TABLE IF NOT EXISTS payment_fraud_signals (
    id           BIGSERIAL PRIMARY KEY,
    payment_id   BIGINT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
    signal_type  VARCHAR(80) NOT NULL,
    signal_score NUMERIC(5,2) NOT NULL CHECK (signal_score >= 0),
    details      JSONB NOT NULL DEFAULT '{}',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT unique_signal_per_payment UNIQUE (payment_id, signal_type)
);

CREATE INDEX IF NOT EXISTS idx_fraud_signals_payment ON payment_fraud_signals (payment_id);

CREATE TABLE IF NOT EXISTS payment_submissions (
    payment_id   BIGINT NOT NULL REFERENCES payments(id)   ON DELETE CASCADE,
    submission_id BIGINT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
    PRIMARY KEY (payment_id, submission_id)
);

CREATE INDEX IF NOT EXISTS idx_payment_submissions_payment        ON payment_submissions (payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_submissions_submission     ON payment_submissions (submission_id);
CREATE INDEX IF NOT EXISTS idx_payment_submissions_submission_payment ON payment_submissions (submission_id, payment_id);

-- =====================================================================
-- REWARDS
-- =====================================================================
CREATE TABLE IF NOT EXISTS reward_winners (
    id             BIGSERIAL PRIMARY KEY,
    participant_id BIGINT NOT NULL UNIQUE REFERENCES participants(id) ON DELETE CASCADE,
    reward_amount  INTEGER NOT NULL CHECK (reward_amount > 0),
    reason_code    VARCHAR(60),
    selected_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status         VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','paid','cancelled','expired')),
    paid_at        TIMESTAMPTZ,
    transaction_ref VARCHAR(120),
    notes          TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER trg_reward_winners_updated
    BEFORE UPDATE ON reward_winners
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_reward_winners_status     ON reward_winners (status);
CREATE INDEX IF NOT EXISTS idx_reward_winners_participant ON reward_winners (participant_id);

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

CREATE TABLE IF NOT EXISTS payment_audit_log (
    id               BIGSERIAL PRIMARY KEY,
    event_type       VARCHAR(60) NOT NULL,
    payment_id       BIGINT REFERENCES payments(id) ON DELETE SET NULL,
    participant_id   BIGINT REFERENCES participants(id) ON DELETE SET NULL,
    ip_hash          CHAR(64),
    user_agent       VARCHAR(512),
    device_fingerprint VARCHAR(256),
    request_data     JSONB,
    response_data    JSONB,
    fraud_signals    JSONB,
    details          TEXT CHECK (length(details) <= 8000),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_payment_audit_payment     ON payment_audit_log (payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_audit_participant ON payment_audit_log (participant_id);
CREATE INDEX IF NOT EXISTS idx_payment_audit_event_type  ON payment_audit_log (event_type);
CREATE INDEX IF NOT EXISTS idx_payment_audit_created     ON payment_audit_log (created_at DESC);

-- =====================================================================
-- PERFORMANCE METRICS (optional but useful)
-- =====================================================================
CREATE TABLE IF NOT EXISTS performance_metrics (
    id                BIGSERIAL PRIMARY KEY,
    endpoint          VARCHAR(120) NOT NULL,
    response_time_ms  INTEGER NOT NULL CHECK (response_time_ms >= 0),
    status_code       SMALLINT,
    request_size_bytes  INTEGER,
    response_size_bytes INTEGER,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_perf_created  ON performance_metrics (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_perf_endpoint ON performance_metrics (endpoint, created_at);
