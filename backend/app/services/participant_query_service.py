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
        consent_at = CURRENT_TIMESTAMP
    WHERE public_id = :pub AND is_deleted = false
    RETURNING id, stage
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
