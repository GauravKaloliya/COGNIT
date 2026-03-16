const toInt = (value, fallback) => {
  const num = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(num) ? num : fallback;
};

const toFloat = (value, fallback) => {
  const num = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(num) ? num : fallback;
};

const toBool = (value, fallback = false) => {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value).toLowerCase() === "true";
};

const toStr = (value, fallback) => {
  const raw = String(value ?? "").trim();
  return raw ? raw : fallback;
};

export const runtimeConfig = {
  msPerSecond: toInt(import.meta.env.VITE_MS_PER_SECOND, 1000),
  countdownTickMs: toInt(import.meta.env.VITE_COUNTDOWN_TICK_MS, 1000),
  uiStateSchemaVersion: toInt(import.meta.env.VITE_UI_STATE_SCHEMA_VERSION, 1),
  uiStateTtlMs: toInt(import.meta.env.VITE_UI_STATE_TTL_MS, 15 * 60 * 1000),
  activeTabLockSchemaVersion: toInt(import.meta.env.VITE_ACTIVE_TAB_LOCK_SCHEMA_VERSION, 1),
  activeTabHeartbeatMs: toInt(import.meta.env.VITE_ACTIVE_TAB_HEARTBEAT_MS, 4000),
  activeTabStaleMs: toInt(import.meta.env.VITE_ACTIVE_TAB_STALE_MS, 15000),
  toastDedupeWindowMs: toInt(import.meta.env.VITE_TOAST_DEDUPE_WINDOW_MS, 2000),
  toastAutoDismissMs: toInt(import.meta.env.VITE_TOAST_AUTO_DISMISS_MS, 4000),
  confettiDurationMs: toInt(import.meta.env.VITE_CONFETTI_DURATION_MS, 1200),
  serviceRetrySeconds: toInt(import.meta.env.VITE_SERVICE_RETRY_SECONDS, 5),
  paymentRetrySeconds: toInt(import.meta.env.VITE_PAYMENT_RETRY_SECONDS, 5),
  turnstileEnabled: toBool(import.meta.env.VITE_TURNSTILE_ENABLED, false),
  turnstileSiteKey: import.meta.env.VITE_TURNSTILE_SITE_KEY || "",
  paymentStateSchemaVersion: toInt(import.meta.env.VITE_PAYMENT_STATE_SCHEMA_VERSION, 1),
  paymentStateTtlMs: toInt(import.meta.env.VITE_PAYMENT_STATE_TTL_MS, 15 * 60 * 1000),
  paymentCreateTimeoutMs: toInt(import.meta.env.VITE_PAYMENT_CREATE_TIMEOUT_MS, 15000),
  paymentTimerDurationMs: toInt(import.meta.env.VITE_PAYMENT_TIMER_DURATION_MS, 5 * 60 * 1000),
  paymentTimerTickMs: toInt(import.meta.env.VITE_PAYMENT_TIMER_TICK_MS, 1000),
  paymentAmount: toFloat(import.meta.env.VITE_PAYMENT_AMOUNT, 1),
  rewardAmount: toFloat(import.meta.env.VITE_REWARD_AMOUNT, 10),
  storageKeys: {
    activeTabLock: toStr(import.meta.env.VITE_KEY_ACTIVE_TAB_LOCK, "cognit_active_tab_lock_v1"),
    darkMode: toStr(import.meta.env.VITE_KEY_DARK_MODE, "darkMode"),
    stage: toStr(import.meta.env.VITE_KEY_STAGE, "stage"),
    paymentSubStage: toStr(import.meta.env.VITE_KEY_PAYMENT_SUB_STAGE, "paymentSubStage"),
    consentGiven: toStr(import.meta.env.VITE_KEY_CONSENT_GIVEN, "consentGiven"),
    userDetailsSubmitted: toStr(import.meta.env.VITE_KEY_USER_DETAILS_SUBMITTED, "userDetailsSubmitted"),
    paymentVerified: toStr(import.meta.env.VITE_KEY_PAYMENT_VERIFIED, "paymentVerified"),
    demographics: toStr(import.meta.env.VITE_KEY_DEMOGRAPHICS, "demographics"),
    survey: toStr(import.meta.env.VITE_KEY_SURVEY, "survey"),
    surveyCompleted: toStr(import.meta.env.VITE_KEY_SURVEY_COMPLETED, "surveyCompleted"),
    surveyFeedbackReady: toStr(import.meta.env.VITE_KEY_SURVEY_FEEDBACK_READY, "surveyFeedbackReady"),
    lastSubmissionSucceeded: toStr(import.meta.env.VITE_KEY_LAST_SUBMISSION_SUCCEEDED, "lastSubmissionSucceeded"),
    shownImages: toStr(import.meta.env.VITE_KEY_SHOWN_IMAGES, "shownImages"),
    sessionId: toStr(import.meta.env.VITE_KEY_SESSION_ID, "sessionId"),
    publicId: toStr(import.meta.env.VITE_KEY_PUBLIC_ID, "publicId"),
    consentDraft: toStr(import.meta.env.VITE_KEY_CONSENT_DRAFT, "consent_checked_draft"),
    consentPending: toStr(import.meta.env.VITE_KEY_CONSENT_PENDING, "consent_pending_submit_v1"),
    userDetailsPending: toStr(import.meta.env.VITE_KEY_USER_DETAILS_PENDING, "user_details_pending_submit_v1"),
    participantOptions: toStr(import.meta.env.VITE_KEY_PARTICIPANT_OPTIONS, "participant_options_v1"),
    autoLocationPrompt: toStr(import.meta.env.VITE_KEY_AUTO_LOCATION_PROMPT, "location_auto_prompt_v1"),
    reverseGeocodeState: toStr(import.meta.env.VITE_KEY_REVERSE_GEOCODE_STATE, "reverse_geocode_state_v1"),
    paymentContentPending: toStr(import.meta.env.VITE_KEY_PAYMENT_CONTENT_PENDING, "payment_content_pending_continue_v1"),
    paymentState: toStr(import.meta.env.VITE_KEY_PAYMENT_STATE, "payment_link_state_v1"),
    paymentTimerExpires: toStr(import.meta.env.VITE_KEY_PAYMENT_TIMER_EXPIRES, "payment_timer_expires_at"),
    paymentId: toStr(import.meta.env.VITE_KEY_PAYMENT_ID, "payment_id"),
    paymentPendingCreate: toStr(import.meta.env.VITE_KEY_PAYMENT_PENDING_CREATE, "payment_pending_create_v1"),
    paymentPendingVerify: toStr(import.meta.env.VITE_KEY_PAYMENT_PENDING_VERIFY, "payment_pending_verify_v1"),
    surveyDraftPrefix: toStr(import.meta.env.VITE_KEY_SURVEY_DRAFT_PREFIX, "survey_draft"),
    surveyDraftActivePrefix: toStr(import.meta.env.VITE_KEY_SURVEY_DRAFT_ACTIVE_PREFIX, "survey_draft_active"),
    surveyPendingSubmit: toStr(import.meta.env.VITE_KEY_SURVEY_PENDING_SUBMIT, "survey_pending_submit_v1"),
    surveyFeedPendingContinue: toStr(import.meta.env.VITE_KEY_SURVEY_FEED_PENDING_CONTINUE, "survey_feed_pending_continue_v1"),
    surveyFeedPendingFinish: toStr(import.meta.env.VITE_KEY_SURVEY_FEED_PENDING_FINISH, "survey_feed_pending_finish_v1"),
    telemetry: toStr(import.meta.env.VITE_KEY_TELEMETRY, "client_telemetry_v1"),
  },
  maxUploadMb: toFloat(import.meta.env.VITE_MAX_UPLOAD_MB, 8),
  paymentUploadMaxMb: toFloat(import.meta.env.VITE_PAYMENT_UPLOAD_MAX_MB, toFloat(import.meta.env.VITE_MAX_UPLOAD_MB, 8)),
  minScreenshotWidth: toInt(import.meta.env.VITE_MIN_SCREENSHOT_WIDTH, 360),
  minScreenshotHeight: toInt(import.meta.env.VITE_MIN_SCREENSHOT_HEIGHT, 640),
  minLaplacianVariance: toFloat(import.meta.env.VITE_MIN_LAPLACIAN_VARIANCE, 22),
  surveyDraftSchemaVersion: toInt(import.meta.env.VITE_SURVEY_DRAFT_SCHEMA_VERSION, 1),
  surveyDraftTtlMs: toInt(import.meta.env.VITE_SURVEY_DRAFT_TTL_MS, 15 * 60 * 1000),
  consentDraftSchemaVersion: toInt(import.meta.env.VITE_CONSENT_DRAFT_SCHEMA_VERSION, 1),
  consentDraftTtlMs: toInt(import.meta.env.VITE_CONSENT_DRAFT_TTL_MS, 15 * 60 * 1000),
  disableCopyPaste: toBool(import.meta.env.VITE_DISABLE_COPY_PASTE, true),
  minWords: toInt(import.meta.env.VITE_MIN_WORDS, 60),
  minDescriptionLength: toInt(import.meta.env.VITE_MIN_DESCRIPTION_LENGTH, 60),
  maxDescriptionLength: toInt(import.meta.env.VITE_MAX_DESCRIPTION_LENGTH, 10000),
  minFeedbackLength: toInt(import.meta.env.VITE_MIN_FEEDBACK_LENGTH, 5),
  maxFeedbackLength: toInt(import.meta.env.VITE_MAX_FEEDBACK_LENGTH, 2000),
  priorityDescWordTarget: toInt(import.meta.env.VITE_PRIORITY_DESC_WORD_TARGET, 120),
  priorityFeedbackTarget: toInt(import.meta.env.VITE_PRIORITY_FEEDBACK_TARGET, 60),
  surveyUiTotalSteps: toInt(import.meta.env.VITE_SURVEY_UI_TOTAL_STEPS, 2),
  submitUnlockDelayMs: toInt(import.meta.env.VITE_SUBMIT_UNLOCK_DELAY_MS, 900),
  submitUnlockInvalidDelayMs: toInt(import.meta.env.VITE_SUBMIT_UNLOCK_INVALID_DELAY_MS, 500),
  submitUnlockCompleteDelayMs: toInt(import.meta.env.VITE_SUBMIT_UNLOCK_COMPLETE_DELAY_MS, 1000),
  surveyTimerTickMs: toInt(import.meta.env.VITE_SURVEY_TIMER_TICK_MS, 1000),
  healthCheckTimeoutMs: toInt(import.meta.env.VITE_HEALTH_CHECK_TIMEOUT_MS, 10000),
  healthCheckIntervalMs: toInt(import.meta.env.VITE_HEALTH_CHECK_INTERVAL_MS, 30000),
  networkProbeTimeoutMs: toInt(import.meta.env.VITE_NETWORK_PROBE_TIMEOUT_MS, 4000),
  networkProbeIntervalMs: toInt(import.meta.env.VITE_NETWORK_PROBE_INTERVAL_MS, 10000),
  networkProbeFailThreshold: toInt(import.meta.env.VITE_NETWORK_PROBE_FAIL_THRESHOLD, 2),
  geolocationTimeoutMs: toInt(import.meta.env.VITE_GEOLOCATION_TIMEOUT_MS, 10000),
  geolocationMaxAgeMs: toInt(import.meta.env.VITE_GEOLOCATION_MAX_AGE_MS, 300000),
  reverseGeocodeUrl: import.meta.env.VITE_REVERSE_GEOCODE_URL || "https://nominatim.openstreetmap.org/reverse",
  reverseGeocodeTtlMs: toInt(import.meta.env.VITE_REVERSE_GEOCODE_TTL_MS, 300000),
  availabilityDebounceMs: toInt(import.meta.env.VITE_AVAILABILITY_DEBOUNCE_MS, 500),
  usernameMinLength: toInt(import.meta.env.VITE_USERNAME_MIN_LENGTH, 2),
  ageMin: toInt(import.meta.env.VITE_AGE_MIN, 13),
  ageMax: toInt(import.meta.env.VITE_AGE_MAX, 100),
  locationMinLength: toInt(import.meta.env.VITE_LOCATION_MIN_LENGTH, 2),
};
