WITH base AS (
    SELECT
        s.id,
        s.participant_id,
        s.is_attention_check,
        s.flagged_too_fast AS stored_old_flag,
        COALESCE(s.attention_tier, 'survey') AS attention_tier,
        COALESCE(s.quality_score, 0) AS quality_score,
        COALESCE(s.time_spent_seconds, 0) AS time_spent_seconds,
        COALESCE(s.word_count, 0) AS word_count,
        length(COALESCE(s.description, '')) AS char_count,
        COALESCE(sbm.time_before_typing_seconds, 0) AS time_before_typing_seconds,
        COALESCE(sbm.edit_count, 0) AS edit_count,
        COALESCE(sbm.backspace_count, 0) AS backspace_count,
        COALESCE(sbm.pause_count, 0) AS pause_count,
        COALESCE(sbm.revision_bursts, 0) AS revision_bursts,
        COALESCE(sbm.hesitation_score, 0) AS hesitation_score
    FROM submissions s
    LEFT JOIN submission_behavior_metrics sbm
        ON sbm.submission_id = s.id
    WHERE s.time_spent_seconds IS NOT NULL
      AND s.word_count IS NOT NULL
),
scored AS (
    SELECT
        *,
        GREATEST(30.0, LEAST(220.0, word_count::numeric)) AS normalized_word_scale,
        LEAST(
            1.0,
            LN(1 + ((edit_count / GREATEST(30.0, LEAST(220.0, word_count::numeric))) * 10.0)) / LN(9.0)
        ) AS edit_signal,
        LEAST(
            1.0,
            LN(1 + ((backspace_count / GREATEST(30.0, LEAST(220.0, word_count::numeric))) * 35.0)) / LN(13.0)
        ) AS backspace_signal,
        LEAST(
            1.0,
            LN(1 + ((pause_count / GREATEST(30.0, LEAST(220.0, word_count::numeric))) * 55.0)) / LN(15.0)
        ) AS pause_signal,
        LEAST(
            1.0,
            LN(
                1 + (
                    (revision_bursts / GREATEST(1.0, GREATEST(30.0, LEAST(220.0, word_count::numeric)) / 20.0)) * 4.5
                )
            ) / LN(11.0)
        ) AS revision_signal,
        LEAST(
            1.0,
            time_before_typing_seconds / (5.0 + (GREATEST(30.0, LEAST(220.0, word_count::numeric)) * 0.035))
        ) AS deliberation_signal,
        CASE
            WHEN is_attention_check THEN LEAST(
                90.0,
                GREATEST(
                    10.0,
                    10.0
                    + GREATEST(9.0, LEAST(22.0, char_count / 29.0))
                    + GREATEST(18.0, LEAST(46.0, word_count * 0.27))
                    + LEAST(
                        8.0,
                        2.0
                        + LEAST(3.5, SQRT(GREATEST(word_count, 0)) / 3.2)
                        + LEAST(2.5, time_before_typing_seconds / 7.0)
                    )
                    + CASE
                        WHEN edit_signal < 0.18
                         AND backspace_signal < 0.12
                         AND pause_signal < 0.12
                         AND revision_signal < 0.12
                         AND deliberation_signal < 0.18
                        THEN 4.0
                        ELSE 0.0
                    END
                    - LEAST(
                        13.0,
                        3.2 * edit_signal
                        + 2.2 * backspace_signal
                        + 2.2 * pause_signal
                        + 1.6 * revision_signal
                        + 1.4 * deliberation_signal
                        + 1.2 * hesitation_score
                    )
                )
            )
            ELSE LEAST(
                100.0,
                GREATEST(
                    14.0,
                    14.0
                    + GREATEST(11.0, LEAST(26.0, char_count / 28.0))
                    + GREATEST(24.0, LEAST(62.0, word_count * 0.32))
                    + LEAST(
                        10.0,
                        2.5
                        + LEAST(4.5, SQRT(GREATEST(word_count, 0)) / 2.8)
                        + LEAST(3.0, time_before_typing_seconds / 6.5)
                    )
                    + CASE
                        WHEN edit_signal < 0.18
                         AND backspace_signal < 0.12
                         AND pause_signal < 0.12
                         AND revision_signal < 0.12
                         AND deliberation_signal < 0.18
                        THEN 6.0
                        ELSE 0.0
                    END
                    - LEAST(
                        17.0,
                        (3.2 * edit_signal
                        + 2.2 * backspace_signal
                        + 2.2 * pause_signal
                        + 1.6 * revision_signal
                        + 1.4 * deliberation_signal
                        + 1.2 * hesitation_score) * 1.1
                    )
                )
            )
        END AS new_threshold_seconds
    FROM base
),
compared AS (
    SELECT
        *,
        (time_spent_seconds < new_threshold_seconds) AS new_flag,
        CASE
            WHEN quality_score >= 0.75 THEN 'high'
            WHEN quality_score >= 0.55 THEN 'medium'
            ELSE 'low'
        END AS quality_bucket,
        CASE
            WHEN is_attention_check THEN 'attention'
            ELSE 'survey'
        END AS submission_kind
    FROM scored
)
SELECT
    submission_kind,
    attention_tier,
    quality_bucket,
    COUNT(*) AS submissions,
    COUNT(*) FILTER (WHERE stored_old_flag) AS old_flag_count,
    COUNT(*) FILTER (WHERE new_flag) AS new_flag_count,
    COUNT(*) FILTER (WHERE (NOT stored_old_flag) AND new_flag) AS newly_flagged_count,
    ROUND(AVG(time_spent_seconds)::numeric, 2) AS avg_time_spent_seconds,
    ROUND(AVG(new_threshold_seconds)::numeric, 2) AS avg_new_threshold_seconds
FROM compared
GROUP BY submission_kind, attention_tier, quality_bucket
ORDER BY submission_kind, attention_tier, quality_bucket;
