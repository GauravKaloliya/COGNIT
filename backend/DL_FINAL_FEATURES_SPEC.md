# C.O.G.N.I.T. Final Deep Learning Feature Specification

This document is the final feature policy for training deep learning models on the C.O.G.N.I.T. dataset.

It is intentionally written as a gold-standard reference so it can be handed to:

- ChatGPT
- Grok
- Claude
- ML engineers
- data scientists
- future you

Use this file together with:

- `backend/schema_refined.sql`
- `backend/DL_MODEL_DATASET_GUIDE.md`
- `backend/DL_SAMPLE_JOINED_EXPORT.md`
- `backend/_sample_joined_rows.json`

This file answers one question only:

> Which features should be included, which should be optional, and which must be excluded for a leakage-safe, high-quality multimodal DL system?

The targets are:

1. Cognitive Load Score `(1–10)`
2. Survey Quality `(classification + regression)`
3. Image–Text Alignment Score
4. Writing Coherence / Cognitive Strain Index

---

## 1. Design Principles

This feature set is optimized for:

- strong predictive value
- low leakage
- small-to-medium dataset stability
- multimodal modeling
- practical trainability

The core design rules are:

1. Prefer raw inputs over backend-computed labels.
2. Prefer clean ratios over rule-heavy heuristic composites.
3. Keep embeddings minimal and strong, not redundant.
4. Do not feed final target components back into the model.
5. Keep demographics and weak context features optional.
6. Use the smallest clean feature set that still preserves predictive power.

---

## 2. Core Embeddings

These are the only embedding-level semantic features that should be treated as core.

### Include

- `description` embedding
- `feedback` embedding as optional secondary text input
- image embedding

### Why

These three inputs cover the three true semantic channels in the system:

- what the participant wrote
- the optional extra comments they gave
- what was shown in the image

This is enough for a strong multimodal model.

### Remove

- combined text embedding
- multiple pooled text embeddings for the same text
- vague coherence embedding variants
- redundant semantic embedding stacks
- extra text embedding families that encode nearly the same information

### Why remove them

On a dataset of this scale, too many overlapping embeddings increase:

- overfitting
- noisy gradients
- training instability
- feature redundancy

The goal is not to maximize embedding count.
The goal is to maximize useful signal per parameter.

---

## 3. Raw Text Features

These are core and should be included.

### Include

- `description`
- `feedback`
- `word_count`
- `distinct_word_count`
- `descriptive_token_count`
- description character length
- feedback character length
- sentence count
- average sentence length
- maximum sentence length
- minimum sentence length
- lexical diversity
- type-token ratio
- repetition ratio
- punctuation density
- comma count
- period count
- question mark count
- exclamation mark count
- average word length
- long-word ratio
- short-word ratio
- readability score
- spelling-error estimate
- grammar-error estimate

### Why

These features capture:

- semantic richness
- verbosity
- linguistic variety
- structure
- fluency
- mechanical quality

They are especially useful for:

- survey quality
- writing coherence
- cognitive strain

---

## 4. Raw Behavior Telemetry

These are core and should be included.

### Include

- `time_spent_seconds`
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

### Why

These describe:

- response pacing
- session stability
- multitasking behavior
- navigation behavior
- interaction intensity

They are useful for:

- cognitive load
- survey quality
- coherence / strain
- anomaly detection as auxiliary behavior context

---

## 5. Typing and Edit Telemetry

These are among the most important features in the entire project.

### Include

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

### Why

These features directly reflect:

- hesitation
- revision behavior
- fluency
- response planning
- effort intensity
- strain

These are especially strong for:

- cognitive load
- survey quality
- writing coherence / cognitive strain

---

## 6. Clean Normalized Telemetry

These are engineered features, but they remain clean and valid because they are simple transformations of raw signals.

### Include

- `edits_per_word`
- `backspaces_per_word`
- `pauses_per_word`
- `revision_bursts_per_word`
- `keypresses_per_word`
- `clicks_per_word`
- `time_per_word`
- `description_chars_per_second`
- `writing_duration_per_word`
- `pause_time_per_word`
- `time_before_typing / time_spent_seconds`
- `writing_duration / time_spent_seconds`
- `first_view_duration / time_spent_seconds`
- `backspace_to_edit_ratio`
- `pause_to_edit_ratio`
- `revision_to_edit_ratio`
- `survey_clicks / survey_page_views`
- `survey_keypresses / survey_page_views`
- `survey_tab_switches / time_spent_seconds`
- `page_close_attempts / time_spent_seconds`
- `network_disconnects / time_spent_seconds`

### Why

Raw counts alone are unstable across:

- response length
- device type
- browser behavior
- user style

These normalized ratios help the model compare submissions more fairly.

### Important note

These are clean features because they are:

- directly derived from raw telemetry
- not backend target scores
- not direct outputs of final decision logic

---

## 7. Raw Cognitive Metrics

These should be kept raw, not converted into label-like shortcut features.

### Include

- `confidence_rating`
- `difficulty_self_report`
- `first_view_duration_seconds`
- `writing_duration_seconds`
- `object_mention_count`
- `spatial_mention_count`
- `reference_coverage`
- `detail_density_score`

### Why

These are the best directly stored cognitive-style signals in the database.

They are especially useful for:

- cognitive load
- coherence / strain
- survey quality

### Remove

- inverse confidence
- normalized difficulty
- difficulty-confidence gap

### Why remove them

These are too close to label-construction shortcuts for cognitive-load modeling.

Better approach:
- feed the raw values
- let the model learn their relationships

---

## 8. Mention / Alignment-Side Clean Inputs

These are the clean alignment-side features that are allowed.

### Include

- object mention list
- spatial mention list
- mention sequence/order
- object mention count
- spatial mention count
- mention diversity
- repeated mention count
- mention density per word
- first mention type
- mention-type transition patterns

### Why

These capture how the participant structured image-relevant content in language.

They are useful for:

- alignment
- quality
- coherence

### Important rule

Keep mention-side information that comes from the text itself.

Do not include overlap-derived or comparison-derived alignment signals that already encode similarity to ground truth in a near-final way.

---

## 9. Cross-Modal Features

Only a very small number of cross-modal features should be core.

### Include

- cosine similarity between image embedding and description embedding
- cosine similarity between image embedding and feedback embedding, if feedback is used

### Why

These give a strong, compact, model-friendly summary of image-text relation without duplicating many heuristic alignment sub-scores.

### Remove

- semantic grounding similarity variants
- multiple contrastive similarity duplicates
- extra embedding-distance families unless empirically proven useful

### Why remove them

They often overlap heavily and create unnecessary redundancy on smaller datasets.

---

## 10. Context and Normalization Features

These help the model understand response context and device behavior.

### Core

- `device_type`
- browser family derived from `user_agent`
- OS family derived from `user_agent`
- mobile / desktop / tablet flag
- `survey_index`
- `is_survey`
- `is_attention_check`

### Why

These matter because telemetry patterns vary across:

- mobile vs desktop
- browser implementations
- survey step position
- task type

### Move to optional

- hour of day
- day of week
- weekend vs weekday
- `language_code`
- participant history aggregates
- demographics

### Why optional

They can sometimes help, but they are:

- weaker
- noisier
- more dataset-dependent
- more prone to shortcut learning

---

## 11. Optional Only, Not Core

These can be used in ablations or later improvements, but they should not be part of the core production feature set.

### Optional

- feedback embedding
- `language_code`
- `gender_code`
- `age`
- `prior_experience`
- time-of-day features
- participant historical aggregates

### Why optional

They may help in some experiments, but they are not necessary for a strong first real model.

They also come with extra risk:

- demographic shortcut learning
- weak signal
- small-dataset instability

---

## 12. Strict Exclusions

These must not be included in the final training inputs for honest predictive modeling.

### Do not include

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
- `flagged_too_fast`
- `too_fast_score`
- `too_fast_threshold_seconds`
- `too_fast_margin_seconds`
- `attention_tier` for quality prediction
- `attention_confidence` for quality prediction

### Policy outputs to exclude

- `watchlist_triggered`
- `soft_review_recommended`
- `soft_flag_triggered`
- `hard_flag_triggered`
- `enforcement_status`
- `participant_enforcement_score`

### Overlap-derived alignment helpers to exclude

- matched object count
- missed object count
- unmatched object count
- object overlap ratio
- mention recall proxy
- mention precision proxy

### Rule-heavy shortcut composites to exclude

- `deliberation_then_dump`
- `answer_length_vs_edit_effort_mismatch`
- `low_effort_signal`

### Why these are excluded

These are excluded because they are either:

- direct targets
- target components
- post-hoc policy outputs
- label-adjacent reconstruction helpers
- human-designed shortcut features that bias the model toward existing backend rules

---

## 13. Final Task-Wise Core Features

This section defines the final task-specific feature bundles.

### 13.1 Cognitive Load Score `(1–10)`

Use:

- description embedding
- image embedding
- `difficulty_self_report`
- `confidence_rating`
- `first_view_duration_seconds`
- `writing_duration_seconds`
- `time_before_typing_seconds`
- `pause_count`
- `avg_pause_duration_seconds`
- `revision_bursts`
- `hesitation_score`
- `edits_per_word`
- `backspaces_per_word`
- `pauses_per_word`
- `time_per_word`
- `detail_density_score`
- `reference_coverage`
- `object_mention_count`
- `spatial_mention_count`
- device/browser context

Why:

This target is mostly about:

- difficulty
- hesitation
- effort
- duration structure
- detail burden

### 13.2 Survey Quality

Use:

- description embedding
- image embedding
- optional feedback embedding
- `word_count`
- `distinct_word_count`
- `descriptive_token_count`
- lexical diversity
- repetition ratio
- readability score
- raw telemetry
- typing telemetry
- normalized telemetry
- raw cognitive metrics
- mention-based features
- image-description cosine similarity
- device/browser context

Why:

This target is a broad combination of:

- semantic adequacy
- response completeness
- linguistic quality
- reasonable effort
- image grounding

### 13.3 Image–Text Alignment Score

Use:

- image embedding
- description embedding
- object mention list
- spatial mention list
- mention count
- mention sequence/order
- mention diversity
- `object_mention_count`
- `spatial_mention_count`
- `reference_coverage`
- image-description cosine similarity

Why:

This target should be learned from:

- image content
- language content
- mention structure

not from precomputed overlap-derived pseudo-label parts.

### 13.4 Writing Coherence / Cognitive Strain Index

Use:

- description embedding
- optional feedback embedding
- lexical diversity
- sentence structure features
- repetition features
- readability features
- `writing_duration_seconds`
- `time_before_typing_seconds`
- `edit_count`
- `backspace_count`
- `pause_count`
- `avg_pause_duration_seconds`
- `revision_bursts`
- `hesitation_score`
- normalized telemetry
- `detail_density_score`
- `reference_coverage`
- device/browser context

Why:

This target depends on:

- writing fluency
- revision burden
- pause behavior
- structural coherence
- cognitive strain signals

---

## 14. Final Production Feature Policy

If you want the shortest possible rule:

### Include

- raw text
- one primary text embedding
- optional feedback embedding
- one image embedding
- raw behavior telemetry
- normalized telemetry ratios
- raw cognitive metrics
- mention-side clean features
- one or two strong cross-modal similarity features
- device/browser/task context

### Exclude

- final backend scores
- score decomposition columns
- policy outputs
- overlap-derived alignment helpers
- rule-heavy handcrafted shortcut composites
- redundant embeddings

---

## 15. Why This Is 10/10

This feature policy is strong because it balances:

- predictive power
- interpretability
- leakage safety
- practical trainability
- stability on small-to-medium datasets

It avoids the two classic failure modes:

1. **Too little structure**
   - model is weak
2. **Too much engineered shortcut logic**
   - model becomes meaningless

This specification gives a clean middle path:

- rich raw inputs
- strong normalized signals
- minimal redundancy
- no target reconstruction

---

## 16. Recommended Next Step

The best next implementation artifact after this file is:

- a machine-readable feature matrix specification

Format:

```text
feature_name | source_table | category | core_or_optional | allowed_targets | exclude_reason_if_not_used
```

That would make the training pipeline implementation nearly foolproof.

