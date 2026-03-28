"""Shared SQL query helpers for participant services."""

from sqlalchemy import text

QUERY_FIND_EXISTING_PARTICIPANT_CONFLICT = text("""
    SELECT username, email
    FROM participants
    WHERE is_deleted = false
      AND (
        username = :un
        OR email = :em
      )
    LIMIT 1
""")

QUERY_INSERT_PARTICIPANT = text("""
    INSERT INTO participants (
        public_id, session_id, username, email,
        gender_code, age, location, language_code, prior_experience,
        ip_hash, user_agent, extra_metadata
    ) VALUES (
        :pub, :sid, :un, :em, :gc, :age, :loc, :lc, :pe, :iph, :ua, '{}'
    )
    RETURNING id
""")

QUERY_RECORD_PARTICIPANT_CONSENT = text("""
    UPDATE participants
    SET consent_given = true,
        consent_at = COALESCE(consent_at, CURRENT_TIMESTAMP),
        session_id = COALESCE(NULLIF(session_id, ''), :sid)
    WHERE public_id = :pub AND is_deleted = false
    RETURNING id, stage, session_id
""")

QUERY_UPDATE_PARTICIPANT_STAGE = text("""
    UPDATE participants
    SET stage = :stage,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = :pid
""")

QUERY_GET_EXISTING_SESSION_ID = text("""
    SELECT session_id
    FROM participants
    WHERE public_id = :pub AND is_deleted = false
    LIMIT 1
""")

QUERY_FETCH_PARTICIPANT_SESSION_STATUS = text("""
    SELECT
        ps.id,
        ps.ended_at,
        ps.last_seen_at
    FROM participant_sessions ps
    JOIN participants p ON p.id = ps.participant_id
    WHERE p.public_id = :pub
      AND p.is_deleted = false
      AND ps.session_id = :sid
    LIMIT 1
""")

QUERY_UPSERT_PARTICIPANT_SESSION = text("""
    INSERT INTO participant_sessions (
        participant_id, session_id, started_at, last_seen_at
    ) VALUES (
        :pid, :sid, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
    ON CONFLICT (participant_id, session_id) DO UPDATE
    SET
        last_seen_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE participant_sessions.ended_at IS NULL
    RETURNING id, ended_at
""")

QUERY_TOUCH_PARTICIPANT_SESSION = text("""
    UPDATE participant_sessions ps
    SET last_seen_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    FROM participants p
    WHERE p.id = ps.participant_id
      AND p.public_id = :pub
      AND p.is_deleted = false
      AND ps.session_id = :sid
      AND ps.ended_at IS NULL
    RETURNING ps.id, ps.ended_at, ps.last_seen_at
""")

QUERY_CLOSE_PARTICIPANT_SESSION_BY_KEY = text("""
    UPDATE participant_sessions ps
    SET ended_at = CURRENT_TIMESTAMP,
        last_seen_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    FROM participants p
    WHERE p.id = ps.participant_id
      AND p.public_id = :pub
      AND p.is_deleted = false
      AND ps.session_id = :sid
      AND ps.ended_at IS NULL
    RETURNING ps.id, ps.ended_at, ps.last_seen_at
""")

QUERY_CHECK_PARTICIPANT_FIELD_AVAILABLE_TEMPLATE = """
    SELECT 1 FROM participants
    WHERE {field_name} = :value AND is_deleted = false
    LIMIT 1
"""

QUERY_FETCH_GENDERS = text("""
    SELECT code, display_name
    FROM genders
    WHERE active = true
    ORDER BY sort_order ASC, display_name ASC
""")

QUERY_FETCH_LANGUAGES = text("""
    SELECT code, name, native_name
    FROM languages
    WHERE active = true
    ORDER BY name ASC
""")

QUERY_FETCH_PRIOR_EXPERIENCES = text("""
    SELECT code, display_name, group_label
    FROM prior_experiences
    WHERE active = true
    ORDER BY group_sort_order ASC, sort_order ASC, display_name ASC
""")

QUERY_CHECK_PRIOR_EXPERIENCE_EXISTS = text("""
    SELECT 1
    FROM prior_experiences
    WHERE code = :code AND active = true
    LIMIT 1
""")
