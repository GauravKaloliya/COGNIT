"""Shared SQL helpers for submission flows."""

from __future__ import annotations

import json

from sqlalchemy import text

QUERY_FETCH_SUBMISSION_PARTICIPANT = text("""
    SELECT
        p.id,
        p.consent_given,
        p.is_deleted,
        p.extra_metadata,
        p.stage,
        p.stage_updated_at,
        COALESCE(pas.is_flagged, false) AS is_flagged,
        COALESCE(pas.total_checks, 0) AS total_checks,
        COALESCE(pas.passed_checks, 0) AS passed_checks,
        COALESCE(pas.failed_checks, 0) AS failed_checks,
        COALESCE(pas.attention_score, 1.0) AS attention_score,
        p.session_id
    FROM participants p
    LEFT JOIN participant_attention_stats pas ON pas.participant_id = p.id
    WHERE p.public_id = :pub
""")

QUERY_FETCH_IMAGE_TARGET = text("""
    SELECT
        i.id,
        CASE
            WHEN i.tags IS NULL THEN true
            WHEN 'non-survey' = ANY(i.tags) THEN false
            ELSE true
        END AS is_survey_image
    FROM images i
    WHERE i.image_id = :iid
""")

QUERY_LOCK_PARTICIPANT = text("""
    SELECT id
    FROM participants
    WHERE id = :pid
    FOR UPDATE
""")

QUERY_NEXT_SURVEY_INDEX = text("""
    SELECT COALESCE(MAX(survey_index), 0) + 1
    FROM submissions
    WHERE participant_id = :pid
""")

QUERY_DUPLICATE_NON_SURVEY_SUBMISSION = text("""
    SELECT 1
    FROM submissions
    WHERE participant_id = :pid
      AND image_id = :iid
      AND is_survey = false
""")

QUERY_FETCH_ATTENTION_CHECK = text("""
    SELECT expected_word, is_strict
    FROM attention_checks
    WHERE image_id = :iid AND is_active = true
""")

QUERY_HAS_COPIED_ATTENTION_PATTERN = text("""
    SELECT 1
    FROM attention_events ae
    WHERE ae.image_id = :img_id
      AND ae.content_fingerprint = :fp
      AND ae.participant_id <> :pid
    LIMIT 1
""")

QUERY_INSERT_SUBMISSION = text("""
    INSERT INTO submissions (
        participant_id, participant_session_id, image_id, survey_index, description, word_count,
        rating, feedback, time_spent_seconds, is_survey, is_attention_check,
        attention_passed, flagged_too_fast, quality_score, alignment_score,
        ip_hash, user_agent, device_type, extra_metadata,
        tab_switch_count, page_close_attempts, network_disconnects,
        survey_time_spent_seconds, survey_page_views, survey_tab_switches,
        survey_page_close_attempts, survey_network_disconnects,
        survey_max_scroll_depth_pct, survey_clicks, survey_keypresses
    ) VALUES (
        :pid, :psid, :iid, :sidx, :desc, :wc, :rt, :fb, :ts, :isv, :isa,
        :ap, :tf, :qs, :als, :iph, :ua, :dt, :meta,
        :tsc, :pca, :nd,
        :survey_time_spent_seconds, :survey_page_views, :survey_tab_switches,
        :survey_page_close_attempts, :survey_network_disconnects,
        :survey_max_scroll_depth_pct, :survey_clicks, :survey_keypresses
    ) RETURNING id
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
        ended_at = NULL,
        updated_at = CURRENT_TIMESTAMP
    RETURNING id
""")

QUERY_INSERT_SUBMISSION_BEHAVIOR_METRICS = text("""
    INSERT INTO submission_behavior_metrics (
        submission_id,
        time_before_typing_seconds,
        edit_count,
        backspace_count,
        avg_keystroke_interval_seconds,
        keystroke_variance,
        pause_count,
        avg_pause_duration_seconds
    ) VALUES (
        :submission_id,
        :time_before_typing_seconds,
        :edit_count,
        :backspace_count,
        :avg_keystroke_interval_seconds,
        :keystroke_variance,
        :pause_count,
        :avg_pause_duration_seconds
    )
""")

QUERY_INSERT_SUBMISSION_COGNITIVE_METRICS = text("""
    INSERT INTO submission_cognitive_metrics (
        submission_id,
        confidence_score,
        difficulty_self_report,
        first_view_duration_seconds,
        writing_duration_seconds
    ) VALUES (
        :submission_id,
        :confidence_score,
        :difficulty_self_report,
        :first_view_duration_seconds,
        :writing_duration_seconds
    )
""")

QUERY_INSERT_SUBMISSION_ALIGNMENT_MENTION = text("""
    INSERT INTO submission_alignment_mentions (
        submission_id,
        mention_type,
        mention,
        mention_order
    ) VALUES (
        :submission_id,
        :mention_type,
        :mention,
        :mention_order
    )
    ON CONFLICT (submission_id, mention_type, mention) DO NOTHING
""")

QUERY_UPDATE_PARTICIPANT_METADATA = text("""
    UPDATE participants
    SET extra_metadata = :meta, updated_at = CURRENT_TIMESTAMP
    WHERE id = :pid
""")

QUERY_UPDATE_PARTICIPANT_STAGE = text("""
    UPDATE participants
    SET stage = :stage,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = :pid
""")

QUERY_END_PARTICIPANT_SESSION = text("""
    UPDATE participant_sessions
    SET
        ended_at = CURRENT_TIMESTAMP,
        last_seen_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = :session_row_id
      AND participant_id = :pid
      AND ended_at IS NULL
""")

QUERY_INSERT_ATTENTION_EVENT = text("""
    INSERT INTO attention_events (
        participant_id,
        submission_id,
        image_id,
        expected_terms,
        matched_terms,
        failure_reasons,
        is_strict,
        attention_passed,
        response_seconds,
        distinct_word_count,
        content_fingerprint
    ) VALUES (
        :pid, :sid, :img_id, :expected, :matched, :reasons,
        :strict, :passed, :resp_secs, :distinct_wc, :fingerprint
    )
""")

QUERY_UPDATE_PARTICIPANT_ATTENTION_FLAG = text("""
    UPDATE participant_attention_stats
    SET is_flagged = CASE
            WHEN :hard_flag OR :soft_flag THEN true
            ELSE is_flagged
        END,
        last_checked_at = CURRENT_TIMESTAMP
    WHERE participant_id = :pid
""")

QUERY_RELEASE_IMAGE_RESERVATION = text("""
    UPDATE image_reservations
    SET
        released_at = CURRENT_TIMESTAMP,
        expires_at = CURRENT_TIMESTAMP
    WHERE image_public_id = :img
      AND participant_id = :pid
      AND released_at IS NULL
""")

QUERY_RELEASE_ALL_PARTICIPANT_RESERVATIONS = text("""
    UPDATE image_reservations
    SET
        released_at = CURRENT_TIMESTAMP,
        expires_at = CURRENT_TIMESTAMP
    WHERE participant_id = :pid
      AND released_at IS NULL
""")

QUERY_FETCH_PARTICIPANT_ATTENTION_STATS = text("""
    SELECT
        total_checks,
        passed_checks,
        failed_checks,
        attention_score,
        is_flagged,
        last_checked_at
    FROM participant_attention_stats
    WHERE participant_id = :pid
""")


def fetch_submission_participant(db, public_id: str):
    return db.execute(QUERY_FETCH_SUBMISSION_PARTICIPANT, {"pub": public_id}).fetchone()


def fetch_submission_image_target(db, image_id: str):
    return db.execute(QUERY_FETCH_IMAGE_TARGET, {"iid": image_id}).fetchone()


def lock_submission_participant(db, participant_id: int):
    db.execute(QUERY_LOCK_PARTICIPANT, {"pid": int(participant_id)})


def fetch_next_survey_index(db, participant_id: int) -> int:
    value = db.execute(QUERY_NEXT_SURVEY_INDEX, {"pid": int(participant_id)}).scalar()
    return int(value or 1)


def has_duplicate_non_survey_submission(db, *, participant_id: int, image_id_fk: int) -> bool:
    return bool(db.execute(QUERY_DUPLICATE_NON_SURVEY_SUBMISSION, {"pid": int(participant_id), "iid": int(image_id_fk)}).scalar())


def fetch_attention_check(db, image_id_fk: int):
    return db.execute(QUERY_FETCH_ATTENTION_CHECK, {"iid": int(image_id_fk)}).fetchone()


def has_copied_attention_pattern(db, *, image_id_fk: int, description_fingerprint: str, participant_id: int) -> bool:
    return bool(db.execute(QUERY_HAS_COPIED_ATTENTION_PATTERN, {
        "img_id": int(image_id_fk),
        "fp": str(description_fingerprint),
        "pid": int(participant_id),
    }).scalar())


def ensure_participant_session(db, *, participant_id: int, session_id: str | None):
    safe_session_id = str(session_id or "").strip()
    if not safe_session_id:
        return None
    value = db.execute(QUERY_UPSERT_PARTICIPANT_SESSION, {
        "pid": int(participant_id),
        "sid": safe_session_id[:128],
    }).scalar()
    return int(value) if value is not None else None


def fetch_participant_attention_stats(db, *, participant_id: int):
    return db.execute(QUERY_FETCH_PARTICIPANT_ATTENTION_STATS, {"pid": int(participant_id)}).fetchone()


def update_participant_stage(db, *, participant_id: int, stage: str) -> None:
    db.execute(QUERY_UPDATE_PARTICIPANT_STAGE, {
        "pid": int(participant_id),
        "stage": str(stage),
    })


def end_participant_session(db, *, participant_id: int, participant_session_id) -> None:
    if participant_session_id is None:
        return
    db.execute(QUERY_END_PARTICIPANT_SESSION, {
        "session_row_id": int(participant_session_id),
        "pid": int(participant_id),
    })


def insert_submission_record(db, *, participant_id: int, participant_session_id, image_id_fk: int, survey_index, description: str, word_count: int, rating: int, feedback: str, time_spent_seconds, is_survey: bool, is_attention: bool, attention_passed, too_fast: bool, quality: float, alignment_score, ip_hash: str, user_agent: str, device_type: str, submission_meta: dict, tab_switch_count: int, page_close_attempts: int, network_disconnects: int, survey_metrics: dict, phase_metrics: dict, behavior_metrics: dict):
    row = db.execute(QUERY_INSERT_SUBMISSION, {
        "pid": int(participant_id),
        "psid": int(participant_session_id) if participant_session_id is not None else None,
        "iid": int(image_id_fk),
        "sidx": survey_index,
        "desc": description,
        "wc": int(word_count),
        "rt": int(rating),
        "fb": feedback,
        "ts": time_spent_seconds,
        "isv": bool(is_survey),
        "isa": bool(is_attention),
        "ap": attention_passed,
        "tf": bool(too_fast),
        "qs": float(quality),
        "als": float(alignment_score) if alignment_score is not None else None,
        "iph": ip_hash,
        "ua": user_agent,
        "dt": str(device_type or "unknown")[:20],
        "meta": json.dumps(submission_meta),
        "tsc": int(tab_switch_count),
        "pca": int(page_close_attempts),
        "nd": int(network_disconnects),
        "survey_time_spent_seconds": float(survey_metrics["survey_time_spent_seconds"]),
        "survey_page_views": int(survey_metrics["survey_page_views"]),
        "survey_tab_switches": int(survey_metrics["survey_tab_switches"]),
        "survey_page_close_attempts": int(survey_metrics["survey_page_close_attempts"]),
        "survey_network_disconnects": int(survey_metrics["survey_network_disconnects"]),
        "survey_max_scroll_depth_pct": int(survey_metrics["survey_max_scroll_depth_pct"]),
        "survey_clicks": int(survey_metrics["survey_clicks"]),
        "survey_keypresses": int(survey_metrics["survey_keypresses"]),
    })
    submission_id = int(row.scalar())

    db.execute(QUERY_INSERT_SUBMISSION_BEHAVIOR_METRICS, {
        "submission_id": submission_id,
        "time_before_typing_seconds": float(behavior_metrics.get("time_before_typing_seconds", 0)),
        "edit_count": int(behavior_metrics.get("edit_count", 0)),
        "backspace_count": int(behavior_metrics.get("backspace_count", 0)),
        "avg_keystroke_interval_seconds": behavior_metrics.get("avg_keystroke_interval_seconds"),
        "keystroke_variance": behavior_metrics.get("keystroke_variance"),
        "pause_count": int(behavior_metrics.get("pause_count", 0)),
        "avg_pause_duration_seconds": behavior_metrics.get("avg_pause_duration_seconds"),
    })

    db.execute(QUERY_INSERT_SUBMISSION_COGNITIVE_METRICS, {
        "submission_id": submission_id,
        "confidence_score": phase_metrics.get("confidence_score"),
        "difficulty_self_report": phase_metrics.get("difficulty_self_report"),
        "first_view_duration_seconds": float(phase_metrics.get("first_view_duration_seconds", 0)),
        "writing_duration_seconds": float(phase_metrics.get("writing_duration_seconds", 0)),
    })

    for index, mention in enumerate(phase_metrics.get("object_mentions", [])):
        db.execute(QUERY_INSERT_SUBMISSION_ALIGNMENT_MENTION, {
            "submission_id": submission_id,
            "mention_type": "object",
            "mention": mention,
            "mention_order": index,
        })
    for index, mention in enumerate(phase_metrics.get("spatial_mentions", [])):
        db.execute(QUERY_INSERT_SUBMISSION_ALIGNMENT_MENTION, {
            "submission_id": submission_id,
            "mention_type": "spatial",
            "mention": mention,
            "mention_order": index,
        })

    return submission_id


def update_participant_metadata(db, *, participant_id: int, participant_meta: dict):
    db.execute(QUERY_UPDATE_PARTICIPANT_METADATA, {
        "pid": int(participant_id),
        "meta": json.dumps(participant_meta),
    })


def insert_attention_event_record(db, *, participant_id: int, submission_id: int, image_id_fk: int, attention_expected_terms, attention_matched_terms, attention_failure_reasons, strict: bool, attention_passed: bool, response_seconds, distinct_word_count: int, description_fingerprint: str):
    db.execute(QUERY_INSERT_ATTENTION_EVENT, {
        "pid": int(participant_id),
        "sid": int(submission_id),
        "img_id": int(image_id_fk),
        "expected": attention_expected_terms,
        "matched": attention_matched_terms,
        "reasons": attention_failure_reasons,
        "strict": bool(strict),
        "passed": bool(attention_passed),
        "resp_secs": response_seconds,
        "distinct_wc": int(distinct_word_count),
        "fingerprint": description_fingerprint,
    })


def update_participant_attention_flag(db, *, participant_id: int, hard_flag_triggered: bool, soft_flag_triggered: bool):
    db.execute(QUERY_UPDATE_PARTICIPANT_ATTENTION_FLAG, {
        "pid": int(participant_id),
        "hard_flag": bool(hard_flag_triggered),
        "soft_flag": bool(soft_flag_triggered),
    })


def release_image_reservation(db, *, image_id: str, participant_id: int):
    db.execute(QUERY_RELEASE_IMAGE_RESERVATION, {"img": str(image_id), "pid": int(participant_id)})


def release_all_participant_reservations(db, *, participant_id: int):
    db.execute(QUERY_RELEASE_ALL_PARTICIPANT_RESERVATIONS, {"pid": int(participant_id)})
