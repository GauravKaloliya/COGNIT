-- =====================================================
-- C.O.G.N.I.T. PostgreSQL Schema
-- Version: 4.0.0 (PostgreSQL Edition) - Surrogate Key Migration
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
    payment_status VARCHAR(50) DEFAULT 'pending',
    ip_hash CHAR(64),
    user_agent VARCHAR(500),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT valid_email CHECK (
        email IS NULL OR
        email ~ '^[^@]+@[^@]+\.[^@]+$'
    ),

    CONSTRAINT valid_ip_hash CHECK (
        ip_hash IS NULL OR length(ip_hash) = 64
    )
);

-- =====================================================
-- Payments Table
-- =====================================================

CREATE TABLE IF NOT EXISTS payments (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    participant_fk BIGINT NOT NULL,
    participant_id VARCHAR(100) NOT NULL,
    razorpay_order_id VARCHAR(100) UNIQUE NOT NULL,
    razorpay_payment_id VARCHAR(100) UNIQUE,
    razorpay_signature VARCHAR(200),
    amount INTEGER NOT NULL,
    currency VARCHAR(10) DEFAULT 'INR',
    status VARCHAR(50) DEFAULT 'created',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    paid_at TIMESTAMPTZ,
    FOREIGN KEY (participant_fk)
        REFERENCES participants(id)
        ON DELETE CASCADE
);

-- =====================================================
-- Images Table (Created before submissions due to FK)
-- =====================================================

CREATE TABLE IF NOT EXISTS images (
    image_id VARCHAR(100) PRIMARY KEY,
    image_url VARCHAR(500) NOT NULL,
    difficulty_score DOUBLE PRECISION,
    object_count INTEGER,
    width INTEGER,
    height INTEGER,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
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
    FOREIGN KEY (image_id)
        REFERENCES images(image_id)
        ON DELETE CASCADE
);

-- =====================================================
-- Attention Stats Table
-- =====================================================

CREATE TABLE IF NOT EXISTS attention_stats (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    participant_fk BIGINT NOT NULL,
    participant_id VARCHAR(100) NOT NULL,
    total_checks INT DEFAULT 0 CHECK (total_checks >= 0),
    passed_checks INT DEFAULT 0 CHECK (passed_checks >= 0),
    failed_checks INT DEFAULT 0 CHECK (failed_checks >= 0),
    attention_score FLOAT DEFAULT 1.0,
    is_flagged BOOLEAN DEFAULT FALSE,

    CONSTRAINT fk_attention_stats_participant
        FOREIGN KEY (participant_fk)
        REFERENCES participants(id)
        ON DELETE CASCADE,

    CONSTRAINT valid_attention_counts
        CHECK (total_checks >= passed_checks + failed_checks),

    CONSTRAINT attention_score_range
        CHECK (attention_score BETWEEN 0 AND 1),

    CONSTRAINT unique_attention_stats_participant
        UNIQUE (participant_fk),

    CONSTRAINT unique_attention_stats_participant_id
        UNIQUE (participant_id)
);

-- =====================================================
-- Submissions Table
-- =====================================================

CREATE TABLE IF NOT EXISTS submissions (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    participant_fk BIGINT NOT NULL,
    participant_id VARCHAR(100) NOT NULL,
    session_id VARCHAR(100) NOT NULL,
    image_id VARCHAR(100) NOT NULL,
    image_url VARCHAR(500),
    survey_index INTEGER NOT NULL,
    description TEXT NOT NULL CHECK (length(description) <= 10000),
    word_count INTEGER NOT NULL CHECK (word_count BETWEEN 0 AND 10000),
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 10),
    feedback TEXT NOT NULL CHECK (length(feedback) <= 2000),
    time_spent_seconds DOUBLE PRECISION CHECK (time_spent_seconds >= 0),
    is_survey BOOLEAN DEFAULT FALSE,
    is_attention BOOLEAN DEFAULT FALSE,
    attention_passed BOOLEAN,
    too_fast_flag BOOLEAN DEFAULT FALSE,
    attention_score_at_submission FLOAT,
    quality_score FLOAT,
    ai_suspected BOOLEAN DEFAULT FALSE,
    user_agent VARCHAR(500),
    ip_hash CHAR(64),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_participant
        FOREIGN KEY (participant_fk)
        REFERENCES participants(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_image
        FOREIGN KEY (image_id)
        REFERENCES images(image_id),

    CONSTRAINT unique_participant_survey_index
        UNIQUE (participant_fk, survey_index),

    CONSTRAINT attention_score_range
        CHECK (attention_score_at_submission IS NULL OR attention_score_at_submission BETWEEN 0 AND 1),

    CONSTRAINT quality_score_range
        CHECK (quality_score IS NULL OR quality_score BETWEEN 0 AND 1),

    CONSTRAINT ai_suspected_requires_quality_score
        CHECK (ai_suspected IS NULL OR ai_suspected = FALSE OR quality_score IS NOT NULL)
);

-- =====================================================
-- Consent Records
-- =====================================================

CREATE TABLE IF NOT EXISTS consent_records (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    participant_fk BIGINT NOT NULL,
    participant_id VARCHAR(100) UNIQUE NOT NULL,
    consent_given BOOLEAN DEFAULT FALSE,
    consent_timestamp TIMESTAMPTZ,
    ip_hash CHAR(64),
    user_agent VARCHAR(500),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (participant_fk)
        REFERENCES participants(id)
        ON DELETE CASCADE
);

-- =====================================================
-- Participant Stats Table
-- =====================================================

CREATE TABLE IF NOT EXISTS participant_stats (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    participant_fk BIGINT NOT NULL,
    participant_id VARCHAR(100) NOT NULL,
    total_words INT DEFAULT 0,
    total_submissions INT DEFAULT 0,
    survey_rounds INT DEFAULT 0,
    priority_eligible BOOLEAN DEFAULT FALSE,
    attention_score FLOAT DEFAULT 1.0,
    last_reward_attempt_at TIMESTAMPTZ,

    CONSTRAINT fk_participant_stats_participant
        FOREIGN KEY (participant_fk)
        REFERENCES participants(id)
        ON DELETE CASCADE,

    CONSTRAINT attention_score_range
        CHECK (attention_score BETWEEN 0 AND 1),

    CONSTRAINT unique_participant_stats_participant
        UNIQUE (participant_fk),

    CONSTRAINT unique_participant_stats_participant_id
        UNIQUE (participant_id)
);

-- =====================================================
-- Reward Winners Table
-- =====================================================

CREATE TABLE IF NOT EXISTS reward_winners (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    participant_fk BIGINT NOT NULL,
    participant_id VARCHAR(100) NOT NULL,
    reward_amount INTEGER NOT NULL CHECK (reward_amount > 0),
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled')),
    selected_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    paid_at TIMESTAMPTZ,

    CONSTRAINT fk_reward_winners_participant
        FOREIGN KEY (participant_fk)
        REFERENCES participants(id)
        ON DELETE CASCADE,

    CONSTRAINT unique_reward_participant
        UNIQUE (participant_fk),

    CONSTRAINT unique_reward_participant_id
        UNIQUE (participant_id)
);

-- =====================================================
-- Audit Log
-- =====================================================

CREATE TABLE IF NOT EXISTS audit_log (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    event_type VARCHAR(50) NOT NULL,
    user_id VARCHAR(100),
    participant_fk BIGINT,
    participant_id VARCHAR(100),
    endpoint VARCHAR(100),
    method VARCHAR(10),
    status_code INTEGER,
    ip_hash CHAR(64),
    user_agent VARCHAR(500),
    details TEXT CHECK (length(details) <= 2000),

    CONSTRAINT fk_audit_participant
        FOREIGN KEY (participant_fk)
        REFERENCES participants(id)
        ON DELETE SET NULL
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
    response_size_bytes INTEGER CHECK (response_size_bytes >= 0)
);

-- =====================================================
-- Indexes
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_participants_participant_id ON participants(participant_id);
CREATE INDEX IF NOT EXISTS idx_participants_session ON participants(session_id);
CREATE INDEX IF NOT EXISTS idx_participants_created ON participants(created_at);
CREATE INDEX IF NOT EXISTS idx_participants_consent ON participants(consent_given);
CREATE INDEX IF NOT EXISTS idx_participants_payment_status ON participants(payment_status);

CREATE INDEX IF NOT EXISTS idx_payments_participant_fk ON payments(participant_fk);
CREATE INDEX IF NOT EXISTS idx_payments_participant_id ON payments(participant_id);
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(razorpay_order_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);

CREATE INDEX IF NOT EXISTS idx_submissions_participant_fk ON submissions(participant_fk);
CREATE INDEX IF NOT EXISTS idx_submissions_participant_id ON submissions(participant_id);
CREATE INDEX IF NOT EXISTS idx_submissions_session ON submissions(session_id);
CREATE INDEX IF NOT EXISTS idx_submissions_created ON submissions(created_at);
CREATE INDEX IF NOT EXISTS idx_submissions_image ON submissions(image_id);
CREATE INDEX IF NOT EXISTS idx_submissions_survey ON submissions(is_survey);
CREATE INDEX IF NOT EXISTS idx_submissions_attention ON submissions(is_attention);
CREATE INDEX IF NOT EXISTS idx_submissions_quality ON submissions(quality_score);
CREATE INDEX IF NOT EXISTS idx_submissions_ai_suspected ON submissions(ai_suspected);
CREATE INDEX IF NOT EXISTS idx_submissions_survey_index ON submissions(participant_fk, survey_index);

CREATE INDEX IF NOT EXISTS idx_consent_participant_fk ON consent_records(participant_fk);
CREATE INDEX IF NOT EXISTS idx_consent_participant_id ON consent_records(participant_id);
CREATE INDEX IF NOT EXISTS idx_consent_timestamp ON consent_records(consent_timestamp);

CREATE INDEX IF NOT EXISTS idx_images_created ON images(created_at);

CREATE INDEX IF NOT EXISTS idx_attention_checks_image ON attention_checks(image_id);
CREATE INDEX IF NOT EXISTS idx_attention_checks_active ON attention_checks(is_active);

CREATE INDEX IF NOT EXISTS idx_attention_stats_participant_fk ON attention_stats(participant_fk);
CREATE INDEX IF NOT EXISTS idx_attention_stats_participant_id ON attention_stats(participant_id);
CREATE INDEX IF NOT EXISTS idx_attention_stats_flagged ON attention_stats(is_flagged);

CREATE INDEX IF NOT EXISTS idx_participant_stats_participant_fk ON participant_stats(participant_fk);
CREATE INDEX IF NOT EXISTS idx_participant_stats_participant_id ON participant_stats(participant_id);
CREATE INDEX IF NOT EXISTS idx_participant_stats_priority ON participant_stats(priority_eligible);
CREATE INDEX IF NOT EXISTS idx_participant_stats_reward_attempt ON participant_stats(last_reward_attempt_at);

CREATE INDEX IF NOT EXISTS idx_reward_winners_participant_fk ON reward_winners(participant_fk);
CREATE INDEX IF NOT EXISTS idx_reward_winners_participant_id ON reward_winners(participant_id);
CREATE INDEX IF NOT EXISTS idx_reward_winners_status ON reward_winners(status);
CREATE INDEX IF NOT EXISTS idx_reward_winners_selected_at ON reward_winners(selected_at);

CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_participant_fk ON audit_log(participant_fk);
CREATE INDEX IF NOT EXISTS idx_audit_participant_id ON audit_log(participant_id);
CREATE INDEX IF NOT EXISTS idx_audit_endpoint ON audit_log(endpoint);

CREATE INDEX IF NOT EXISTS idx_performance_timestamp ON performance_metrics(timestamp);
CREATE INDEX IF NOT EXISTS idx_performance_endpoint ON performance_metrics(endpoint);

-- =====================================================
-- TRIGGERS (PostgreSQL Version)
-- =====================================================

-- Function for participant insert audit
CREATE OR REPLACE FUNCTION fn_participant_insert_audit()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO audit_log
    (event_type, participant_fk, participant_id, endpoint, method, status_code, ip_hash, user_agent, details)
    VALUES
    ('participant_created', NEW.id, NEW.participant_id,
     '/api/participants', 'POST', 201,
     NEW.ip_hash, NEW.user_agent,
     'New participant created');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_participant_insert_audit ON participants;
CREATE TRIGGER trg_participant_insert_audit
AFTER INSERT ON participants
FOR EACH ROW
EXECUTE FUNCTION fn_participant_insert_audit();


-- Function for consent insert audit
CREATE OR REPLACE FUNCTION fn_consent_insert_audit()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO audit_log
    (event_type, participant_fk, participant_id, endpoint, method, status_code, ip_hash, user_agent, details)
    VALUES
    ('consent_recorded', NEW.participant_fk, NEW.participant_id,
     '/api/consent', 'POST', 200,
     NEW.ip_hash, NEW.user_agent,
     'Consent recorded for participant');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_consent_insert_audit ON consent_records;
CREATE TRIGGER trg_consent_insert_audit
AFTER INSERT ON consent_records
FOR EACH ROW
EXECUTE FUNCTION fn_consent_insert_audit();


-- Function for submission insert audit
CREATE OR REPLACE FUNCTION fn_submission_insert_audit()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO audit_log
    (event_type, participant_fk, participant_id, endpoint, method, status_code, ip_hash, user_agent, details)
    VALUES
    ('submission_created', NEW.participant_fk, NEW.participant_id,
     '/api/submit', 'POST', 200,
     NEW.ip_hash, NEW.user_agent,
     'New submission created for image: ' || NEW.image_id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_submission_insert_audit ON submissions;
CREATE TRIGGER trg_submission_insert_audit
AFTER INSERT ON submissions
FOR EACH ROW
EXECUTE FUNCTION fn_submission_insert_audit();

-- =====================================================
-- Metadata Table
-- =====================================================

CREATE TABLE IF NOT EXISTS database_metadata (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO database_metadata (key, value)
VALUES
    ('version', '4.0.0'),
    ('schema_updated', CURRENT_TIMESTAMP::text),
    ('description', 'C.O.G.N.I.T. Research Platform Database - Surrogate key migration with standardized ID types and score constraints')
ON CONFLICT (key) DO UPDATE SET
    value = EXCLUDED.value,
    updated_at = CURRENT_TIMESTAMP;
