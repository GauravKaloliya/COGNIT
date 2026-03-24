import sharedErrorContract from "./error_contract.json";

const DEFAULT_LANGUAGE = "en";

const SHARED_MESSAGES_EN = Object.values(sharedErrorContract || {}).reduce((acc, def) => {
  if (def && typeof def === "object" && def.code && def.message) {
    acc[String(def.code)] = String(def.message);
  }
  return acc;
}, {});

const TRANSLATIONS = {
  en: {
    "VAL_003_0001": "Please fill in all required fields.",
    "VAL_003_0002": "Invalid request format.",
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
    "VAL_001_0001": "Username must be at least 2 characters and contain only letters, numbers, and underscores.",
    "VAL_001_0002": "Please enter a valid email address from Gmail, Outlook, Hotmail, or iCloud.",
    "VAL_001_0004": "Age must be between 13 and 100.",
    "VAL_001_0005": "Please select a gender.",
    "VAL_001_0006": "Please enter your location.",
    "VAL_001_0007": "Please select your native language.",
    "VAL_001_0008": "Please select your prior experience.",
    "VAL_001_0010": "Username is required (minimum {min} characters).",
    "VAL_001_0011": "Username can only contain letters, numbers, and underscores (no spaces or special characters).",
    "VAL_001_0012": "Email is required.",
    "VAL_001_0013": "Please enter a valid email address.",
    "VAL_001_0014": "Only Gmail, Outlook, Hotmail, and iCloud email addresses are allowed.",
    "VAL_001_0017": "Gender is required.",
    "VAL_001_0018": "Age is required.",
    "VAL_001_0019": "Age must be between {min} and {max}.",
    "VAL_001_0020": "Place/Location is required.",
    "VAL_001_0021": "Native language is required.",
    "VAL_001_0022": "Prior experience is required.",
    "VAL_002_0001": "Description must be 60-10,000 characters long.",
    "VAL_002_0002": "Description must be at least 60 characters long.",
    "VAL_002_0003": "Description cannot exceed 10,000 characters.",
    "VAL_002_0004": "At least {min_words} words are required.",
    "VAL_002_0005": "Feedback must be 5-2,000 characters long.",
    "VAL_002_0006": "Feedback must be at least 5 characters long.",
    "VAL_002_0007": "Feedback cannot exceed 2,000 characters.",
    "VAL_002_0008": "Rating must be between 1 and 10.",
    "VAL_002_0009": "Rating must be at least 1.",
    "VAL_002_0010": "Rating cannot exceed 10.",
    "VAL_002_0011": "Invalid survey index.",
    "DUP_001_0001": "This username is already taken.",
    "DUP_001_0002": "This email is already registered.",
    "DUP_001_0004": "You have already registered.",
    "DUP_002_0001": "You have already described this image.",
    "DUP_002_0002": "You have already completed this survey round.",
    "AUTH_001_0001": "Please agree to the consent terms to continue.",
    "AUTH_001_0002": "Your account has been flagged. Contact support.",
    "AUTH_001_0003": "This account has been deactivated.",
    "AUTH_002_0001": "Access denied.",
    "AUTH_003_0001": "Invalid verification code. Please try again.",
    "AUTH_003_0002": "Verification code expired. Request a new one.",
    "AUTH_003_0003": "Too many attempts. Request a new verification code.",
    "AUTH_003_0004": "No verification code found. Please request a new one.",
    "AUTH_003_0005": "Email service is temporarily unavailable. Please try again in a minute.",
    "AUTH_003_0006": "Email does not match your registration details.",
    "AUTH_003_0007": "Please enter a different email address to update.",
    "AUTH_003_0008": "Please verify your email before submitting.",
    "AUTH_003_0009": "Email service took too long to respond. Please try again.",
    "AUTH_003_0010": "Email service returned an error. Please try again.",
    "BOT_001_0001": "Human verification failed. Please retry.",
    "BOT_001_0002": "Human verification failed while creating the participant. Please retry.",
    "BOT_001_0005": "Human verification failed while submitting the response. Please retry.",
    "NF_001_0001": "Account not found. Please register first.",
    "NF_001_0002": "Image not found.",
    "NF_001_0004": "Consent record not found.",
    "NF_001_0005": "Route not found.",
    "NF_001_0006": "No images are currently available. Please try again later.",
    "NF_001_0012": "Participant not found while recording consent.",
    "NF_001_0014": "Participant not found while submitting the response.",
    "SYS_001_0001": "Something went wrong. Please try again.",
    "SYS_001_0002": "Database error occurred. Please try again later.",
    "SYS_001_0003": "Service temporarily unavailable. Please try later.",
    "SYS_001_0004": "Configuration error. Please contact support.",
    "SYS_001_0005": "Internal server error. Our team has been notified.",
    "SYS_002_0001": "Unable to reach the server. Please check your connection and try again.",
    "SYS_002_0002": "Failed to record consent. Please try again.",
    "SYS_002_0003": "System is not ready. Please wait for the connection to be established.",
    "SYS_002_0004": "Image not loaded properly. Please wait or refresh.",
    "SYS_002_0005": "Image failed to load.",
    "SYS_002_0006": "Submission failed. Please try again.",
    "SYS_002_0007": "Unable to connect to server. Please check your internet connection and try again.",
    "SYS_002_0008": "The request took too long. Please try again.",
    "SYS_002_0010": "We couldn't find your registration details. Please go back and complete the registration form.",
    "SYS_002_0015": "Failed to load first survey image. Please try again.",
    "SYS_002_0016": "Failed to load image. Please try again.",
    "SYS_002_0017": "Unexpected error occurred.",
    "SYS_002_0018": "Waiting for image to load...",
    "SYS_002_0019": "Server returned an error (HTTP {status}). Please try again later.",
    "SYS_002_0020": "Service degraded: {error}",
    "SYS_002_0021": "The system is currently degraded. Please try again later.",
    "SYS_002_0022": "Failed to create participant. Please try again.",
    "SYS_002_0023": "Please refresh the page to continue.",
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
    "RATE_001_0001": "Too many attempts. Please wait a moment.",
    "RATE_001_0002": "Rate limit exceeded. Please slow down.",
    "ERR_RATE_LIMIT": "Too many requests. Please wait a moment and try again.",
  },
};

export const ERROR_CATEGORIES = {
  VAL: { severity: "warning", action: "fix_input" },
  DUP: { severity: "warning", action: "change_input" },
  AUTH: { severity: "error", action: "reauthenticate" },
  BOT: { severity: "error", action: "retry" },
  NF: { severity: "error", action: "redirect" },
  SYS: { severity: "error", action: "retry" },
  RATE: { severity: "warning", action: "wait" },
  ERR: { severity: "error", action: "retry" },
};

export function hasErrorCode(errorCode) {
  return !!TRANSLATIONS.en[errorCode] || !!SHARED_MESSAGES_EN[errorCode];
}

export function getErrorMessage(errorCode, lang = DEFAULT_LANGUAGE, params = {}) {
  const messages = TRANSLATIONS[lang] || TRANSLATIONS[DEFAULT_LANGUAGE];
  let message =
    messages[errorCode] ||
    (lang === DEFAULT_LANGUAGE ? SHARED_MESSAGES_EN[errorCode] : null) ||
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
    const fallbackCode = response.code || "SYS_001_0001";
    const fallbackCategory = String(fallbackCode).split("_")[0] || "SYS";
    const categoryInfo = ERROR_CATEGORIES[fallbackCategory] || ERROR_CATEGORIES.SYS;
    return {
      code: fallbackCode,
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
  const code = error.code || "SYS_001_0001";
  const category = error.category || String(code).split("_")[0] || "SYS";
  const categoryInfo = ERROR_CATEGORIES[category] || ERROR_CATEGORIES.SYS;

  return {
    code,
    message: getErrorMessage(code, DEFAULT_LANGUAGE, error.params || {}),
    originalMessage: error.message,
    category,
    field: error.field,
    fields: error.fields,
    details: error.details,
    status: error.status,
    retryable: error.retryable,
    requestId: error.request_id,
    severity: categoryInfo.severity,
    action: categoryInfo.action,
    timestamp: new Date().toISOString(),
  };
}
