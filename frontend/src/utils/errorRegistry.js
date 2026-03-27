import {
  ERROR_CONTRACT,
  SHARED_CODE_TO_KEY,
  SHARED_KEY_TO_CODE,
  SHARED_MESSAGES_EN,
} from "./errorContract.js";

const DEFAULT_LANGUAGE = "en";

const TRANSLATIONS = {
  en: {
    "AUTH_001_0001": "Please agree to the consent terms to continue.",
    "AUTH_001_0002": "Your account has been flagged. Contact support.",
    "AUTH_003_0001": "Invalid verification code. Please try again.",
    "AUTH_003_0002": "Verification code expired. Request a new one.",
    "AUTH_003_0003": "Too many attempts. Request a new verification code.",
    "AUTH_003_0004": "No verification code found. Please request a new one.",
    "AUTH_003_0005": "Email service is temporarily unavailable. Please try again in a minute.",
    "AUTH_003_0006": "Email does not match your registration details.",
    "AUTH_003_0007": "Please enter a different email address to update.",
    "AUTH_003_0009": "Email service took too long to respond. Please try again.",
    "AUTH_003_0010": "Email service returned an error. Please try again.",
    "BOT_001_0002": "Human verification failed while creating the participant. Please retry.",
    "BOT_001_0005": "Human verification failed while submitting the response. Please retry.",
    "DUP_001_0001": "This username is already taken.",
    "DUP_001_0002": "This email is already registered.",
    "DUP_001_0004": "You have already registered.",
    "DUP_002_0001": "You have already described this image.",
    "DUP_002_0002": "You have already completed this survey round.",
    "NF_001_0001": "Account not found. Please register first.",
    "NF_001_0005": "Route not found.",
    "NF_001_0006": "No images are currently available. Please try again later.",
    "NF_001_0012": "Participant not found while recording consent.",
    "NF_001_0014": "Participant not found while submitting the response.",
    "RATE_001_0001": "Too many attempts. Please wait a moment.",
    "SYS_001_0001": "Something went wrong. Please try again.",
    "SYS_001_0002": "Database error occurred. Please try again later.",
    "SYS_001_0004": "Service is temporarily unavailable. Please try again.",
    "SYS_002_0001": "Request validation failed. Please try again.",
    "SYS_002_0002": "Failed to process the request. Please try again.",
    "SYS_002_0005": "Failed to load the image. Please retry.",
    "SYS_002_0006": "Failed to submit the response. Please try again.",
    "SYS_002_0007": "Request failed. Please try again.",
    "SYS_002_0016": "Failed to load the next image. Please try again.",
    "SYS_002_0017": "The app encountered an issue. Please try again.",
    "SYS_002_0018": "Image is still loading. Please wait and try again.",
    "SYS_002_0020": "System health check failed: {error}",
    "SYS_002_0021": "System is currently unavailable. Please try again later.",
    "SYS_002_0022": "Failed to create participant. Please try again.",
    "SYS_002_0024": "Service degraded.",
    "SYS_002_0030": "Failed to select a fallback image.",
    "SYS_002_0031": "Failed to load the next image. Please try again.",
    "SYS_002_0035": "Failed to check username availability. Please try again.",
    "SYS_002_0036": "Failed to check email availability. Please try again.",
    "SYS_002_0037": "Failed to record consent. Please try again.",
    "SYS_002_0039": "Failed to load participant options. Please try again.",
    "SYS_002_0040": "Failed to request email verification code. Please try again.",
    "SYS_002_0041": "Failed to verify email code. Please try again.",
    "SYS_002_0042": "Failed to save submission. Please try again.",
    "UI_001_0001": "Application is still initializing. Please wait a moment.",
    "UI_001_0002": "Image is still loading. Please wait and try again.",
    "UI_001_0003": "The page encountered an issue. Refresh to continue.",
    "UI_001_0004": "This request took too long. Please try again.",
    "VAL_001_0002": "Please enter a valid email address.",
    "VAL_001_0004": "Age must be between 13 and 100.",
    "VAL_001_0005": "Please select a gender.",
    "VAL_001_0007": "Please select your native language.",
    "VAL_001_0008": "Please select your prior experience.",
    "VAL_001_0010": "Username must be at least {min} characters.",
    "VAL_001_0011": "Username can only contain letters, numbers, and underscores.",
    "VAL_001_0012": "Email is required.",
    "VAL_001_0013": "Please enter a valid email address.",
    "VAL_001_0014": "Please use an approved email domain.",
    "VAL_001_0017": "Please select a gender.",
    "VAL_001_0018": "Age is required.",
    "VAL_001_0019": "Age must be between {min} and {max}.",
    "VAL_001_0020": "Location must be at least {min} characters.",
    "VAL_001_0021": "Please select your native language.",
    "VAL_001_0022": "Please select your prior experience.",
    "VAL_002_0001": "Description must be {min_description_length}-{max_description_length} characters long.",
    "VAL_002_0002": "Description is too short.",
    "VAL_002_0003": "Description is too long.",
    "VAL_002_0004": "At least {min_word_count} words are required.",
    "VAL_002_0005": "Feedback must be {min_feedback_length}-{max_feedback_length} characters long.",
    "VAL_002_0006": "Feedback is too short.",
    "VAL_002_0007": "Feedback is too long.",
    "VAL_002_0008": "Difficulty and confidence ratings must be between {min_rating} and {max_rating}.",
    "VAL_003_0001": "Verification code is required.",
    "VAL_003_0003": "Invalid request ID format.",
    "VAL_003_0007": "This action is not available here.",
    "VAL_003_0008": "Invalid image identifier.",
    "VAL_003_0009": "Idempotency key reuse with a different request payload is not allowed.",
    "VAL_003_0010": "Missing required X-Idempotency-Key header.",
    "VAL_003_0011": "X-Idempotency-Key must be <= 128 characters.",
    "VAL_003_0016": "Participant creation is missing required fields.",
    "VAL_003_0017": "Username is required.",
    "VAL_003_0018": "Email is required.",
    "VAL_003_0019": "Public ID is required to record consent.",
    "VAL_003_0021": "Public ID and email are required to request an email verification code.",
    "VAL_003_0022": "Public ID, email, and verification code are required.",
    "VAL_003_0023": "Public ID is required to submit a response.",
    "VAL_003_0024": "Image ID is required to submit a response.",
    "VAL_003_0025": "Participant is not in a valid stage for this action."
  },
};


export const ERROR_CATEGORIES = {
  VAL: { severity: "warning", action: "fix_input" },
  DUP: { severity: "warning", action: "change_input" },
  AUTH: { severity: "error", action: "reauthenticate" },
  BOT: { severity: "error", action: "retry" },
  NF: { severity: "error", action: "redirect" },
  SYS: { severity: "error", action: "retry" },
  UI: { severity: "warning", action: "retry" },
  RATE: { severity: "warning", action: "wait" },
  ERR: { severity: "error", action: "retry" },
};

export function hasErrorCode(errorCode) {
  const normalized = SHARED_KEY_TO_CODE[errorCode] || errorCode;
  return !!TRANSLATIONS.en[normalized] || !!SHARED_MESSAGES_EN[normalized];
}

export function getErrorMessage(errorCode, lang = DEFAULT_LANGUAGE, params = {}) {
  const messages = TRANSLATIONS[lang] || TRANSLATIONS[DEFAULT_LANGUAGE];
  const normalizedCode = SHARED_KEY_TO_CODE[errorCode] || errorCode;
  let message =
    messages[normalizedCode] ||
    (lang === DEFAULT_LANGUAGE ? SHARED_MESSAGES_EN[normalizedCode] : null) ||
    messages["SYS_001_0001"] ||
    SHARED_MESSAGES_EN["SYS_001_0001"] ||
    "An error occurred";

  Object.keys(params).forEach((key) => {
    const pattern = new RegExp(`\\{${key}\\}`, "g");
    message = message.replace(pattern, String(params[key]));
  });

  return message;
}

export function parseErrorResponse(response) {
  if (!response) {
    return {
      code: "SYS_001_0001",
      message: getErrorMessage("SYS_001_0001"),
      category: "SYS",
      severity: "error",
      action: "retry",
    };
  }

  if (!response.error) {
    const fallbackMessage =
      response.message ||
      response.error_message ||
      response.detail ||
      getErrorMessage("SYS_001_0001");
    const fallbackKey = response.key || SHARED_CODE_TO_KEY[response.code] || null;
    const fallbackCode = response.code || SHARED_KEY_TO_CODE[fallbackKey] || fallbackKey || "SYS_001_0001";
    const fallbackCategory = String(fallbackCode).split("_")[0] || "SYS";
    const categoryInfo = ERROR_CATEGORIES[fallbackCategory] || ERROR_CATEGORIES.SYS;
    return {
      code: fallbackCode,
      key: fallbackKey || null,
      message: fallbackMessage,
      originalMessage: fallbackMessage,
      category: fallbackCategory,
      field: response.field,
      fields: response.fields,
      details: response.details || response,
      status: response.http_status || response.status,
      retryable: response.retryable,
      requestId: response.request_id || response.requestId,
      severity: categoryInfo.severity,
      action: categoryInfo.action,
      timestamp: new Date().toISOString(),
    };
  }

  const { error } = response;
  const rawKey = error.key || SHARED_CODE_TO_KEY[error.code] || null;
  const rawCode = error.code || SHARED_KEY_TO_CODE[rawKey] || rawKey || "SYS_001_0001";
  const normalizedCode = SHARED_KEY_TO_CODE[rawCode] || rawCode;
  const contractDef = (
    (rawKey && ERROR_CONTRACT?.[rawKey])
    || ERROR_CONTRACT?.[rawCode]
    || Object.values(ERROR_CONTRACT || {}).find((def) => def.code === normalizedCode)
  );
  const category = error.category || contractDef?.category || String(normalizedCode).split("_")[0] || "SYS";
  const categoryInfo = ERROR_CATEGORIES[category] || ERROR_CATEGORIES.SYS;

  return {
    code: normalizedCode,
    key: rawKey || null,
    message: getErrorMessage(normalizedCode, DEFAULT_LANGUAGE, error.params || {}),
    originalMessage: error.message,
    category,
    field: error.field,
    fields: error.fields,
    details: error.details,
    status: error.http_status || error.status || response.http_status || response.status,
    retryable: error.retryable,
    requestId: error.request_id,
    severity: categoryInfo.severity,
    action: categoryInfo.action,
    timestamp: new Date().toISOString(),
  };
}
