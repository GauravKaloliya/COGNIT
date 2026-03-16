export const PAYMENT_API_FIELDS = {
  id: "payment_id",
  token: "payment_token",
  expiresAt: "expires_at",
  qrBase64: "qr_base64",
  upiLink: "upi_link",
  amount: "amount",
  timeRemainingSeconds: "time_remaining_seconds",
  verificationDetails: "verification_details",
  failureReasons: "failure_reasons",
  isExpired: "is_expired",
  status: "status",
  verified: "verified",
};

export const ACTIVE_TAB_LOCK_FIELDS = {
  tabId: "tab_id",
  updatedAt: "updated_at",
};

export const SURVEY_API_FIELDS = {
  imageId: "image_id",
  imageUrl: "image_url",
  url: "url",
  isSurvey: "is_survey",
  isAttentionCheck: "is_attention_check",
  attentionStatus: "attention_status",
  attentionPassed: "attention_passed",
  hardFlagTriggered: "hard_flag_triggered",
  surveyIndex: "survey_index",
  publicId: "public_id",
  timeSpentSeconds: "time_spent_seconds",
  tabSwitchCount: "tab_switch_count",
  pageCloseAttempts: "page_close_attempts",
  networkDisconnects: "network_disconnects",
};
