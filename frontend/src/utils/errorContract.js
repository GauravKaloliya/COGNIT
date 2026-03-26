// Shared error contract (mirrors backend error catalog).
// Kept in JS to allow comments, helper exports, and bundler-friendly imports.

export const ERROR_CONTRACT = {
  "SYS_INTERNAL_ERROR": {
    "code": "SYS_001_0001",
    "message": "Something went wrong. Please try again.",
    "status": 500,
    "category": "SYS"
  },
  "SYS_DATABASE_ERROR": {
    "code": "SYS_001_0002",
    "message": "Database error occurred. Please try again later.",
    "status": 500,
    "category": "SYS"
  },
  "SYS_SERVICE_DEGRADED": {
    "code": "SYS_002_0024",
    "message": "Service degraded.",
    "status": 503,
    "category": "SYS"
  },
  "SYS_RANDOM_IMAGE_FALLBACK_FAILED": {
    "code": "SYS_002_0030",
    "message": "Failed to select a fallback image.",
    "status": 500,
    "category": "SYS"
  },
  "SYS_RANDOM_IMAGE_QUERY_FAILED": {
    "code": "SYS_002_0031",
    "message": "Failed to load the next image. Please try again.",
    "status": 500,
    "category": "SYS"
  },
  "SYS_CHECK_USERNAME_FAILED": {
    "code": "SYS_002_0035",
    "message": "Failed to check username availability. Please try again.",
    "status": 500,
    "category": "SYS"
  },
  "SYS_CHECK_EMAIL_FAILED": {
    "code": "SYS_002_0036",
    "message": "Failed to check email availability. Please try again.",
    "status": 500,
    "category": "SYS"
  },
  "SYS_CONSENT_RECORD_FAILED": {
    "code": "SYS_002_0037",
    "message": "Failed to record consent. Please try again.",
    "status": 500,
    "category": "SYS"
  },
  "SYS_PARTICIPANT_OPTIONS_FAILED": {
    "code": "SYS_002_0039",
    "message": "Failed to load participant options. Please try again.",
    "status": 500,
    "category": "SYS"
  },
  "SYS_EMAIL_OTP_REQUEST_FAILED": {
    "code": "SYS_002_0040",
    "message": "Failed to request email verification code. Please try again.",
    "status": 500,
    "category": "SYS"
  },
  "SYS_EMAIL_OTP_VERIFY_FAILED": {
    "code": "SYS_002_0041",
    "message": "Failed to verify email code. Please try again.",
    "status": 500,
    "category": "SYS"
  },
  "SYS_SUBMISSION_SAVE_FAILED": {
    "code": "SYS_002_0042",
    "message": "Failed to save submission. Please try again.",
    "status": 500,
    "category": "SYS"
  },
  "REQ_ABORTED": {
    "code": "REQ_ABORTED",
    "message": "Request was cancelled.",
    "status": 0,
    "category": "SYS"
  },
  "RATE_LIMIT_EXCEEDED": {
    "code": "RATE_001_0001",
    "message": "Too many attempts. Please wait a moment.",
    "status": 429,
    "category": "RATE"
  },
  "VAL_METHOD_NOT_ALLOWED": {
    "code": "VAL_003_0007",
    "message": "This action is not available here.",
    "status": 405,
    "category": "VAL"
  },
  "VAL_INVALID_REQUEST_ID": {
    "code": "VAL_003_0003",
    "message": "Invalid request ID format.",
    "status": 400,
    "category": "VAL"
  },
  "VAL_INVALID_IMAGE_ID": {
    "code": "VAL_003_0008",
    "message": "Invalid image identifier.",
    "status": 400,
    "category": "VAL",
    "field": "image_id"
  },
  "VAL_IDEMPOTENCY_CONFLICT": {
    "code": "VAL_003_0009",
    "message": "Idempotency key reuse with a different request payload is not allowed.",
    "status": 409,
    "category": "VAL"
  },
  "VAL_IDEMPOTENCY_KEY_REQUIRED": {
    "code": "VAL_003_0010",
    "message": "Missing required X-Idempotency-Key header.",
    "status": 400,
    "category": "VAL",
    "field": "X-Idempotency-Key"
  },
  "VAL_IDEMPOTENCY_KEY_TOO_LONG": {
    "code": "VAL_003_0011",
    "message": "X-Idempotency-Key must be <= 128 characters.",
    "status": 400,
    "category": "VAL",
    "field": "X-Idempotency-Key"
  },
  "VAL_PARTICIPANT_CREATE_FIELDS_REQUIRED": {
    "code": "VAL_003_0016",
    "message": "Participant creation is missing required fields.",
    "status": 400,
    "category": "VAL",
    "field": "general"
  },
  "VAL_USERNAME_CHECK_REQUIRED": {
    "code": "VAL_003_0017",
    "message": "Username is required.",
    "status": 400,
    "category": "VAL",
    "field": "username"
  },
  "VAL_EMAIL_CHECK_REQUIRED": {
    "code": "VAL_003_0018",
    "message": "Email is required.",
    "status": 400,
    "category": "VAL",
    "field": "email"
  },
  "VAL_CONSENT_PUBLIC_ID_REQUIRED": {
    "code": "VAL_003_0019",
    "message": "Public ID is required to record consent.",
    "status": 400,
    "category": "VAL",
    "field": "public_id"
  },
  "VAL_EMAIL_OTP_REQUEST_FIELDS_REQUIRED": {
    "code": "VAL_003_0021",
    "message": "Public ID and email are required to request an email verification code.",
    "status": 400,
    "category": "VAL",
    "field": "general"
  },
  "VAL_EMAIL_OTP_VERIFY_FIELDS_REQUIRED": {
    "code": "VAL_003_0022",
    "message": "Public ID, email, and verification code are required.",
    "status": 400,
    "category": "VAL",
    "field": "general"
  },
  "VAL_SUBMISSION_PUBLIC_ID_REQUIRED": {
    "code": "VAL_003_0023",
    "message": "Public ID is required to submit a response.",
    "status": 400,
    "category": "VAL",
    "field": "public_id"
  },
  "VAL_SUBMISSION_IMAGE_ID_REQUIRED": {
    "code": "VAL_003_0024",
    "message": "Image ID is required to submit a response.",
    "status": 400,
    "category": "VAL",
    "field": "image_id"
  },
  "VAL_AGE_INVALID": {
    "code": "VAL_001_0004",
    "message": "Age must be between 13 and 100.",
    "status": 400,
    "category": "VAL",
    "field": "age"
  },
  "VAL_GENDER_REQUIRED": {
    "code": "VAL_001_0005",
    "message": "Please select a gender.",
    "status": 400,
    "category": "VAL",
    "field": "gender_code"
  },
  "VAL_LANGUAGE_REQUIRED": {
    "code": "VAL_001_0007",
    "message": "Please select your native language.",
    "status": 400,
    "category": "VAL",
    "field": "language_code"
  },
  "VAL_EXPERIENCE_REQUIRED": {
    "code": "VAL_001_0008",
    "message": "Please select your prior experience.",
    "status": 400,
    "category": "VAL",
    "field": "prior_experience"
  },
  "VAL_EMAIL_INVALID": {
    "code": "VAL_001_0002",
    "message": "Please enter a valid email address.",
    "status": 400,
    "category": "VAL",
    "field": "email"
  },
  "VAL_DESC_LENGTH": {
    "code": "VAL_002_0001",
    "message": "Description must be {min_description_length}-{max_description_length} characters long.",
    "status": 400,
    "category": "VAL",
    "field": "description"
  },
  "VAL_FEEDBACK_LENGTH": {
    "code": "VAL_002_0005",
    "message": "Feedback must be {min_feedback_length}-{max_feedback_length} characters long.",
    "status": 400,
    "category": "VAL",
    "field": "feedback"
  },
  "VAL_RATING_INVALID": {
    "code": "VAL_002_0008",
    "message": "Rating must be between {min_rating} and {max_rating}.",
    "status": 400,
    "category": "VAL",
    "field": "rating"
  },
  "VAL_WORD_COUNT": {
    "code": "VAL_002_0004",
    "message": "At least {min_word_count} words are required.",
    "status": 400,
    "category": "VAL",
    "field": "description"
  },
  "VAL_INVALID_STATE": {
    "code": "VAL_003_0025",
    "message": "Participant is not in a valid stage for this action.",
    "status": 409,
    "category": "VAL",
    "field": "stage"
  },
  "DUP_USERNAME": {
    "code": "DUP_001_0001",
    "message": "This username is already taken.",
    "status": 409,
    "category": "DUP",
    "field": "username"
  },
  "DUP_EMAIL": {
    "code": "DUP_001_0002",
    "message": "This email is already registered.",
    "status": 409,
    "category": "DUP",
    "field": "email"
  },
  "DUP_PUBLIC_ID": {
    "code": "DUP_001_0004",
    "message": "You have already registered.",
    "status": 409,
    "category": "DUP"
  },
  "DUP_SUBMISSION": {
    "code": "DUP_002_0001",
    "message": "You have already described this image.",
    "status": 409,
    "category": "DUP"
  },
  "DUP_SURVEY_ROUND": {
    "code": "DUP_002_0002",
    "message": "You have already completed this survey round.",
    "status": 409,
    "category": "DUP"
  },
  "AUTH_CONSENT_REQUIRED": {
    "code": "AUTH_001_0001",
    "message": "Please agree to the consent terms to continue.",
    "status": 403,
    "category": "AUTH"
  },
  "AUTH_ACCOUNT_FLAGGED": {
    "code": "AUTH_001_0002",
    "message": "Your account has been flagged. Contact support.",
    "status": 403,
    "category": "AUTH"
  },
  "AUTH_EMAIL_OTP_INVALID": {
    "code": "AUTH_003_0001",
    "message": "Invalid verification code. Please try again.",
    "status": 403,
    "category": "AUTH"
  },
  "AUTH_EMAIL_OTP_EXPIRED": {
    "code": "AUTH_003_0002",
    "message": "Verification code expired. Request a new one.",
    "status": 410,
    "category": "AUTH"
  },
  "AUTH_EMAIL_OTP_TOO_MANY": {
    "code": "AUTH_003_0003",
    "message": "Too many attempts. Request a new verification code.",
    "status": 429,
    "category": "AUTH"
  },
  "AUTH_EMAIL_OTP_NOT_FOUND": {
    "code": "AUTH_003_0004",
    "message": "No verification code found. Please request a new one.",
    "status": 404,
    "category": "AUTH"
  },
  "AUTH_EMAIL_OTP_SEND_FAILED": {
    "code": "AUTH_003_0005",
    "message": "Email service is temporarily unavailable. Please try again in a minute.",
    "status": 503,
    "category": "AUTH"
  },
  "AUTH_EMAIL_OTP_SEND_TIMEOUT": {
    "code": "AUTH_003_0009",
    "message": "Email service took too long to respond. Please try again.",
    "status": 504,
    "category": "AUTH"
  },
  "AUTH_EMAIL_OTP_SEND_HTTP_ERROR": {
    "code": "AUTH_003_0010",
    "message": "Email service returned an error. Please try again.",
    "status": 503,
    "category": "AUTH"
  },
  "AUTH_EMAIL_MISMATCH": {
    "code": "AUTH_003_0006",
    "message": "Email does not match your registration details.",
    "status": 403,
    "category": "AUTH",
    "field": "email"
  },
  "AUTH_EMAIL_SAME": {
    "code": "AUTH_003_0007",
    "message": "Please enter a different email address to update.",
    "status": 400,
    "category": "AUTH",
    "field": "email"
  },
  "BOT_PARTICIPANT_CREATE_FAILED": {
    "code": "BOT_001_0002",
    "message": "Human verification failed while creating the participant. Please retry.",
    "status": 403,
    "category": "AUTH"
  },
  "BOT_SUBMISSION_FAILED": {
    "code": "BOT_001_0005",
    "message": "Human verification failed while submitting the response. Please retry.",
    "status": 403,
    "category": "AUTH"
  },
  "NF_ROUTE_NOT_FOUND": {
    "code": "NF_001_0005",
    "message": "Route not found.",
    "status": 404,
    "category": "NF"
  },
  "NF_NO_IMAGES_AVAILABLE": {
    "code": "NF_001_0006",
    "message": "No images are currently available. Please try again later.",
    "status": 404,
    "category": "NF"
  },
  "NF_CONSENT_PARTICIPANT_NOT_FOUND": {
    "code": "NF_001_0012",
    "message": "Participant not found while recording consent.",
    "status": 404,
    "category": "NF"
  },
  "NF_SUBMISSION_PARTICIPANT_NOT_FOUND": {
    "code": "NF_001_0014",
    "message": "Participant not found while submitting the response.",
    "status": 404,
    "category": "NF"
  }
};

export const SHARED_MESSAGES_EN = Object.values(ERROR_CONTRACT || {}).reduce((acc, def) => {
  if (def && typeof def === "object" && def.code && def.message) {
    acc[String(def.code)] = String(def.message);
  }
  return acc;
}, {});

export const SHARED_KEY_TO_CODE = Object.entries(ERROR_CONTRACT || {}).reduce((acc, [key, def]) => {
  if (def && typeof def === "object" && def.code) {
    acc[String(key)] = String(def.code);
  }
  return acc;
}, {});

export const SHARED_CODE_TO_KEY = Object.entries(ERROR_CONTRACT || {}).reduce((acc, [key, def]) => {
  if (def && typeof def === "object" && def.code) {
    acc[String(def.code)] = String(key);
  }
  return acc;
}, {});
