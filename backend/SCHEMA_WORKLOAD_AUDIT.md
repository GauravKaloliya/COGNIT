# Schema Workload Audit

Date: 2026-03-26

## Query-path audit summary

1. `submissions` next survey round lookup
- Query path: `MAX(survey_index)` per participant where `is_survey = true`
- Used in: `backend/app/services/submission_query_service.py` (`QUERY_NEXT_SURVEY_INDEX`)
- Existing index was time-ordered (`participant_id, is_survey, created_at DESC`), not survey-index ordered.
- Change applied:
  - `idx_submissions_participant_survey_index_desc` on `(participant_id, survey_index DESC)` with partial predicate `is_survey = true`.

2. participant lookup for OTP verification/update flow
- Query path: by `public_id + email + is_deleted = false`
- Used in: `backend/app/services/email_otp_query_service.py` (`QUERY_SELECT_PARTICIPANT_BY_PUBLIC_EMAIL`)
- Existing indexes covered public_id and email separately, but no direct composite for this exact hot path.
- Change applied:
  - `idx_participants_public_email_not_deleted` on `(public_id, email)` with partial predicate `is_deleted = false`.

3. stale image reservation cleanup
- Query path: release active reservations by staleness
- Used in: `backend/app/services/image_service.py` + `image_query_service.py`
- Existing cleanup query filtered by `reserved_at`, while existing active index was on `expires_at`.
- Change applied:
  - Cleanup query now uses `expires_at <= CURRENT_TIMESTAMP`, matching `idx_image_reservations_expires_active`.

## FK / constraints quick check

- High-value FK coverage is already present for core relations:
  - `submissions -> participants/images/participant_sessions`
  - `attention_events -> submissions/participants/images`
  - `participant_attention_stats -> participants`
  - `image_reservations -> images/participants`
- Integrity constraints already cover key correctness paths:
  - participant stage domain check
  - survey/attention consistency checks
  - uniqueness constraints for dedupe/idempotency-related paths

## Notes

- This audit intentionally targets observed backend query workload first (read/write hot paths), not speculative indexing.
- Before adding further indexes, validate with production query plans (`EXPLAIN ANALYZE`) to avoid write-amplification and index bloat.
