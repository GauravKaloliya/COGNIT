import json
import os
import sys
from collections import defaultdict
from pathlib import Path

from dotenv import dotenv_values
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

ROOT = Path('/Users/kaps/Downloads/COGNIT-1')
BACKEND = ROOT / 'backend'
sys.path.insert(0, str(BACKEND))

if 'DATABASE_URL' not in os.environ:
    env_values = dotenv_values(BACKEND / '.env')
    database_url = env_values.get('DATABASE_URL') or env_values.get('POSTGRES_URL') or env_values.get('NEON_DATABASE_URL')
    if database_url:
        os.environ['DATABASE_URL'] = database_url
    else:
        raise RuntimeError('DATABASE_URL is not set and was not found in backend/.env')

from app.config import (
    ATTENTION_FLAG_MIN_CHECKS,
    ATTENTION_FLAG_THRESHOLD,
    ATTENTION_HARD_FLAG_CONSEC_FAILS,
    ATTENTION_MIN_CHAR_LENGTH,
    ATTENTION_MIN_DISTINCT_WORDS,
    ATTENTION_MIN_RECALL,
    TOO_FAST_ATTENTION_BASE_SECONDS,
    TOO_FAST_ATTENTION_MAX_THRESHOLD_SECONDS,
    TOO_FAST_SURVEY_BASE_SECONDS,
    TOO_FAST_SURVEY_MAX_THRESHOLD_SECONDS,
)
from app.constants.submission_constants import (
    PARTICIPANT_META_KEY_ENFORCEMENT_MONITOR,
    PARTICIPANT_META_KEY_ATTENTION_MONITOR,
    PARTICIPANT_META_KEY_LAST_ENFORCEMENT_AT,
    PARTICIPANT_META_KEY_LAST_SUBMISSION_REVIEW,
    PARTICIPANT_META_KEY_PARTICIPANT_ENFORCEMENT_STATUS,
    SUBMISSION_META_KEY_ATTENTION,
)
from app.services.submission_processing_service import (
    apply_attention_monitor,
    apply_submission_enforcement,
    evaluate_attention_result,
    finalize_attention_assessment,
)
from app.services.submission_query_service import has_copied_attention_pattern
from app.services.submission_service import (
    alphabetic_tokens,
    build_attention_core_terms,
    compute_alignment,
    count_attention_descriptive_tokens,
    detect_repetitive_attention_template,
    dynamic_too_fast_threshold,
    get_ground_truth_objects,
    match_attention_terms,
    normalize_for_attention,
    normalize_objects,
    summarize_alignment_mentions,
)
from app.services.submission_workflow_service import calculate_quality

DB_URL = os.environ['DATABASE_URL']
engine = create_engine(DB_URL, pool_pre_ping=True)
Session = sessionmaker(bind=engine)
read_db = Session()

SUBMISSIONS_SQL = text("""
SELECT
    s.id,
    s.participant_id,
    s.image_id,
    s.description,
    s.word_count,
    s.feedback,
    s.time_spent_seconds,
    s.is_attention_check,
    s.tab_switch_count,
    s.page_close_attempts,
    s.network_disconnects,
    s.hard_flag_triggered AS stored_hard_flag_triggered,
    s.soft_flag_triggered AS stored_soft_flag_triggered,
    s.watchlist_triggered AS stored_watchlist_triggered,
    s.enforcement_status AS stored_enforcement_status,
    s.soft_review_recommended AS stored_soft_review_recommended,
    s.extra_metadata,
    s.created_at,
    sbm.time_before_typing_seconds,
    sbm.edit_count,
    sbm.backspace_count,
    sbm.avg_keystroke_interval_seconds,
    sbm.keystroke_variance,
    sbm.pause_count,
    sbm.avg_pause_duration_seconds,
    sbm.revision_bursts,
    sbm.hesitation_score,
    sbm.submitted_without_typing_pause,
    ae.expected_terms AS event_expected_terms
FROM submissions s
LEFT JOIN submission_behavior_metrics sbm ON sbm.submission_id = s.id
LEFT JOIN attention_events ae ON ae.submission_id = s.id
ORDER BY s.created_at ASC, s.id ASC
""")

ATTN_SQL = text("SELECT expected_word, is_strict FROM attention_checks WHERE image_id = :iid AND is_active = true")
PARTICIPANTS_SQL = text("SELECT id, extra_metadata FROM participants")

print('loading live records...', flush=True)
submissions = read_db.execute(SUBMISSIONS_SQL).mappings().all()
participant_meta = {
    int(row.id): {
        key: value
        for key, value in (row.extra_metadata.items() if isinstance(row.extra_metadata, dict) else {})
        if key not in {
            PARTICIPANT_META_KEY_ATTENTION_MONITOR,
            PARTICIPANT_META_KEY_ENFORCEMENT_MONITOR,
            PARTICIPANT_META_KEY_LAST_ENFORCEMENT_AT,
            PARTICIPANT_META_KEY_LAST_SUBMISSION_REVIEW,
            PARTICIPANT_META_KEY_PARTICIPANT_ENFORCEMENT_STATUS,
        }
    }
    for row in read_db.execute(PARTICIPANTS_SQL).mappings()
}
print(f'loaded {len(submissions)} submissions', flush=True)

gt_cache = {}
attn_cache = {}
results = {}
attention_by_participant = defaultdict(list)

for idx, row in enumerate(submissions, start=1):
    submission_id = int(row['id'])
    participant_id = int(row['participant_id'])
    image_id_fk = int(row['image_id'])
    description = str(row['description'] or '"''"')
    feedback = str(row['feedback'] or '"''"')
    is_attention = bool(row['is_attention_check'])
    word_count = int(row['word_count'] or 0)
    time_spent_seconds = float(row['time_spent_seconds'] or 0.0)

    behavior_metrics = {
        'time_before_typing_seconds': float(row['time_before_typing_seconds'] or 0.0),
        'edit_count': int(row['edit_count'] or 0),
        'backspace_count': int(row['backspace_count'] or 0),
        'avg_keystroke_interval_seconds': float(row['avg_keystroke_interval_seconds']) if row['avg_keystroke_interval_seconds'] is not None else None,
        'keystroke_variance': float(row['keystroke_variance']) if row['keystroke_variance'] is not None else None,
        'pause_count': int(row['pause_count'] or 0),
        'avg_pause_duration_seconds': float(row['avg_pause_duration_seconds']) if row['avg_pause_duration_seconds'] is not None else None,
        'revision_bursts': int(row['revision_bursts'] or 0),
        'hesitation_score': float(row['hesitation_score'] or 0.0),
        'submitted_without_typing_pause': bool(row['submitted_without_typing_pause']) if row['submitted_without_typing_pause'] is not None else False,
    }

    dynamic_threshold = dynamic_too_fast_threshold(
        word_count,
        is_attention=is_attention,
        description=description,
        behavior_metrics=behavior_metrics,
        attention_base_threshold=TOO_FAST_ATTENTION_BASE_SECONDS,
        survey_base_threshold=TOO_FAST_SURVEY_BASE_SECONDS,
        attention_max_threshold=TOO_FAST_ATTENTION_MAX_THRESHOLD_SECONDS,
        survey_max_threshold=TOO_FAST_SURVEY_MAX_THRESHOLD_SECONDS,
    )
    too_fast = time_spent_seconds < dynamic_threshold if row['time_spent_seconds'] is not None else False
    distinct_word_count = len(set(alphabetic_tokens(description)))

    gt_objects = gt_cache.get(image_id_fk)
    if gt_objects is None:
        gt_objects = get_ground_truth_objects(read_db, image_id_fk)
        gt_cache[image_id_fk] = gt_objects

    ac_row = attn_cache.get(image_id_fk)
    if ac_row is None:
        ac_row = read_db.execute(ATTN_SQL, {'iid': image_id_fk}).fetchone()
        attn_cache[image_id_fk] = ac_row
    if ac_row is None and is_attention:
        fallback_terms = row['event_expected_terms'] or []
        if isinstance(fallback_terms, str):
            fallback_terms = [fallback_terms]
        expected_word = ' | '.join(str(term) for term in fallback_terms if str(term).strip())
        ac_row = (expected_word, False)

    attention_result = evaluate_attention_result(
        db=read_db,
        is_attention=is_attention,
        attention_check_row=ac_row,
        ground_truth_objects=gt_objects,
        description=description,
        count_attention_descriptive_tokens=count_attention_descriptive_tokens,
        detect_repetitive_attention_template=detect_repetitive_attention_template,
        normalize_for_attention=normalize_for_attention,
        build_attention_core_terms=build_attention_core_terms,
        match_attention_terms=match_attention_terms,
        has_copied_attention_pattern=has_copied_attention_pattern,
        image_id_fk=image_id_fk,
        participant_id=participant_id,
        distinct_word_count=distinct_word_count,
        attention_min_char_length=ATTENTION_MIN_CHAR_LENGTH,
        attention_min_distinct_words=ATTENTION_MIN_DISTINCT_WORDS,
        attention_min_recall=ATTENTION_MIN_RECALL,
        too_fast=bool(is_attention and too_fast),
    )

    attention_expected_terms = attention_result['attention_expected_terms']
    attention_matched_terms = attention_result['attention_matched_terms']
    hard_fail_reasons = attention_result['hard_fail_reasons']
    soft_risk_reasons = attention_result['soft_risk_reasons']
    copied_pattern_detected = bool(attention_result['copied_pattern_detected'])
    descriptive_token_count = int(attention_result['descriptive_token_count'] or 0)
    expected_term_recall = float(attention_result['expected_term_recall'] or 0.0)
    expected_term_count = int(attention_result['expected_term_count'] or 0)
    matched_term_count = int(attention_result['matched_term_count'] or 0)
    attention_distinct_word_count = int(attention_result['distinct_word_count'] or distinct_word_count)
    attention_repetition_metrics = attention_result.get('repetition_metrics') or {}
    submission_meta = dict(attention_result['submission_meta'] or {})
    attention_recall_weak = bool(attention_result['attention_recall_weak'])
    attention_keyword_missing = bool(attention_result['attention_keyword_missing'])

    normalized_gt_objects = normalize_objects(gt_objects)
    alignment_reference_objects = normalize_objects(attention_expected_terms) if is_attention and attention_expected_terms else normalized_gt_objects
    refined_mentions = summarize_alignment_mentions(description, reference_objects=alignment_reference_objects)
    normalized_user_objects = normalize_objects(refined_mentions['object_mentions'])
    alignment = compute_alignment(normalized_user_objects, alignment_reference_objects, description)
    alignment_score = alignment['f1'] if alignment else None
    alignment_recall = float(alignment['recall']) if alignment else 0.0

    if alignment:
        submission_meta = dict(submission_meta)
        submission_meta['alignment'] = {
            'style_metrics': alignment['alignment_style_metrics'],
            'relation_hits': alignment['relation_hits'],
            'correct': alignment['correct'],
            'wrong': alignment['wrong'],
            'missed': alignment['missed'],
        }

    finalized_attention = finalize_attention_assessment(
        is_attention=is_attention,
        attention_expected_terms=attention_expected_terms,
        attention_matched_terms=attention_matched_terms,
        hard_fail_reasons=hard_fail_reasons,
        soft_risk_reasons=soft_risk_reasons,
        attention_recall_weak=attention_recall_weak,
        attention_keyword_missing=attention_keyword_missing,
        copied_pattern_detected=copied_pattern_detected,
        repetitive_template_detected=bool(attention_result.get('repetitive_template_detected')),
        descriptive_token_count=descriptive_token_count,
        distinct_word_count=distinct_word_count,
        alignment_recall=alignment_recall,
        alignment_score=alignment_score,
        expected_term_recall=expected_term_recall,
    )

    attention_passed = finalized_attention['attention_passed']
    attention_suspicious = finalized_attention['attention_suspicious']
    attention_tier = finalized_attention['attention_tier']
    attention_confidence = finalized_attention['attention_confidence']
    hard_fail_reasons = finalized_attention['hard_fail_reasons']
    soft_risk_reasons = finalized_attention['soft_risk_reasons']
    attention_failure_reasons = finalized_attention['failure_reasons']
    supporting_signals = finalized_attention['supporting_signals']

    submission_meta = dict(submission_meta)
    if is_attention:
        attention_meta = dict(submission_meta.get(SUBMISSION_META_KEY_ATTENTION, {}))
        attention_meta.update({
            'core_term_count': len(attention_expected_terms),
            'distinct_word_count': attention_distinct_word_count,
            'keyword_missing': attention_keyword_missing,
            'recall_weak': attention_recall_weak,
            'alignment_weak': alignment_recall < float(ATTENTION_MIN_RECALL),
            'repetitive_template_detected': bool(attention_result.get('repetitive_template_detected')),
            'suspicious': attention_suspicious,
        })
        submission_meta[SUBMISSION_META_KEY_ATTENTION] = attention_meta

    scorecard = calculate_quality(
        word_count=word_count,
        attention_passed=attention_passed,
        attention_suspicious=attention_suspicious,
        attention_tier=attention_tier,
        attention_confidence=attention_confidence,
        time_spent_seconds=time_spent_seconds,
        feedback=feedback,
        distinct_word_count=distinct_word_count,
        tab_switch_count=int(row['tab_switch_count'] or 0),
        page_close_attempts=int(row['page_close_attempts'] or 0),
        network_disconnects=int(row['network_disconnects'] or 0),
        dynamic_too_fast_threshold=dynamic_threshold,
        alignment_score=alignment_score,
        alignment=alignment,
        too_fast=too_fast,
        copied_pattern_detected=copied_pattern_detected,
        behavior_metrics=behavior_metrics,
        description=description,
        device_type='unknown',
        user_agent='',
    )
    writing_quality_score = scorecard['writing_quality_score']
    behavior_risk_score = scorecard['behavior_risk_score']
    quality = scorecard['quality_score']
    too_fast = bool(scorecard['flagged_too_fast'])

    result = {
        'submission_id': submission_id,
        'participant_id': participant_id,
        'is_attention': is_attention,
        'attention_passed': attention_passed if is_attention else None,
        'attention_tier': attention_tier if is_attention else None,
        'attention_confidence': float(attention_confidence) if is_attention and attention_confidence is not None else None,
        'expected_term_recall': float(expected_term_recall) if is_attention else None,
        'matched_term_count': int(matched_term_count) if is_attention else None,
        'expected_term_count': int(expected_term_count) if is_attention else None,
        'descriptive_token_count': int(descriptive_token_count) if is_attention else None,
        'distinct_word_count': int(distinct_word_count),
        'flagged_too_fast': bool(too_fast),
        'too_fast_score': float(scorecard['too_fast_score']),
        'too_fast_threshold_seconds': float(scorecard['too_fast_threshold_seconds']),
        'too_fast_margin_seconds': float(scorecard['too_fast_margin_seconds']),
        'quality_score': float(quality),
        'writing_quality_score': float(writing_quality_score),
        'behavior_risk_score': float(behavior_risk_score),
        'copy_paste_likelihood_score': float(scorecard['copy_paste_likelihood_score']),
        'typing_effort_risk': float(scorecard['typing_effort_risk']),
        'speed_risk': float(scorecard['speed_risk']),
        'session_integrity_risk': float(scorecard['session_integrity_risk']),
        'suspicious_long_answer_floor': float(scorecard.get('suspicious_long_answer_floor', 0.0)),
        'contradiction_signals': list(scorecard.get('contradiction_signals', [])),
        'alignment_score': float(alignment_score) if alignment_score is not None else None,
        'alignment_precision': alignment.get('precision') if alignment else None,
        'alignment_recall': alignment.get('recall') if alignment else None,
        'alignment_object_f1': alignment.get('object_f1') if alignment else None,
        'alignment_relation_score': alignment.get('relation_score') if alignment else None,
        'alignment_scene_consistency_score': alignment.get('scene_consistency_score') if alignment else None,
        'alignment_wrong_object_penalty': alignment.get('wrong_object_penalty') if alignment else None,
        'alignment_natural_language_score': alignment.get('natural_language_score') if alignment else None,
        'alignment_stuffing_penalty': alignment.get('stuffing_penalty') if alignment else None,
        'supporting_signals': supporting_signals or {},
        'extra_metadata': submission_meta or {},
        'attention_expected_terms': list(attention_expected_terms or []),
        'attention_matched_terms': list(attention_matched_terms or []),
        'attention_failure_reasons': list(attention_failure_reasons or []),
        'hard_fail_reasons': list(hard_fail_reasons or []),
        'soft_risk_reasons': list(soft_risk_reasons or []),
        'repetition_metrics': attention_repetition_metrics,
        'response_seconds': time_spent_seconds,
        'content_fingerprint': attention_result['description_fingerprint'],
        'created_at': row['created_at'],
        'copied_pattern_detected': copied_pattern_detected,
        'consecutive_failures': 0,
        'hard_flag_triggered': False,
        'soft_flag_triggered': False,
        'watchlist_triggered': False,
        'soft_review_recommended': False,
        'enforcement_status': 'normal',
        'stored_hard_flag_triggered': bool(row['stored_hard_flag_triggered']),
        'stored_soft_flag_triggered': bool(row['stored_soft_flag_triggered']),
        'stored_watchlist_triggered': bool(row['stored_watchlist_triggered']),
        'stored_enforcement_status': str(row['stored_enforcement_status'] or 'normal'),
        'stored_soft_review_recommended': bool(row['stored_soft_review_recommended']),
    }
    results[submission_id] = result
    attention_by_participant[participant_id].append(result)

    if idx % 50 == 0:
        print(f'computed {idx}/{len(submissions)} submissions', flush=True)

participant_stats = {}
for participant_id, items in attention_by_participant.items():
    items.sort(key=lambda item: (item['created_at'], item['submission_id']))
    meta = dict(participant_meta.get(participant_id, {}))
    final_recent_score = None
    final_consecutive_failures = 0
    final_attention_totals = {'total_checks': 0, 'passed_checks': 0, 'failed_checks': 0}
    for item in items:
        attention_monitor_result = apply_attention_monitor(
            participant_meta=meta,
            attention_passed=item['attention_passed'],
            attention_tier=item['attention_tier'],
            attention_confidence=item['attention_confidence'],
            hard_fail_reasons=item['hard_fail_reasons'],
            soft_risk_reasons=item['soft_risk_reasons'],
            is_attention=bool(item['is_attention']),
            checked_at=item['created_at'],
            hard_flag_consecutive_fails=ATTENTION_HARD_FLAG_CONSEC_FAILS,
            attention_flag_min_checks=ATTENTION_FLAG_MIN_CHECKS,
            attention_flag_threshold=ATTENTION_FLAG_THRESHOLD,
        )
        policy_result = apply_submission_enforcement(
            participant_meta=attention_monitor_result['participant_meta'],
            is_attention=bool(item['is_attention']),
            attention_tier=item['attention_tier'],
            hard_fail_reasons=item['hard_fail_reasons'],
            soft_risk_reasons=item['soft_risk_reasons'],
            quality_score=item['quality_score'],
            behavior_risk_score=item['behavior_risk_score'],
            copy_paste_likelihood_score=item['copy_paste_likelihood_score'],
            too_fast_score=item['too_fast_score'],
            typing_effort_risk=item['typing_effort_risk'],
            contradiction_signals=item.get('contradiction_signals', []),
            copied_pattern_detected=bool(item.get('copied_pattern_detected')),
            scorecard={
                'suspicious_long_answer_floor': item.get('suspicious_long_answer_floor', 0.0),
            },
            checked_at=item['created_at'],
        )
        meta = policy_result['participant_meta']
        if item['is_attention']:
            item['consecutive_failures'] = int(attention_monitor_result['consecutive_failures'] or 0)
            final_consecutive_failures = item['consecutive_failures']
        item['hard_flag_triggered'] = bool(policy_result['hard_flag_triggered'])
        item['soft_flag_triggered'] = bool(policy_result['soft_flag_triggered'])
        item['watchlist_triggered'] = bool(policy_result['watchlist_triggered'])
        item['soft_review_recommended'] = bool(policy_result['soft_review_recommended'])
        item['enforcement_status'] = str(policy_result['enforcement_status'])
        item['extra_metadata'] = dict(item['extra_metadata'] or {})
        item['extra_metadata']['enforcement'] = {
            'soft_review_recommended': bool(policy_result['soft_review_recommended']),
            'combined_suspicion': bool(policy_result['combined_suspicion']),
            'enforcement_status': str(policy_result['enforcement_status']),
            'watchlist_triggered': bool(policy_result['watchlist_triggered']),
            'contradiction_signals': list(item.get('contradiction_signals', [])),
        }
        if attention_monitor_result['recent_attention_score'] is not None:
            final_recent_score = attention_monitor_result['recent_attention_score']
        if item['is_attention']:
            final_attention_totals['total_checks'] += 1
            if item['attention_passed'] is True:
                final_attention_totals['passed_checks'] += 1
            elif item['attention_passed'] is False:
                final_attention_totals['failed_checks'] += 1
    participant_meta[participant_id] = meta
    total_checks = final_attention_totals['total_checks']
    passed_checks = final_attention_totals['passed_checks']
    failed_checks = final_attention_totals['failed_checks']
    last_item = items[-1]
    participant_stats[participant_id] = {
        'total_checks': total_checks,
        'passed_checks': passed_checks,
        'failed_checks': failed_checks,
        'attention_score': float(final_recent_score if final_recent_score is not None else 1.0),
        'recent_attention_score': float(final_recent_score) if final_recent_score is not None else None,
        'consecutive_failures': int(final_consecutive_failures or 0),
        'hard_flag_triggered': bool(last_item['hard_flag_triggered']),
        'soft_flag_triggered': bool(last_item['soft_flag_triggered']),
        'watchlist_triggered': bool(last_item['watchlist_triggered']),
        'enforcement_status': str(last_item['enforcement_status']),
        'is_flagged': bool(last_item['hard_flag_triggered'] or last_item['soft_flag_triggered']),
        'last_checked_at': last_item['created_at'],
    }

read_db.close()
print('computation complete, starting chunked writes...', flush=True)

update_submission_sql = text("""
UPDATE submissions
SET
    attention_passed = :attention_passed,
    flagged_too_fast = :flagged_too_fast,
    too_fast_score = :too_fast_score,
    too_fast_threshold_seconds = :too_fast_threshold_seconds,
    too_fast_margin_seconds = :too_fast_margin_seconds,
    quality_score = :quality_score,
    writing_quality_score = :writing_quality_score,
    behavior_risk_score = :behavior_risk_score,
    copy_paste_likelihood_score = :copy_paste_likelihood_score,
    typing_effort_risk = :typing_effort_risk,
    speed_risk = :speed_risk,
    session_integrity_risk = :session_integrity_risk,
    attention_tier = :attention_tier,
    attention_confidence = :attention_confidence,
    expected_term_recall = :expected_term_recall,
    matched_term_count = :matched_term_count,
    expected_term_count = :expected_term_count,
    distinct_word_count = :distinct_word_count,
    descriptive_token_count = :descriptive_token_count,
    alignment_score = :alignment_score,
    alignment_precision = :alignment_precision,
    alignment_recall = :alignment_recall,
    alignment_object_f1 = :alignment_object_f1,
    alignment_relation_score = :alignment_relation_score,
    alignment_scene_consistency_score = :alignment_scene_consistency_score,
    alignment_wrong_object_penalty = :alignment_wrong_object_penalty,
    alignment_natural_language_score = :alignment_natural_language_score,
    alignment_stuffing_penalty = :alignment_stuffing_penalty,
    supporting_signals = CAST(:supporting_signals AS JSONB),
    extra_metadata = CAST(:extra_metadata AS JSONB),
    consecutive_failures = :consecutive_failures,
    hard_flag_triggered = :hard_flag_triggered,
    soft_flag_triggered = :soft_flag_triggered,
    watchlist_triggered = :watchlist_triggered,
    soft_review_recommended = :soft_review_recommended,
    enforcement_status = :enforcement_status
WHERE id = :submission_id
""")

update_attention_event_sql = text("""
UPDATE attention_events
SET
    expected_terms = :expected_terms,
    matched_terms = :matched_terms,
    failure_reasons = :failure_reasons,
    hard_fail_reasons = :hard_fail_reasons,
    soft_risk_reasons = :soft_risk_reasons,
    repetition_metrics = CAST(:repetition_metrics AS JSONB),
    response_seconds = :response_seconds,
    content_fingerprint = :content_fingerprint
WHERE submission_id = :submission_id
""")

update_participant_meta_sql = text("UPDATE participants SET extra_metadata = CAST(:extra_metadata AS JSONB), updated_at = CURRENT_TIMESTAMP WHERE id = :participant_id")
delete_stats_sql = text('DELETE FROM participant_attention_stats WHERE participant_id = ANY(:ids)')
upsert_stats_sql = text("""
INSERT INTO participant_attention_stats (
    participant_id,
    total_checks,
    passed_checks,
    failed_checks,
    attention_score,
    recent_attention_score,
    consecutive_failures,
    hard_flag_triggered,
    soft_flag_triggered,
    watchlist_triggered,
    enforcement_status,
    is_flagged,
    last_checked_at
) VALUES (
    :participant_id,
    :total_checks,
    :passed_checks,
    :failed_checks,
    :attention_score,
    :recent_attention_score,
    :consecutive_failures,
    :hard_flag_triggered,
    :soft_flag_triggered,
    :watchlist_triggered,
    :enforcement_status,
    :is_flagged,
    :last_checked_at
)
ON CONFLICT (participant_id) DO UPDATE SET
    total_checks = EXCLUDED.total_checks,
    passed_checks = EXCLUDED.passed_checks,
    failed_checks = EXCLUDED.failed_checks,
    attention_score = EXCLUDED.attention_score,
    recent_attention_score = EXCLUDED.recent_attention_score,
    consecutive_failures = EXCLUDED.consecutive_failures,
    hard_flag_triggered = EXCLUDED.hard_flag_triggered,
    soft_flag_triggered = EXCLUDED.soft_flag_triggered,
    watchlist_triggered = EXCLUDED.watchlist_triggered,
    enforcement_status = EXCLUDED.enforcement_status,
    is_flagged = EXCLUDED.is_flagged,
    last_checked_at = EXCLUDED.last_checked_at
""")

summary = {
    'submissions_total': len(results),
    'attention_submissions': sum(1 for r in results.values() if r['is_attention']),
    'too_fast_true': sum(1 for r in results.values() if r['flagged_too_fast']),
    'watchlist_rows': sum(1 for r in results.values() if r['watchlist_triggered']),
    'soft_review_rows': sum(1 for r in results.values() if r['soft_review_recommended']),
    'soft_flag_rows': sum(1 for r in results.values() if r['soft_flag_triggered']),
    'hard_flag_rows': sum(1 for r in results.values() if r['hard_flag_triggered']),
    'watchlist_state_changes': sum(
        1 for r in results.values()
        if bool(r['watchlist_triggered']) != bool(r['stored_watchlist_triggered'])
    ),
    'soft_flag_state_changes': sum(
        1 for r in results.values()
        if bool(r['soft_flag_triggered']) != bool(r['stored_soft_flag_triggered'])
    ),
    'hard_flag_state_changes': sum(
        1 for r in results.values()
        if bool(r['hard_flag_triggered']) != bool(r['stored_hard_flag_triggered'])
    ),
    'soft_review_state_changes': sum(
        1 for r in results.values()
        if bool(r['soft_review_recommended']) != bool(r['stored_soft_review_recommended'])
    ),
    'enforcement_status_changes': sum(
        1 for r in results.values()
        if str(r['enforcement_status']) != str(r['stored_enforcement_status'])
    ),
    'high_risk_high_quality_contradictions': sum(
        1 for r in results.values()
        if float(r['behavior_risk_score']) >= 0.30 and float(r['quality_score']) >= 0.72
    ),
    'participant_stats_rows': len(participant_stats),
    'participant_watchlist_rows': sum(1 for r in participant_stats.values() if r['watchlist_triggered']),
    'participant_soft_flag_rows': sum(1 for r in participant_stats.values() if r['soft_flag_triggered']),
    'participant_hard_flag_rows': sum(1 for r in participant_stats.values() if r['hard_flag_triggered']),
}

def chunked(seq, size):
    for i in range(0, len(seq), size):
        yield seq[i:i + size]

submission_rows = list(results.values())
attention_rows = [row for row in submission_rows if row['is_attention']]
participant_ids = sorted(attention_by_participant.keys())
stat_rows = [dict({'participant_id': pid}, **stats) for pid, stats in participant_stats.items()]

write_db = Session()
try:
    for chunk_index, chunk in enumerate(chunked(submission_rows, 50), start=1):
        write_db.execute(text('BEGIN'))
        for row in chunk:
            write_db.execute(update_submission_sql, {
                'submission_id': row['submission_id'],
                'attention_passed': row['attention_passed'],
                'flagged_too_fast': row['flagged_too_fast'],
                'too_fast_score': row['too_fast_score'],
                'too_fast_threshold_seconds': row['too_fast_threshold_seconds'],
                'too_fast_margin_seconds': row['too_fast_margin_seconds'],
                'quality_score': row['quality_score'],
                'writing_quality_score': row['writing_quality_score'],
                'behavior_risk_score': row['behavior_risk_score'],
                'copy_paste_likelihood_score': row['copy_paste_likelihood_score'],
                'typing_effort_risk': row['typing_effort_risk'],
                'speed_risk': row['speed_risk'],
                'session_integrity_risk': row['session_integrity_risk'],
                'attention_tier': row['attention_tier'],
                'attention_confidence': row['attention_confidence'],
                'expected_term_recall': row['expected_term_recall'],
                'matched_term_count': row['matched_term_count'],
                'expected_term_count': row['expected_term_count'],
                'distinct_word_count': row['distinct_word_count'],
                'descriptive_token_count': row['descriptive_token_count'],
                'alignment_score': row['alignment_score'],
                'alignment_precision': row['alignment_precision'],
                'alignment_recall': row['alignment_recall'],
                'alignment_object_f1': row['alignment_object_f1'],
                'alignment_relation_score': row['alignment_relation_score'],
                'alignment_scene_consistency_score': row['alignment_scene_consistency_score'],
                'alignment_wrong_object_penalty': row['alignment_wrong_object_penalty'],
                'alignment_natural_language_score': row['alignment_natural_language_score'],
                'alignment_stuffing_penalty': row['alignment_stuffing_penalty'],
                'supporting_signals': json.dumps(row['supporting_signals']),
                'extra_metadata': json.dumps(row['extra_metadata']),
                'consecutive_failures': row['consecutive_failures'],
                'hard_flag_triggered': row['hard_flag_triggered'] if row['is_attention'] else False,
                'soft_flag_triggered': row['soft_flag_triggered'] if row['is_attention'] else False,
                'watchlist_triggered': row['watchlist_triggered'],
                'soft_review_recommended': row['soft_review_recommended'],
                'enforcement_status': row['enforcement_status'],
            })
        write_db.commit()
        print(f'committed submissions chunk {chunk_index}', flush=True)

    for chunk_index, chunk in enumerate(chunked(attention_rows, 25), start=1):
        write_db.execute(text('BEGIN'))
        write_db.execute(text('ALTER TABLE attention_events DISABLE TRIGGER trg_attention_events_no_update'))
        for row in chunk:
            write_db.execute(update_attention_event_sql, {
                'submission_id': row['submission_id'],
                'expected_terms': row['attention_expected_terms'],
                'matched_terms': row['attention_matched_terms'],
                'failure_reasons': row['attention_failure_reasons'],
                'hard_fail_reasons': row['hard_fail_reasons'],
                'soft_risk_reasons': row['soft_risk_reasons'],
                'repetition_metrics': json.dumps(row['repetition_metrics']),
                'response_seconds': row['response_seconds'],
                'content_fingerprint': row['content_fingerprint'],
            })
        write_db.execute(text('ALTER TABLE attention_events ENABLE TRIGGER trg_attention_events_no_update'))
        write_db.commit()
        print(f'committed attention_events chunk {chunk_index}', flush=True)

    for chunk_index, chunk in enumerate(chunked(participant_ids, 25), start=1):
        write_db.execute(text('BEGIN'))
        for participant_id in chunk:
            write_db.execute(update_participant_meta_sql, {
                'participant_id': participant_id,
                'extra_metadata': json.dumps(participant_meta[participant_id]),
            })
        write_db.commit()
        print(f'committed participants chunk {chunk_index}', flush=True)

    write_db.execute(text('BEGIN'))
    if participant_ids:
        write_db.execute(delete_stats_sql, {'ids': participant_ids})
    write_db.commit()
    print('cleared participant_attention_stats for touched participants', flush=True)

    for chunk_index, chunk in enumerate(chunked(stat_rows, 25), start=1):
        write_db.execute(text('BEGIN'))
        for row in chunk:
            write_db.execute(upsert_stats_sql, row)
        write_db.commit()
        print(f'committed participant_attention_stats chunk {chunk_index}', flush=True)

    print(json.dumps(summary, indent=2), flush=True)
except Exception:
    try:
        write_db.execute(text('ALTER TABLE attention_events ENABLE TRIGGER trg_attention_events_no_update'))
        write_db.commit()
    except Exception:
        write_db.rollback()
    raise
finally:
    write_db.close()
