# C.O.G.N.I.T. Deep Learning Dataset and Backend Guide

This file is a training-oriented handoff for deep learning, machine learning, and multimodal modeling on top of the live C.O.G.N.I.T. backend and PostgreSQL schema.

Use this together with:

- `backend/schema_refined.sql`

That file gives the final-state schema.
This file explains what the schema means for modeling.

This guide is meant to be good enough to hand to:

- ChatGPT
- Grok
- Claude
- another coding/modeling agent

and ask it to help you build:

- export scripts
- label builders
- dataset schemas
- baseline ML models
- multimodal DL models
- evaluation code

It is intentionally optimized for modeling work, not for documenting every backend implementation detail.

---

## 0. Best Way To Use This Guide

If you are giving this project to another model, give it:

1. `backend/schema_refined.sql`
2. this file
3. optionally a small joined sample export from live DB

Recommended prompt:

```text
I have a Flask + PostgreSQL image-description survey system.
Use the attached schema_refined.sql and DL_MODEL_DATASET_GUIDE.md.
Help me build a leakage-safe multimodal training pipeline for:
1. cognitive load score (1-10)
2. survey quality (classification + regression)
3. image-text alignment score
4. writing coherence / cognitive strain index

Assume the live DB is the source dataset.
Do not train from scratch.
Prefer pretrained image/text encoders plus tabular fusion.
First give me:
- exact export schema
- exact labels
- split strategy
- baseline models
- DL architecture
- evaluation plan
```

---

## 1. Project Goal

The backend collects:

- participant profiles
- survey image descriptions
- comments/feedback
- attention-check responses
- typing telemetry
- cognitive-style telemetry
- alignment signals
- enforcement/watchlist signals

You want to train models to predict:

1. Cognitive Load Score `(1–10)`
2. Survey Quality
   - classification
   - regression
3. Image–Text Alignment Score
4. Writing Coherence / Cognitive Strain Index

The training source is the live PostgreSQL database.

---

## 2. Reality Check About Dataset Size

If your dataset is roughly:

- `400` users
- `800` submissions

then you **can** train deep learning models, but you should **not** train big models from scratch.

Correct strategy:

- use pretrained image encoders
- use pretrained text encoders
- use a small trainable MLP for tabular telemetry
- fuse the embeddings
- train small task-specific heads

Wrong strategy:

- train a full image-text transformer from zero
- train giant custom backbones from scratch

For this project, the best practical approach is:

- multimodal transfer learning
- not from-scratch deep learning

---

## 3. Backend Architecture Summary

The backend is a Flask + SQLAlchemy system with a submission pipeline that:

1. validates participant/session/state
2. validates image and submission order
3. computes attention-check outcomes for attention images
4. computes image-text alignment
5. computes scorecard features
6. computes final quality / trust / enforcement state
7. writes all derived values into normalized tables

Main orchestration entrypoint:

- `backend/app/services/submission_workflow_service.py`
  - `process_submission_workflow(...)`

Important scoring/policy modules:

- `backend/app/utils/helpers.py`
  - `calculate_behavior_scorecard(...)`
  - `calculate_quality_score(...)`
  - `calculate_writing_quality_score(...)`
  - `calculate_behavior_risk_score(...)`
- `backend/app/services/submission_processing_service.py`
  - `evaluate_attention_result(...)`
  - `apply_submission_enforcement(...)`
- `backend/app/services/submission_service.py`
  - `compute_alignment(...)`
  - attention-term helpers
  - normalization helpers

Persistence module:

- `backend/app/services/submission_query_service.py`
  - inserts `submissions`
  - inserts `submission_behavior_metrics`
  - inserts `submission_cognitive_metrics`
  - inserts `submission_alignment_mentions`
  - inserts `attention_events`
  - updates `participant_attention_stats`

Important modeling interpretation:

The backend is both:

- a data-collection system
- and a rule-based scoring system

That means the DB contains:

- raw-ish inputs
- engineered telemetry
- current heuristic/derived labels

So the first model you train may be either:

1. an imitation model of current backend scores
2. a better model intended to beat current backend scores

For v1, imitation is acceptable.

---

## 4. High-Level Submission Flow

When a submission arrives:

1. participant is fetched and validated
2. current stage must be `survey`
3. session is validated
4. image is fetched
5. submission kind is determined:
   - `is_survey`
   - `is_attention_check`
6. duplicate/copy checks run
7. for attention rows:
   - expected-term logic runs
   - attention pass/tier/confidence is computed
8. image-text alignment runs
9. writing quality and behavior scorecard are computed
10. final quality is computed
11. enforcement state is computed:
   - `normal`
   - `watchlist`
   - `soft_flag`
   - `hard_flag`
   - plus `soft_review_recommended`
12. all values are written to normalized tables

This is good for ML because:

- you have raw text
- you have telemetry
- you have derived score labels
- you have participant-level aggregation

---

## 5. Main Tables Relevant For Modeling

These are the tables that matter most.

### 5.1 `participants`

Purpose:
- participant identity and profile

Important columns:
- `id`
- `public_id`
- `username`
- `email`
- `gender_code`
- `age`
- `location`
- `language_code`
- `prior_experience`
- `consent_given`
- `email_verified`
- `stage`
- `ip_hash`
- `user_agent`
- `extra_metadata`
- `is_deleted`
- `created_at`
- `updated_at`

Modeling use:
- participant grouping
- participant metadata
- train/val/test split by participant

### 5.2 `participant_sessions`

Purpose:
- session lifecycle

Important columns:
- `id`
- `participant_id`
- `session_id`
- `started_at`
- `last_seen_at`
- `hidden_at`
- `ended_at`

Modeling use:
- optional session-level context

### 5.3 `images`

Purpose:
- all image records

Important columns:
- `id`
- `image_id`
- `url`
- `is_active`

Modeling use:
- image identity
- image path or image URL
- multimodal image encoder input

### 5.4 `attention_checks`

Purpose:
- identifies attention-check images

Important columns:
- `id`
- `image_id`
- `expected_word`
- `is_strict`
- `is_active`

Modeling use:
- tells you whether a submission is attention vs survey

### 5.5 `ground_truth_labels`

Purpose:
- object-level ground-truth labels per image

Important columns:
- `image_id`
- `object`
- `is_present`

Modeling use:
- reference objects for alignment modeling

### 5.6 `submissions`

Purpose:
- central fact table for each submission

This is the main modeling table.

Raw/input-ish fields:
- `id`
- `participant_id`
- `participant_session_id`
- `image_id`
- `survey_index`
- `description`
- `word_count`
- `feedback`
- `time_spent_seconds`
- `is_survey`
- `is_attention_check`
- `ip_hash`
- `user_agent`
- `device_type`
- `extra_metadata`
- `tab_switch_count`
- `page_close_attempts`
- `network_disconnects`
- `survey_time_spent_seconds`
- `survey_page_views`
- `survey_tab_switches`
- `survey_page_close_attempts`
- `survey_network_disconnects`
- `survey_max_scroll_depth_pct`
- `survey_clicks`
- `survey_keypresses`
- `created_at`

Derived/label-ish fields:
- `attention_passed`
- `attention_tier`
- `attention_confidence`
- `expected_term_recall`
- `matched_term_count`
- `expected_term_count`
- `distinct_word_count`
- `descriptive_token_count`
- `flagged_too_fast`
- `too_fast_score`
- `too_fast_threshold_seconds`
- `too_fast_margin_seconds`
- `quality_score`
- `writing_quality_score`
- `behavior_risk_score`
- `copy_paste_likelihood_score`
- `typing_effort_risk`
- `speed_risk`
- `session_integrity_risk`
- `alignment_score`
- `alignment_precision`
- `alignment_recall`
- `alignment_object_f1`
- `alignment_relation_score`
- `alignment_scene_consistency_score`
- `alignment_wrong_object_penalty`
- `alignment_natural_language_score`
- `alignment_stuffing_penalty`
- `supporting_signals`
- `consecutive_failures`
- `hard_flag_triggered`
- `soft_flag_triggered`
- `watchlist_triggered`
- `soft_review_recommended`
- `enforcement_status`

Modeling use:
- primary training/export source

### 5.7 `submission_behavior_metrics`

Purpose:
- fine-grained typing and editing telemetry

Important columns:
- `submission_id`
- `time_before_typing_seconds`
- `edit_count`
- `backspace_count`
- `avg_keystroke_interval_seconds`
- `keystroke_variance`
- `pause_count`
- `avg_pause_duration_seconds`
- `revision_bursts`
- `hesitation_score`
- `submitted_without_typing_pause`

Modeling use:
- strongest tabular branch for behavior and strain

### 5.8 `submission_cognitive_metrics`

Purpose:
- cognitive-style metrics extracted or derived during submission processing

Important columns:
- `submission_id`
- `confidence_rating`
- `difficulty_self_report`
- `first_view_duration_seconds`
- `writing_duration_seconds`
- `object_mention_count`
- `spatial_mention_count`
- `reference_coverage`
- `detail_density_score`

Modeling use:
- strongest source for cognitive load
- useful for quality and coherence/strain

### 5.9 `submission_alignment_mentions`

Purpose:
- normalized object/spatial mentions from user text

Important columns:
- `submission_id`
- `mention_type`
- `mention`
- `mention_order`

Modeling use:
- mention sequence or bag-of-mentions features
- optional auxiliary alignment signals

### 5.10 `attention_events`

Purpose:
- append-only attention-check event log

Important columns:
- `participant_id`
- `submission_id`
- `image_id`
- `expected_terms`
- `matched_terms`
- `failure_reasons`
- `hard_fail_reasons`
- `soft_risk_reasons`
- `is_strict`
- `repetition_metrics`
- `response_seconds`
- `content_fingerprint`

Modeling use:
- weak supervision for trust/compliance models
- useful for participant-level anomaly signals

### 5.11 `participant_attention_stats`

Purpose:
- participant-level trust/enforcement state

Important columns:
- `participant_id`
- `total_checks`
- `passed_checks`
- `failed_checks`
- `attention_score`
- `recent_attention_score`
- `participant_enforcement_score`
- `consecutive_failures`
- `hard_flag_triggered`
- `soft_flag_triggered`
- `watchlist_triggered`
- `enforcement_status`
- `is_flagged`

Modeling use:
- participant-level aggregation
- downstream anomaly or enforcement targets

### 5.12 `audit_log`

Purpose:
- event trail

Important columns:
- `event_type`
- `participant_id`
- `endpoint`
- `http_method`
- `status_code`
- `details`
- `created_at`

Modeling use:
- debugging and later labeling
- not usually a main v1 feature table

---

## 6. Minimal Good V1 Training Join

If you only build one export first, use:

- `submissions`
- `submission_behavior_metrics`
- `submission_cognitive_metrics`
- `images`
- `participants`

Optional later:

- `submission_alignment_mentions`
- `attention_events`
- `participant_attention_stats`

This minimal join is already enough for:

- quality
- cognitive load
- coherence/strain
- basic alignment

---

## 7. Current Backend Score Generation

This section matters because your first models will probably learn current backend labels.

### 7.1 Behavior scorecard

Defined in:
- `backend/app/utils/helpers.py`
  - `calculate_behavior_scorecard(...)`

Main derived sub-signals:
- `typing_effort_risk`
- `copy_paste_likelihood_score`
- `answer_length_vs_edit_effort_mismatch`
- `deliberation_then_dump`
- `low_effort_signal`
- `suspicious_long_answer_floor`
- `speed_risk`
- `paired_speed_risk`
- `session_integrity_risk`
- `behavior_risk_score`
- `too_fast_score`
- `too_fast_threshold_seconds`
- `too_fast_margin_seconds`
- `flagged_too_fast`
- `contradiction_signals`

Interpretation:
- `copy_paste_likelihood_score` is a strong survey suspicion feature
- `behavior_risk_score` is the aggregate suspicious behavior estimate
- `too_fast_score` is speed-pressure related, not the only trust signal

### 7.2 Writing quality

Defined in:
- `backend/app/utils/helpers.py`
  - `calculate_writing_quality_score(...)`

Depends on:
- `word_count`
- feedback length
- `distinct_word_count`
- `alignment_score`
- `time_spent_seconds`

Output:
- `writing_quality_score` in `[0,1]`

### 7.3 Overall quality

Defined in:
- `backend/app/utils/helpers.py`
  - `calculate_quality_score(...)`

Depends on:
- `writing_quality_score`
- `behavior_risk_score`
- `copy_paste_likelihood_score`
- `alignment_score`
- `attention_trust_score`
- `attention_tier`
- `contradiction_signals`

Output:
- `quality_score` in `[0,1]`

### 7.4 Attention logic

Defined in:
- `backend/app/services/submission_processing_service.py`
  - `evaluate_attention_result(...)`
  - `finalize_attention_assessment(...)`

Outputs:
- `attention_passed`
- `attention_tier`
- `attention_confidence`

### 7.5 Enforcement logic

Defined in:
- `backend/app/services/submission_processing_service.py`
  - `apply_submission_enforcement(...)`

Outputs:
- `watchlist_triggered`
- `soft_review_recommended`
- `soft_flag_triggered`
- `hard_flag_triggered`
- `enforcement_status`
- `participant_enforcement_score`

For most modeling work, treat these as:
- downstream policy signals
- not your core semantic targets

---

## 8. Recommended Modeling Targets

### 8.1 Cognitive Load Score `(1–10)`

This is not stored directly.
Build it as a derived label.

Best ingredients:
- `difficulty_self_report`
- inverse `confidence_rating`
- `first_view_duration_seconds`
- `writing_duration_seconds`
- `hesitation_score`
- pause burden
- revision burden

Suggested v1 recipe:

```text
cognitive_load_raw =
    0.28 * normalized_difficulty
  + 0.20 * inverse_normalized_confidence
  + 0.16 * normalized_first_view_duration
  + 0.14 * normalized_writing_duration
  + 0.12 * normalized_hesitation
  + 0.10 * normalized_pause_revision_burden

cognitive_load_score_1_10 = 1 + 9 * clamp(cognitive_load_raw, 0, 1)
```

Interpretation:
- higher = more mental effort / load

### 8.2 Survey Quality

Use both:

Regression target:
- `quality_score`

Classification target:
- bucketed `quality_score`

Suggested buckets:
- low: `< 0.55`
- medium: `0.55–0.75`
- high: `> 0.75`

### 8.3 Image–Text Alignment Score

Primary target:
- `alignment_score`

Optional secondary targets:
- `alignment_precision`
- `alignment_recall`
- `alignment_object_f1`
- `alignment_relation_score`
- `alignment_scene_consistency_score`

### 8.4 Writing Coherence / Cognitive Strain Index

This is also best built as a derived label.

Suggested v1 blended target:

```text
coherence_component =
    0.55 * writing_quality_score
  + 0.20 * normalized_alignment
  + 0.15 * lexical_richness
  + 0.10 * detail_density_score

strain_component =
    0.30 * hesitation_score
  + 0.22 * normalized_pause_burden
  + 0.18 * normalized_revision_burden
  + 0.15 * normalized_backspace_burden
  + 0.15 * low_effort_or_dump_signal

coherence_strain_index =
    0.55 * (1 - coherence_component)
  + 0.45 * strain_component
```

Interpretation:
- higher = more strain / weaker coherence
- lower = stronger coherence / lower strain

### 8.5 Optional auxiliary targets

Useful weak-supervision outputs:

- `flagged_too_fast`
- `too_fast_score`
- `copy_paste_likelihood_score`
- `behavior_risk_score`
- `attention_passed`
- `attention_tier`
- `soft_review_recommended`

Do not confuse these with your main scientific targets.

---

## 9. Feature Groups

### 9.1 Text features

Use:
- `description`
- `feedback`
- `word_count`
- `distinct_word_count`
- `descriptive_token_count`

Optional derived features:
- lexical diversity
- sentence count
- avg sentence length
- repetition rate

### 9.2 Image features

Use:
- `image_id`
- `url`

Feed actual image bytes/paths to a pretrained image encoder.

### 9.3 Behavior telemetry features

Use:
- `time_before_typing_seconds`
- `edit_count`
- `backspace_count`
- `avg_keystroke_interval_seconds`
- `keystroke_variance`
- `pause_count`
- `avg_pause_duration_seconds`
- `revision_bursts`
- `hesitation_score`
- `submitted_without_typing_pause`
- `tab_switch_count`
- `page_close_attempts`
- `network_disconnects`
- `survey_page_views`
- `survey_tab_switches`
- `survey_page_close_attempts`
- `survey_network_disconnects`
- `survey_max_scroll_depth_pct`
- `survey_clicks`
- `survey_keypresses`

### 9.4 Cognitive features

Use:
- `confidence_rating`
- `difficulty_self_report`
- `first_view_duration_seconds`
- `writing_duration_seconds`
- `object_mention_count`
- `spatial_mention_count`
- `reference_coverage`
- `detail_density_score`

### 9.5 Alignment features

Use:
- `submission_alignment_mentions`
- `ground_truth_labels`
- mention counts
- overlap ratios

### 9.6 Metadata features

Use:
- `device_type`
- `user_agent`
- `gender_code`
- `age`
- `language_code`
- `prior_experience`
- `survey_index`
- `is_attention_check`
- `is_survey`
- time features from `created_at`

### 9.7 Features to exclude in honest first-pass prediction

If target is `quality_score`, avoid directly using:
- `quality_score`
- `writing_quality_score`
- `behavior_risk_score`
- `copy_paste_likelihood_score`
- `alignment_score`

If target is `alignment_score`, avoid directly using:
- `alignment_score`
- `alignment_precision`
- `alignment_recall`
- `alignment_object_f1`

unless your explicit goal is to imitate or compress the current rule engine.

---

## 10. Leakage Risks

This section is critical.

### 10.1 Participant leakage

If the same participant appears in train and test, the model may memorize their behavior or writing style.

Use:
- participant-level split

### 10.2 Formula leakage

If you predict a score using columns that directly generated that score, your model may only reproduce the rule engine.

That is acceptable for:
- v1 imitation

That is not enough for:
- claiming better intelligence than current rules

### 10.3 Image leakage

If the same image appears in both train and test, alignment tasks become easier.

Recommended:
- main split by participant
- second stress-test split by image

### 10.4 Attention-policy leakage

Do not treat policy fields as ground-truth semantic targets unless you explicitly want to imitate enforcement.

### 10.5 Time leakage

If scoring logic changed over time, newer and older rows may differ.

Keep:
- `created_at`

And consider checking:
- time-based drift

### 10.6 Backfill leakage

If old rows were backfilled with newer formulas, current labels may reflect present-day logic rather than original historical runtime logic.

That is okay for:
- current-system imitation

Not okay for:
- historical behavior analysis

---

## 11. Best Training Strategy For Your Data Size

With about `400` users and `800` submissions:

Correct strategy:

- pretrained image encoder
- pretrained text encoder
- tabular MLP
- fusion MLP
- multi-task heads

Recommended stack:

- Python
- pandas or polars
- scikit-learn
- PyTorch
- transformers
- sentence-transformers
- OpenCLIP / Hugging Face CLIP / SigLIP
- CatBoost or XGBoost for baselines

---

## 12. Recommended First DL Model

### Architecture

```text
image -> frozen CLIP image encoder -> image_emb
text -> frozen text encoder -> text_emb
tabular -> small MLP -> tabular_emb

[image_emb || text_emb || tabular_emb]
    -> fusion MLP
    -> head_quality_reg
    -> head_quality_cls
    -> head_alignment_reg
    -> head_cognitive_load_reg
    -> head_coherence_strain_reg
```

### Training order

1. train baseline ML first
2. freeze image/text encoders
3. train tabular branch + fusion + heads
4. evaluate
5. optionally unfreeze top layers lightly

This is the safest DL path.

---

## 13. Suggested SQL Export Shape

Conceptual export:

```sql
SELECT
    s.id AS submission_id,
    s.participant_id,
    s.image_id,
    i.image_id AS image_public_id,
    i.url AS image_url,
    s.created_at,

    s.description,
    s.feedback,
    s.word_count,
    s.distinct_word_count,
    s.descriptive_token_count,
    s.time_spent_seconds,
    s.is_survey,
    s.is_attention_check,
    s.device_type,
    s.user_agent,

    s.tab_switch_count,
    s.page_close_attempts,
    s.network_disconnects,
    s.survey_time_spent_seconds,
    s.survey_page_views,
    s.survey_tab_switches,
    s.survey_page_close_attempts,
    s.survey_network_disconnects,
    s.survey_max_scroll_depth_pct,
    s.survey_clicks,
    s.survey_keypresses,

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

    scm.confidence_rating,
    scm.difficulty_self_report,
    scm.first_view_duration_seconds,
    scm.writing_duration_seconds,
    scm.object_mention_count,
    scm.spatial_mention_count,
    scm.reference_coverage,
    scm.detail_density_score,

    s.attention_passed,
    s.attention_tier,
    s.attention_confidence,

    s.flagged_too_fast,
    s.too_fast_score,
    s.too_fast_threshold_seconds,
    s.too_fast_margin_seconds,

    s.quality_score,
    s.writing_quality_score,
    s.behavior_risk_score,
    s.copy_paste_likelihood_score,
    s.typing_effort_risk,
    s.speed_risk,
    s.session_integrity_risk,

    s.alignment_score,
    s.alignment_precision,
    s.alignment_recall,
    s.alignment_object_f1,
    s.alignment_relation_score,
    s.alignment_scene_consistency_score,
    s.alignment_wrong_object_penalty,
    s.alignment_natural_language_score,
    s.alignment_stuffing_penalty,

    s.watchlist_triggered,
    s.soft_review_recommended,
    s.soft_flag_triggered,
    s.hard_flag_triggered,
    s.enforcement_status,

    p.gender_code,
    p.age,
    p.language_code,
    p.prior_experience
FROM submissions s
LEFT JOIN submission_behavior_metrics sbm ON sbm.submission_id = s.id
LEFT JOIN submission_cognitive_metrics scm ON scm.submission_id = s.id
LEFT JOIN images i ON i.id = s.image_id
LEFT JOIN participants p ON p.id = s.participant_id
WHERE p.is_deleted = FALSE;
```

Also useful:

- create a participant split file
- create an image holdout file
- write a feature glossary file

---

## 14. Recommended Splits

Primary split:
- by `participant_id`

Suggested:
- 70% train participants
- 15% validation participants
- 15% test participants

Second diagnostic split:
- hold out some images

Report both:
- participant generalization
- image generalization

---

## 15. Suggested Pipeline

1. export joined dataset
2. build labels
3. build feature glossary
4. train baseline ML
5. train multimodal DL
6. evaluate on held-out participants
7. compare against backend rule system
8. only replace rules if DL beats them clearly

Concrete files another model should produce:

1. `export_training_dataset.py`
2. `build_labels.py`
3. `dataset_schema.md`
4. `train_baseline.py`
5. `train_multitask.py`
6. `evaluate.py`
7. `inference_schema.md`

---

## 16. What Not To Do

Do not:

- train giant models from scratch
- split randomly by row only
- evaluate only on train-like images
- trust classification accuracy alone
- use direct target columns as inputs in an “honest prediction” setup
- replace current backend rules before held-out comparison

---

## 17. Feature Glossary

- `quality_score`: final backend overall quality estimate
- `writing_quality_score`: text-quality/coherence component
- `behavior_risk_score`: aggregate suspicious-behavior estimate
- `copy_paste_likelihood_score`: survey copy-paste suspicion estimate
- `typing_effort_risk`: low normalized editing effort risk
- `speed_risk`: speed / too-fast pressure estimate
- `session_integrity_risk`: session-level suspiciousness from tab switches/close attempts/disconnects
- `alignment_score`: image-text alignment estimate
- `attention_confidence`: confidence that attention response followed instructions
- `attention_tier`: pass / weak_pass / suspicious / fail
- `soft_review_recommended`: review-worthy row without strong escalation
- `watchlist_triggered`: watchlist policy signal
- `soft_flag_triggered`: stronger repeated-evidence policy signal
- `hard_flag_triggered`: strongest rare enforcement signal

---

## 18. Final Advice To Any External Model

Treat:

- `submissions` as the central fact table
- behavior/cognitive/alignment tables as feature joins
- current score columns as teacher labels unless told otherwise

Prefer:

- pretrained multimodal encoders
- small trainable heads
- careful leakage-safe evaluation

The best v1 result is not a giant foundation model.
The best v1 result is a clean, honest multimodal model that beats or improves on the current heuristic scoring system on held-out participants.
