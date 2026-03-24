"""Shared SQL query helpers for reward evaluation."""

from sqlalchemy import text

QUERY_TOUCH_PARTICIPANT_REWARD_CHECK = text("""
    INSERT INTO participant_activity_stats (
        participant_id, last_reward_check
    ) VALUES (
        :pid, CURRENT_TIMESTAMP
    )
    ON CONFLICT (participant_id) DO UPDATE SET
        last_reward_check = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
""")

QUERY_FETCH_REWARD_PARTICIPANT = text("""
    SELECT consent_given, is_deleted, payment_status
    FROM participants
    WHERE id = :pid
""")

QUERY_FETCH_REWARD_METRICS = text("""
    SELECT
        COALESCE(SUM(s.word_count), 0) AS total_words,
        COALESCE(MAX(s.survey_index), 0) AS max_round,
        COALESCE(COUNT(*) FILTER (WHERE s.is_survey = true), 0) AS survey_count,
        COALESCE(SUM(s.tab_switch_count), 0) AS total_tab_switch,
        COALESCE(SUM(s.page_close_attempts), 0) AS total_page_close,
        COALESCE(SUM(s.network_disconnects), 0) AS total_network_disconnect,
        AVG(COALESCE(s.time_spent_seconds, 0)) AS avg_time_spent,
        AVG(length(COALESCE(s.feedback, ''))) AS avg_feedback_length,
        AVG(COALESCE(s.rating, 0)) AS avg_rating,
        AVG(COALESCE(s.quality_score, 0)) AS avg_quality_score
    FROM submissions s
    WHERE s.participant_id = :pid
      AND s.is_survey = true
""")

QUERY_UPSERT_PRIORITY_PARTICIPANT = text("""
    INSERT INTO priority_participants (
        participant_id,
        total_words,
        completed_rounds,
        total_tab_switch,
        total_page_close_attempts,
        total_network_disconnects,
        avg_time_spent_seconds,
        avg_feedback_length,
        avg_rating,
        avg_quality_score,
        is_eligible,
        reason_code,
        metadata,
        last_evaluated_at
    ) VALUES (
        :participant_id,
        :total_words,
        :completed_rounds,
        :total_tab_switch,
        :total_page_close_attempts,
        :total_network_disconnects,
        :avg_time_spent_seconds,
        :avg_feedback_length,
        :avg_rating,
        :avg_quality_score,
        :is_eligible,
        :reason_code,
        CAST(:metadata AS jsonb),
        CURRENT_TIMESTAMP
    )
    ON CONFLICT (participant_id) DO UPDATE SET
        total_words = EXCLUDED.total_words,
        completed_rounds = EXCLUDED.completed_rounds,
        total_tab_switch = EXCLUDED.total_tab_switch,
        total_page_close_attempts = EXCLUDED.total_page_close_attempts,
        total_network_disconnects = EXCLUDED.total_network_disconnects,
        avg_time_spent_seconds = EXCLUDED.avg_time_spent_seconds,
        avg_feedback_length = EXCLUDED.avg_feedback_length,
        avg_rating = EXCLUDED.avg_rating,
        avg_quality_score = EXCLUDED.avg_quality_score,
        is_eligible = EXCLUDED.is_eligible,
        reason_code = EXCLUDED.reason_code,
        metadata = EXCLUDED.metadata,
        last_evaluated_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
""")

QUERY_UPSERT_REWARD_WINNER = text("""
    INSERT INTO reward_winners (
        participant_id,
        reason_code,
        is_selected,
        selected_at,
        status,
        notes
    ) VALUES (
        :participant_id,
        :reason_code,
        true,
        CURRENT_TIMESTAMP,
        :pending_status,
        :notes
    )
    ON CONFLICT (participant_id) DO UPDATE SET
        reason_code = EXCLUDED.reason_code,
        is_selected = true,
        status = CASE
            WHEN reward_winners.status IN (:cancelled_status, :expired_status) THEN reward_winners.status
            ELSE :pending_status
        END,
        notes = EXCLUDED.notes,
        updated_at = CURRENT_TIMESTAMP
""")
