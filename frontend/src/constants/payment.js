export const PAYMENT_STATUS = {
  pending: "pending",
  processing: "processing",
  success: "success",
  expired: "expired",
  failed: "failed",
  rejectedFraud: "rejected_fraud",
  error: "error",
};

export const PAYMENT_NOTICE_VARIANT = {
  info: "info",
  warning: "warning",
};

export const PAYMENT_VERIFICATION_REASON_CODES = {
  unrecognized_app: "FRAUD_001_0003",
  invalid_banking_name: "FRAUD_001_0004",
  invalid_amount: "FRAUD_002_0003",
  time_out_of_range: "FRAUD_001_0006",
  invalid_datetime_format_gpay: "FRAUD_001_0007",
  invalid_datetime_format_paytm: "FRAUD_001_0007",
  invalid_datetime_format_bhim: "FRAUD_001_0007",
  missing_paid_to_cognit: "FRAUD_002_0005",
  missing_paytm_label: "FRAUD_002_0005",
  missing_bhim_label: "FRAUD_002_0005",
  ocr_unavailable: "SYS_001_0004",
  missing_paid_bhim: "FRAUD_002_0005",
  missing_success: "FRAUD_002_0004",
  failure_indicator: "FRAUD_002_0005",
  ocr_signature_replay_self: "FRAUD_003_0004",
  ocr_signature_replay_other: "FRAUD_003_0001",
  max_attempts_exceeded: "PAY_001_0008",
};

export const PAYMENT_ERROR_CODES = {
  sessionExpired: "PAY_001_0001",
  invalidState: "PAY_001_0002",
  notVerified: "PAY_001_0005",
  maxAttempts: "PAY_001_0008",
  uploadTooLarge: "VAL_003_0005",
  invalidImage: "VAL_003_0004",
  missingUpload: "VAL_003_0006",
  tokenInvalid: "AUTH_002_0002",
  systemCreate: "SYS_002_0009",
  missingPaymentId: "SYS_002_0011",
  verificationFailed: "SYS_002_0012",
  verificationUnknown: "SYS_002_0013",
  paymentComplete: "SYS_002_0015",
  paymentUnavailable: "SYS_002_0010",
  screenshotRejected: "FRAUD_002_0009",
  screenshotReusedOther: "FRAUD_003_0001",
  screenshotReusedSelf: "FRAUD_003_0004",
  screenshotPreviouslyRejected: "FRAUD_003_0002",
};

export const PAYMENT_STATE_FIELDS = {
  publicId: "publicId",
  paymentData: "paymentData",
  paymentStatus: "paymentStatus",
  failureReasons: "failureReasons",
  error: "error",
};
