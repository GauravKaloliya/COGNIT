WITH base AS (
    SELECT
        s.id,
        s.participant_id,
        s.is_attention_check,
        s.quality_score,
        s.behavior_risk_score,
        s.copy_paste_likelihood_score,
        s.too_fast_score,
        s.typing_effort_risk,
        s.watchlist_triggered,
        s.soft_review_recommended,
        s.hard_flag_triggered,
        s.soft_flag_triggered,
        s.enforcement_status,
        s.attention_tier,
        COALESCE(s.extra_metadata -> 'enforcement' -> 'combined_suspicion', 'false'::jsonb) = 'true'::jsonb AS combined_suspicion,
        jsonb_array_length(COALESCE(s.extra_metadata -> 'enforcement' -> 'contradiction_signals', '[]'::jsonb)) AS contradiction_count
    FROM submissions s
),
bucketed AS (
    SELECT
        *,
        CASE
            WHEN is_attention_check THEN 'attention'
            ELSE 'survey'
        END AS submission_kind,
        CASE
            WHEN quality_score >= 0.75 THEN 'high'
            WHEN quality_score >= 0.55 THEN 'medium'
            ELSE 'low'
        END AS quality_bucket
    FROM base
)
SELECT
    submission_kind,
    COALESCE(attention_tier, 'survey') AS attention_tier,
    quality_bucket,
    COUNT(*) AS submissions,
    COUNT(*) FILTER (WHERE watchlist_triggered) AS watchlist_candidates,
    COUNT(*) FILTER (WHERE soft_review_recommended) AS soft_review_candidates,
    COUNT(*) FILTER (WHERE soft_flag_triggered) AS soft_flag_candidates,
    COUNT(*) FILTER (WHERE hard_flag_triggered) AS hard_flag_candidates,
    COUNT(*) FILTER (WHERE combined_suspicion) AS combined_suspicion_rows,
    COUNT(*) FILTER (
        WHERE contradiction_count > 0
          AND quality_score >= 0.72
          AND (behavior_risk_score >= 0.30 OR copy_paste_likelihood_score >= 0.42)
    ) AS contradiction_heavy_rows,
    ROUND(AVG(behavior_risk_score)::numeric, 4) AS avg_behavior_risk,
    ROUND(AVG(copy_paste_likelihood_score)::numeric, 4) AS avg_copy_paste_likelihood,
    ROUND(AVG(too_fast_score)::numeric, 4) AS avg_too_fast_score
FROM bucketed
GROUP BY submission_kind, COALESCE(attention_tier, 'survey'), quality_bucket
ORDER BY submission_kind, COALESCE(attention_tier, 'survey'), quality_bucket;
