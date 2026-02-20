-- =====================================================
-- C.O.G.N.I.T. PostgreSQL Schema
-- Version: 5.0.0 - Fixed Critical Issues
-- =====================================================

-- =====================================================
-- Participants Table
-- =====================================================

CREATE TABLE IF NOT EXISTS participants (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    participant_id VARCHAR(100) UNIQUE NOT NULL,
    session_id VARCHAR(100) NOT NULL,
    username VARCHAR(100) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(30),
    gender VARCHAR(50),
    age INTEGER CHECK (age BETWEEN 1 AND 120),
    place VARCHAR(100),
    native_language VARCHAR(50),
    prior_experience VARCHAR(100),
    consent_given BOOLEAN DEFAULT FALSE,
    consent_timestamp TIMESTAMPTZ,
    payment_status VARCHAR(50) DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'failed', 'refunded')),
    ip_hash CHAR(64),
    user_agent VARCHAR(500),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT valid_email CHECK (
        email IS NULL OR
        email ~ '^[^@]+@[^@]+\.[^@]+$'
    ),

    CONSTRAINT valid_ip_hash CHECK (
        ip_hash IS NULL OR ip_hash ~ '^[a-f0-9]{64}$'
    ),

    CONSTRAINT unique_participants_session_id UNIQUE (session_id)
);

-- =====================================================
-- Images Table
-- =====================================================

CREATE TABLE IF NOT EXISTS images (
    image_id VARCHAR(100) PRIMARY KEY,
    image_url VARCHAR(500) NOT NULL UNIQUE,
    difficulty_score DOUBLE PRECISION CHECK (difficulty_score BETWEEN 0 AND 10),
    object_count INTEGER CHECK (object_count > 0),
    width INTEGER CHECK (width > 0),
    height INTEGER CHECK (height > 0),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- Attention Checks Table
-- =====================================================

CREATE TABLE IF NOT EXISTS attention_checks (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    image_id VARCHAR(100) UNIQUE NOT NULL,
    expected_word VARCHAR(100) NOT NULL,
    strict BOOLEAN DEFAULT TRUE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (image_id)
        REFERENCES images(image_id)
        ON DELETE CASCADE
);

-- =====================================================
-- Attention Stats Table
-- FIXED: Removed duplicate participant_id storage, unique constraint names
-- =====================================================

CREATE TABLE IF NOT EXISTS attention_stats (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    participant_fk BIGINT NOT NULL,
    total_checks INT DEFAULT 0 CHECK (total_checks >= 0),
    passed_checks INT DEFAULT 0 CHECK (passed_checks >= 0),
    failed_checks INT DEFAULT 0 CHECK (failed_checks >= 0),
    attention_score DOUBLE PRECISION DEFAULT 1.0,
    is_flagged BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_attention_stats_participant
        FOREIGN KEY (participant_fk)
        REFERENCES participants(id)
        ON DELETE CASCADE,

    CONSTRAINT valid_attention_counts_equal
        CHECK (total_checks = passed_checks + failed_checks),

    CONSTRAINT valid_attention_counts_passed
        CHECK (passed_checks <= total_checks),

    CONSTRAINT valid_attention_counts_failed
        CHECK (failed_checks <= total_checks),

    CONSTRAINT attention_stats_score_range
        CHECK (attention_score BETWEEN 0 AND 1),

    CONSTRAINT unique_attention_stats_participant
        UNIQUE (participant_fk)
);

-- =====================================================
-- Submissions Table
-- FIXED: Removed duplicate participant_id, fixed constraint names
-- =====================================================

CREATE TABLE IF NOT EXISTS submissions (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    participant_fk BIGINT NOT NULL,
    session_id VARCHAR(100) NOT NULL,
    image_id VARCHAR(100) NOT NULL,
    image_url VARCHAR(500),
    survey_index INTEGER NOT NULL,
    description TEXT NOT NULL CHECK (length(description) <= 10000),
    word_count INTEGER NOT NULL CHECK (word_count BETWEEN 0 AND 10000),
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 10),
    feedback TEXT NOT NULL CHECK (length(feedback) BETWEEN 5 AND 2000),
    time_spent_seconds DOUBLE PRECISION CHECK (time_spent_seconds >= 0),
    is_survey BOOLEAN DEFAULT FALSE,
    is_attention BOOLEAN DEFAULT FALSE,
    attention_passed BOOLEAN,
    too_fast_flag BOOLEAN DEFAULT FALSE,
    attention_score_at_submission DOUBLE PRECISION,
    quality_score DOUBLE PRECISION,
    ai_suspected BOOLEAN DEFAULT FALSE,
    user_agent VARCHAR(500),
    ip_hash CHAR(64),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_participant
        FOREIGN KEY (participant_fk)
        REFERENCES participants(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_image
        FOREIGN KEY (image_id)
        REFERENCES images(image_id),

    CONSTRAINT unique_participant_survey_index
        UNIQUE (participant_fk, survey_index)
        WHERE is_survey = TRUE,

    CONSTRAINT submissions_attention_score_range
        CHECK (attention_score_at_submission IS NULL OR attention_score_at_submission BETWEEN 0 AND 1),

    CONSTRAINT submissions_quality_score_range
        CHECK (quality_score IS NULL OR quality_score BETWEEN 0 AND 1),

    CONSTRAINT submissions_ai_suspected_check
        CHECK (ai_suspected = FALSE OR quality_score IS NOT NULL)
);

-- =====================================================
-- Consent Records
-- FIXED: Removed UNIQUE constraint on participant_id to allow versioning
-- =====================================================

CREATE TABLE IF NOT EXISTS consent_records (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    participant_fk BIGINT NOT NULL,
    participant_id VARCHAR(100) NOT NULL,
    consent_given BOOLEAN DEFAULT FALSE,
    consent_timestamp TIMESTAMPTZ,
    consent_version VARCHAR(50) DEFAULT '1.0',
    ip_hash CHAR(64),
    user_agent VARCHAR(500),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_consent_participant
        FOREIGN KEY (participant_fk)
        REFERENCES participants(id)
        ON DELETE CASCADE,

    CONSTRAINT unique_consent_per_participant_version
        UNIQUE (participant_fk, consent_version)
);

-- =====================================================
-- Participant Stats Table
-- FIXED: Removed duplicate participant_id storage, fixed constraint names
-- =====================================================

CREATE TABLE IF NOT EXISTS participant_stats (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    participant_fk BIGINT NOT NULL,
    total_words INT DEFAULT 0 CHECK (total_words >= 0),
    total_submissions INT DEFAULT 0 CHECK (total_submissions >= 0),
    survey_rounds INT DEFAULT 0 CHECK (survey_rounds >= 0),
    priority_eligible BOOLEAN DEFAULT FALSE,
    attention_score DOUBLE PRECISION DEFAULT 1.0,
    last_reward_attempt_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_participant_stats_participant
        FOREIGN KEY (participant_fk)
        REFERENCES participants(id)
        ON DELETE CASCADE,

    CONSTRAINT participant_stats_score_range
        CHECK (attention_score BETWEEN 0 AND 1),

    CONSTRAINT unique_participant_stats_participant
        UNIQUE (participant_fk)
);

-- =====================================================
-- Reward Winners Table
-- FIXED: Removed duplicate participant_id storage and redundant unique constraint
-- =====================================================

CREATE TABLE IF NOT EXISTS reward_winners (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    participant_fk BIGINT NOT NULL,
    reward_amount INTEGER NOT NULL CHECK (reward_amount > 0),
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled')),
    selected_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    paid_at TIMESTAMPTZ,

    CONSTRAINT fk_reward_winners_participant
        FOREIGN KEY (participant_fk)
        REFERENCES participants(id)
        ON DELETE CASCADE,

    CONSTRAINT unique_reward_participant
        UNIQUE (participant_fk)
);

-- =====================================================
-- Payment Transactions (Idempotency)
-- =====================================================

CREATE TABLE IF NOT EXISTS payment_transactions (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    participant_fk BIGINT NOT NULL,
    transaction_id VARCHAR(100) UNIQUE NOT NULL,
    razorpay_order_id VARCHAR(100),
    razorpay_payment_id VARCHAR(100),
    razorpay_signature VARCHAR(255),
    amount INTEGER NOT NULL CHECK (amount > 0),
    currency VARCHAR(10) DEFAULT 'INR',
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'created', 'authorized', 'captured', 'failed', 'refunded')),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_payment_participant
        FOREIGN KEY (participant_fk)
        REFERENCES participants(id)
        ON DELETE CASCADE
);

-- =====================================================
-- Audit Log
-- FIXED: Removed participant_id denormalization, added indexes
-- =====================================================

CREATE TABLE IF NOT EXISTS audit_log (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    event_type VARCHAR(50) NOT NULL,
    user_id VARCHAR(100),
    participant_fk BIGINT,
    endpoint VARCHAR(100),
    method VARCHAR(10),
    status_code INTEGER,
    ip_hash CHAR(64),
    user_agent VARCHAR(500),
    details TEXT CHECK (length(details) <= 2000),
    request_id VARCHAR(100),

    CONSTRAINT fk_audit_participant
        FOREIGN KEY (participant_fk)
        REFERENCES participants(id)
        ON DELETE SET NULL,

    CONSTRAINT valid_audit_ip_hash
        CHECK (ip_hash IS NULL OR ip_hash ~ '^[a-f0-9]{64}$')
);

-- =====================================================
-- Performance Metrics
-- =====================================================

CREATE TABLE IF NOT EXISTS performance_metrics (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    endpoint VARCHAR(100) NOT NULL,
    response_time_ms INTEGER CHECK (response_time_ms >= 0),
    status_code INTEGER,
    request_size_bytes INTEGER CHECK (request_size_bytes >= 0),
    response_size_bytes INTEGER CHECK (response_size_bytes >= 0),
    request_id VARCHAR(100)
);

-- =====================================================
-- Idempotency Keys (for preventing duplicate submissions)
-- =====================================================

CREATE TABLE IF NOT EXISTS idempotency_keys (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    key_hash VARCHAR(64) UNIQUE NOT NULL,
    endpoint VARCHAR(100) NOT NULL,
    response_status INTEGER,
    response_body TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMPTZ NOT NULL
);

-- =====================================================
-- Indexes (Optimized)
-- =====================================================

-- Participants indexes
CREATE INDEX IF NOT EXISTS idx_participants_participant_id ON participants(participant_id);
CREATE INDEX IF NOT EXISTS idx_participants_session ON participants(session_id);
CREATE INDEX IF NOT EXISTS idx_participants_created ON participants(created_at);
CREATE INDEX IF NOT EXISTS idx_participants_consent ON participants(consent_given);
CREATE INDEX IF NOT EXISTS idx_participants_payment_status ON participants(payment_status);

-- Submissions indexes - Partial indexes for better performance
CREATE INDEX IF NOT EXISTS idx_submissions_participant_fk ON submissions(participant_fk);
CREATE INDEX IF NOT EXISTS idx_submissions_session ON submissions(session_id);
CREATE INDEX IF NOT EXISTS idx_submissions_created ON submissions(created_at);
CREATE INDEX IF NOT EXISTS idx_submissions_image ON submissions(image_id);
CREATE INDEX IF NOT EXISTS idx_submissions_survey_idx ON submissions(participant_fk, survey_index) WHERE is_survey = TRUE;
CREATE INDEX IF NOT EXISTS idx_submissions_quality ON submissions(participant_fk, quality_score) WHERE quality_score IS NOT NULL;

-- Consent records indexes
CREATE INDEX IF NOT EXISTS idx_consent_participant_fk ON consent_records(participant_fk);
CREATE INDEX IF NOT EXISTS idx_consent_timestamp ON consent_records(consent_timestamp);

-- Images indexes
CREATE INDEX IF NOT EXISTS idx_images_created ON images(created_at);
CREATE INDEX IF NOT EXISTS idx_images_difficulty ON images(difficulty_score);

-- Attention checks indexes
CREATE INDEX IF NOT EXISTS idx_attention_checks_image ON attention_checks(image_id);
CREATE INDEX IF NOT EXISTS idx_attention_checks_active ON attention_checks(is_active);

-- Attention stats indexes
CREATE INDEX IF NOT EXISTS idx_attention_stats_participant_fk ON attention_stats(participant_fk);
CREATE INDEX IF NOT EXISTS idx_attention_stats_flagged ON attention_stats(is_flagged);

-- Participant stats indexes
CREATE INDEX IF NOT EXISTS idx_participant_stats_participant_fk ON participant_stats(participant_fk);
CREATE INDEX IF NOT EXISTS idx_participant_stats_priority ON participant_stats(priority_eligible) WHERE priority_eligible = TRUE;

-- Reward winners indexes
CREATE INDEX IF NOT EXISTS idx_reward_winners_participant_fk ON reward_winners(participant_fk);
CREATE INDEX IF NOT EXISTS idx_reward_winners_status ON reward_winners(status);

-- Audit log indexes
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_participant_fk ON audit_log(participant_fk);
CREATE INDEX IF NOT EXISTS idx_audit_endpoint ON audit_log(endpoint);
CREATE INDEX IF NOT EXISTS idx_audit_request_id ON audit_log(request_id);

-- Performance metrics indexes
CREATE INDEX IF NOT EXISTS idx_performance_timestamp ON performance_metrics(timestamp);
CREATE INDEX IF NOT EXISTS idx_performance_endpoint ON performance_metrics(endpoint);
CREATE INDEX IF NOT EXISTS idx_performance_request_id ON performance_metrics(request_id);

-- Payment transactions indexes
CREATE INDEX IF NOT EXISTS idx_payment_participant_fk ON payment_transactions(participant_fk);
CREATE INDEX IF NOT EXISTS idx_payment_transaction_id ON payment_transactions(transaction_id);
CREATE INDEX IF NOT EXISTS idx_payment_status ON payment_transactions(status);

-- Idempotency keys indexes
CREATE INDEX IF NOT EXISTS idx_idempotency_key_hash ON idempotency_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_idempotency_expires ON idempotency_keys(expires_at);

-- =====================================================
-- Data Retention Policies (as comments for implementation)
-- =====================================================
-- Audit log: RETAIN 90 days
-- Performance metrics: RETAIN 30 days  
-- Idempotency keys: RETAIN 24 hours
-- Old completed payments: ARCHIVE after 1 year
