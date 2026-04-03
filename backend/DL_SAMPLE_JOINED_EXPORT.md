# C.O.G.N.I.T. Sample Joined Training Export

This file provides a small anonymized sample of the real joined training dataset shape.

Use it together with:

- `backend/schema_refined.sql`
- `backend/DL_MODEL_DATASET_GUIDE.md`
- `backend/_sample_joined_rows.json`

Purpose:
- show another model what one training row actually looks like
- reduce ambiguity around column names
- help build export scripts, feature builders, and training pipelines faster

---

## 1. What This Sample Is

This sample was created from a real joined export over the live database with:

- `submissions`
- `submission_behavior_metrics`
- `submission_cognitive_metrics`
- `images`
- `participants`

The sample contains:

- `8` real rows
- anonymized participant and submission identifiers
- truncated text fields
- truncated user-agent strings

What was anonymized:

- `participant_id` -> `participant_token`
- `submission_id` -> `submission_token`
- `image_id` -> `image_token`
- `description` -> `description_preview`
- `feedback` -> `feedback_preview`

What was kept:

- numeric telemetry
- score columns
- target-like columns
- image public id
- image URL
- demographic categories
- booleans and enforcement state

This makes the sample useful for modeling design without exposing raw internal IDs.

---

## 2. Files In The Sample Package

### Machine-readable sample

- `backend/_sample_joined_rows.json`

This is the best file for another model to inspect exact row structure.

### Human-readable schema/training guidance

- `backend/schema_refined.sql`
- `backend/DL_MODEL_DATASET_GUIDE.md`

---

## 3. Column Groups

The sample rows currently contain `77` columns.

### 3.1 Image / identity context

- `image_public_id`
- `image_url`
- `created_at`
- `participant_token`
- `submission_token`
- `image_token`

### 3.2 Raw text and text-derived counts

- `word_count`
- `distinct_word_count`
- `descriptive_token_count`
- `description_preview`
- `feedback_preview`

### 3.3 Submission/session telemetry

- `time_spent_seconds`
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

### 3.4 Typing behavior telemetry

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

### 3.5 Cognitive telemetry

- `confidence_rating`
- `difficulty_self_report`
- `first_view_duration_seconds`
- `writing_duration_seconds`
- `object_mention_count`
- `spatial_mention_count`
- `reference_coverage`
- `detail_density_score`

### 3.6 Attention labels

- `attention_passed`
- `attention_tier`
- `attention_confidence`

These are usually `NULL` for survey rows and populated for attention rows.

### 3.7 Speed / behavior / quality labels

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

### 3.8 Alignment labels

- `alignment_score`
- `alignment_precision`
- `alignment_recall`
- `alignment_object_f1`
- `alignment_relation_score`
- `alignment_scene_consistency_score`
- `alignment_wrong_object_penalty`
- `alignment_natural_language_score`
- `alignment_stuffing_penalty`

### 3.9 Enforcement labels

- `watchlist_triggered`
- `soft_review_recommended`
- `soft_flag_triggered`
- `hard_flag_triggered`
- `enforcement_status`

### 3.10 Metadata / demographics

- `is_survey`
- `is_attention_check`
- `device_type`
- `user_agent`
- `gender_code`
- `age`
- `language_code`
- `prior_experience`

---

## 4. What One Row Represents

One row represents one submission.

That submission can be either:

- a normal survey response
- an attention-check response

Each row combines:

- image information
- text response information
- typing behavior
- cognitive metrics
- backend-generated scores
- enforcement state
- participant metadata

So this sample is already close to a trainable multimodal table.

---

## 5. Example Interpretation Of A Real Sample Row

A typical survey row may look like:

- `is_survey = true`
- `word_count ~ 60–70`
- `device_type = mobile`
- `edit_count` and `pause_count` relatively high
- `quality_score ~ 0.70`
- `behavior_risk_score ~ 0.00`
- `copy_paste_likelihood_score ~ 0.00`
- `alignment_score ~ 0.50`
- `enforcement_status = normal`

A typical attention row may look like:

- `is_attention_check = true`
- `attention_passed = true/false`
- `attention_tier = weak_pass/suspicious/fail`
- `attention_confidence` populated
- `quality_score` capped lower than strong survey rows if attention trust is weaker
- `watchlist_triggered` may be true if trust behavior is concerning

---

## 6. How Another Model Should Use This Sample

Another model should use this sample to:

1. understand the exact training row shape
2. map field groups to feature branches
3. design dataset export code
4. define label-building code
5. write a multimodal training script

Recommended feature branches:

- image branch
  - `image_url` / image file bytes
- text branch
  - `description_preview` in the sample
  - full `description` in real export
- tabular branch
  - behavior telemetry
  - cognitive telemetry
  - metadata

---

## 7. Important Warning About The Sample

This sample is for shape and semantics.

It is not meant to be the full training dataset.

For real training:

- export full joined rows
- use full `description`
- use full `feedback`
- split by participant
- avoid leakage from direct teacher-label columns unless imitation is intended

---

## 8. Suggested Next Files To Build

The next useful files in the ML pipeline are:

1. `backend/export_training_dataset.py`
2. `backend/build_training_labels.py`
3. `backend/dataset_feature_glossary.md`
4. `ml/train_baseline.py`
5. `ml/train_multitask.py`
6. `ml/evaluate.py`

---

## 9. Ready-To-Paste Prompt For Another Model

```text
Use these files together:
- backend/schema_refined.sql
- backend/DL_MODEL_DATASET_GUIDE.md
- backend/DL_SAMPLE_JOINED_EXPORT.md
- backend/_sample_joined_rows.json

Help me build a leakage-safe multimodal training dataset and model pipeline.
One row is one submission.
The core inputs are:
- image
- text description
- behavior telemetry
- cognitive metrics
- metadata

The target tasks are:
1. cognitive load score (1-10)
2. survey quality classification + regression
3. image-text alignment score
4. writing coherence / cognitive strain index

First give me:
- exact export schema
- exact label builder
- split strategy
- baseline ML models
- multimodal DL architecture
- evaluation metrics
```

