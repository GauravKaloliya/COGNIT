"""Shared SQL helpers for submission flows."""

from __future__ import annotations

import json

from sqlalchemy import text

from app.constants.submission_constants import PAYMENT_STATUS_SUCCESS

QUERY_FETCH_SUBMISSION_PARTICIPANT = text("""
    SELECT
        p.id,
        p.consent_given,
        p.is_deleted,
        p.extra_metadata,
        p.payment_status,
        p.current_stage,
        COALESCE(pas.is_flagged, false) AS is_flagged
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
      AND is_survey = true
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
        participant_id, image_id, survey_index, description, word_count,
        rating, feedback, time_spent_seconds, is_survey, is_attention_check,
        attention_passed, flagged_too_fast, quality_score,
        ip_hash, user_agent, extra_metadata,
        tab_switch_count, page_close_attempts, network_disconnects,
        survey_time_spent_ms, survey_page_views, survey_tab_switches,
        survey_page_close_attempts, survey_network_disconnects,
        survey_max_scroll_depth_pct, survey_clicks, survey_keypresses
    ) VALUES (
        :pid, :iid, :sidx, :desc, :wc, :rt, :fb, :ts, :isv, :isa,
        :ap, :tf, :qs, :iph, :ua, :meta,
        :tsc, :pca, :nd,
        :survey_time_spent_ms, :survey_page_views, :survey_tab_switches,
        :survey_page_close_attempts, :survey_network_disconnects,
        :survey_max_scroll_depth_pct, :survey_clicks, :survey_keypresses
    ) RETURNING id
""")

QUERY_UPDATE_PARTICIPANT_METADATA = text("""
    UPDATE participants
    SET extra_metadata = :meta, updated_at = CURRENT_TIMESTAMP
    WHERE id = :pid
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

QUERY_UPSERT_PARTICIPANT_ACTIVITY_STATS = text("""
    INSERT INTO participant_activity_stats (
        participant_id, total_words, total_submissions, survey_rounds
    ) VALUES (:pid, :w, 1, :sr)
    ON CONFLICT (participant_id) DO UPDATE SET
        total_words       = participant_activity_stats.total_words + :w,
        total_submissions = participant_activity_stats.total_submissions + 1,
        survey_rounds     = participant_activity_stats.survey_rounds + :sr,
        priority_eligible = (
            (participant_activity_stats.total_words + :w) >= :wth OR
            (participant_activity_stats.survey_rounds + :sr) >= :rth
        ) AND COALESCE(
            (SELECT attention_score FROM participant_attention_stats WHERE participant_id = :pid),
            1.0
        ) >= :ath
""")

QUERY_FETCH_LATEST_SUCCESS_PAYMENT_ID = text("""
    SELECT id
    FROM payments
    WHERE participant_id = :pid
      AND status = :status
    ORDER BY COALESCE(verified_at, created_at) DESC, id DESC
    LIMIT 1
""")

QUERY_LINK_PAYMENT_SUBMISSION = text("""
    INSERT INTO payment_submissions (payment_id, submission_id)
    VALUES (:payment_id, :submission_id)
    ON CONFLICT DO NOTHING
""")

QUERY_RELEASE_IMAGE_RESERVATION = text("""
    UPDATE image_reservations
    SET released_at = CURRENT_TIMESTAMP
    WHERE image_id = :img
      AND participant_id = :pid
      AND released_at IS NULL
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


def insert_submission_record(db, *, participant_id: int, image_id_fk: int, survey_index, description: str, word_count: int, rating: int, feedback: str, time_spent_seconds, is_survey: bool, is_attention: bool, attention_passed, too_fast: bool, quality: float, ip_hash: str, user_agent: str, submission_meta: dict, tab_switch_count: int, page_close_attempts: int, network_disconnects: int, survey_metrics: dict):
    row = db.execute(QUERY_INSERT_SUBMISSION, {
        "pid": int(participant_id),
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
        "iph": ip_hash,
        "ua": user_agent,
        "meta": json.dumps(submission_meta),
        "tsc": int(tab_switch_count),
        "pca": int(page_close_attempts),
        "nd": int(network_disconnects),
        "survey_time_spent_ms": int(survey_metrics["survey_time_spent_ms"]),
        "survey_page_views": int(survey_metrics["survey_page_views"]),
        "survey_tab_switches": int(survey_metrics["survey_tab_switches"]),
        "survey_page_close_attempts": int(survey_metrics["survey_page_close_attempts"]),
        "survey_network_disconnects": int(survey_metrics["survey_network_disconnects"]),
        "survey_max_scroll_depth_pct": int(survey_metrics["survey_max_scroll_depth_pct"]),
        "survey_clicks": int(survey_metrics["survey_clicks"]),
        "survey_keypresses": int(survey_metrics["survey_keypresses"]),
    })
    return row.scalar()


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


def upsert_participant_activity_stats(db, *, participant_id: int, word_count: int, survey_round_increment: int, priority_word_threshold: int, priority_rounds_threshold: int, priority_attention_threshold: float):
    db.execute(QUERY_UPSERT_PARTICIPANT_ACTIVITY_STATS, {
        "pid": int(participant_id),
        "w": int(word_count),
        "sr": int(survey_round_increment),
        "wth": int(priority_word_threshold),
        "rth": int(priority_rounds_threshold),
        "ath": float(priority_attention_threshold),
    })


def fetch_latest_success_payment_id(db, participant_id: int):
    return db.execute(QUERY_FETCH_LATEST_SUCCESS_PAYMENT_ID, {"pid": int(participant_id), "status": PAYMENT_STATUS_SUCCESS}).scalar()


def link_payment_submission(db, *, payment_id: int, submission_id: int):
    db.execute(QUERY_LINK_PAYMENT_SUBMISSION, {"payment_id": int(payment_id), "submission_id": int(submission_id)})


def release_image_reservation(db, *, image_id: str, participant_id: int):
    db.execute(QUERY_RELEASE_IMAGE_RESERVATION, {"img": str(image_id), "pid": int(participant_id)})
