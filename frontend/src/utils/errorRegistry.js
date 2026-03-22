import sharedErrorContract from "./error_contract.json";
import { runtimeConfig } from "../config/runtime";

/**
 * Centralized Error Registry
 * Maps backend error codes to user-friendly messages
 * Supports multiple languages and automatic translation
 */

const DEFAULT_LANGUAGE = 'en';
const SHARED_MESSAGES_EN = Object.values(sharedErrorContract || {}).reduce((acc, def) => {
  if (def && typeof def === "object" && def.code && def.message) {
    acc[String(def.code)] = String(def.message);
  }
  return acc;
}, {});

// Error message translations
const TRANSLATIONS = {
  en: {
    // =====================================================================
    // VALIDATION ERRORS (VAL)
    // =====================================================================
    
    // Field requirements
    'VAL_003_0001': 'Please fill in all required fields',
    'VAL_003_0002': 'Invalid request ID format',
    'VAL_003_0004': 'Please upload an image file (JPG, PNG, etc.) of your payment screenshot.',
    'VAL_003_0005': 'The file is too large. Please upload a smaller image.',
    'VAL_003_0006': 'Please upload a screenshot of your payment first.',
    'VAL_003_0003': 'Invalid request ID format',
    'VAL_003_0007': 'This action is not allowed for this API route',

    // User detail validation
    'VAL_001_0001': 'Username must be at least 2 characters and contain only letters, numbers, and underscores',
    'VAL_001_0002': 'Please enter a valid email address from Gmail, Outlook, Hotmail, or iCloud',
    'VAL_001_0003': 'Please enter a valid 10-digit Indian mobile number',
    'VAL_001_0004': 'Age must be between 13 and 100',
    'VAL_001_0005': 'Please select a gender',
    'VAL_001_0006': 'Please enter your location',
    'VAL_001_0007': 'Please select your native language',
    'VAL_001_0008': 'Please select your prior experience',
    'VAL_001_0010': 'Username is required (min {min} characters)',
    'VAL_001_0011': 'Username can only contain letters, numbers, and underscores (no spaces or special characters)',
    'VAL_001_0012': 'Email is required',
    'VAL_001_0013': 'Please enter a valid email address',
    'VAL_001_0014': 'Only Gmail, Outlook, Hotmail, and iCloud email addresses are allowed',
    'VAL_001_0015': 'Phone number is required',
    'VAL_001_0016': 'Please enter a valid 10-digit Indian mobile number',
    'VAL_001_0017': 'Gender is required',
    'VAL_001_0018': 'Age is required',
    'VAL_001_0019': 'Age must be between {min} and {max}',
    'VAL_001_0020': 'Place/Location is required',
    'VAL_001_0021': 'Native language is required',
    'VAL_001_0022': 'Prior experience is required',

    // Content validation
    'VAL_002_0001': 'Description must be 60-10,000 characters',
    'VAL_002_0002': 'Description must be at least 60 characters',
    'VAL_002_0003': 'Description cannot exceed 10,000 characters',
    'VAL_002_0004': 'At least {min_words} words required (you wrote {actual})',
    'VAL_002_0005': 'Feedback must be 5-2,000 characters',
    'VAL_002_0006': 'Feedback must be at least 5 characters',
    'VAL_002_0007': 'Feedback cannot exceed 2,000 characters',
    'VAL_002_0008': 'Rating must be between 1 and 10',
    'VAL_002_0009': 'Rating must be at least 1',
    'VAL_002_0010': 'Rating cannot exceed 10',
    'VAL_002_0011': 'Invalid survey index',
    
    // =====================================================================
    // DUPLICATE/CONFLICT ERRORS (DUP)
    // =====================================================================
    
    // User registration duplicates
    'DUP_001_0001': 'This username is already taken',
    'DUP_001_0002': 'This email is already registered',
    'DUP_001_0003': 'This phone number is already registered',
    'DUP_001_0004': 'You have already registered',
    
    // Submission duplicates
    'DUP_002_0001': 'You have already described this image',
    'DUP_002_0002': 'You have already completed this survey round',
    
    // Payment duplicates
    'DUP_003_0001': 'This screenshot hash is already linked to another participant. Complete a fresh ₹1 payment and upload the new screenshot.',
    'DUP_003_0002': 'This transaction has already been used',
    'DUP_003_0003': 'This screenshot was already used by another participant. Please make a fresh payment and upload that success screenshot.',
    
    // =====================================================================
    // AUTH/PERMISSION ERRORS (AUTH)
    // =====================================================================
    
    'AUTH_001_0001': 'Please agree to the consent terms to continue',
    'AUTH_001_0002': 'Your account has been flagged. Contact support.',
    'AUTH_001_0003': 'Account has been deactivated',
    'AUTH_002_0001': 'Access denied',
    'AUTH_002_0002': 'Invalid or expired payment authorization token.',
    'AUTH_003_0001': 'Invalid verification code. Please try again.',
    'AUTH_003_0002': 'Verification code expired. Request a new one.',
    'AUTH_003_0003': 'Too many attempts. Request a new verification code.',
    'AUTH_003_0004': 'No verification code found. Please request a new one.',
    'AUTH_003_0005': 'Email service is temporarily unavailable. Please try again in a minute.',
    'AUTH_003_0006': 'Email does not match your registration details.',
    'AUTH_003_0007': 'Please enter a different email address to update.',
    'AUTH_003_0009': 'Email service took too long to respond. Please try again.',
    'AUTH_003_0010': 'Email service returned an error. Please try again.',
    'BOT_001_0001': 'Human verification failed. Please retry.',
    
    // =====================================================================
    // NOT FOUND ERRORS (NF)
    // =====================================================================
    
    'NF_001_0001': 'Account not found. Please register first.',
    'NF_001_0002': 'Image not found',
    'NF_001_0003': 'Payment not found',
    'NF_001_0004': 'Consent record not found',
    'NF_001_0005': 'Route not found',
    
    // =====================================================================
    // PAYMENT ERRORS (PAY)
    // =====================================================================
    
    'PAY_001_0001': 'Payment session expired. Please start a new payment.',
    'PAY_001_0002': 'Payment cannot be processed in current state',
    'PAY_001_0003': 'Invalid payment amount',
    'PAY_001_0004': 'Payment has already been processed',
    'PAY_001_0005': 'Please complete payment before accessing the survey.',
    'PAY_001_0006': 'Invalid file hash',
    'PAY_001_0007': 'Payment not verified. Please complete payment first.',
    'PAY_001_0008': 'Maximum verification attempts reached. Please create a new payment session.',
    
    // =====================================================================
    // FRAUD DETECTION ERRORS (FRAUD)
    // =====================================================================
    
    // Image quality issues
    'FRAUD_001_0001': 'Screenshot is too blurry. Please upload a clearer image.',
    'FRAUD_001_0002': 'Could not read the screenshot text. Please retake.',
    'FRAUD_001_0003': 'Please use Google Pay, Paytm, or BHIM',
    'FRAUD_001_0004': 'Payment not made to correct beneficiary',
    'FRAUD_001_0005': 'Payment amount must be exactly ₹1',
    'FRAUD_001_0006': 'Payment time is outside the allowed 5-minute window. Please upload a recent screenshot.',
    'FRAUD_001_0007': 'Could not read payment date/time from screenshot. Please upload a clearer screenshot.',
    'FRAUD_001_0008': 'Payment time not found in screenshot',
    
    // Payment mismatch issues
    'FRAUD_002_0001': 'Payment not made to correct UPI ID',
    'FRAUD_002_0002': 'Payment note does not match. Use the exact note shown.',
    'FRAUD_002_0003': 'Payment amount must be exactly ₹1',
    'FRAUD_002_0004': 'Payment success not detected in screenshot',
    'FRAUD_002_0005': 'Payment appears to have failed. Check your UPI app.',
    'FRAUD_002_0007': 'Payment timestamp could not be verified. Please upload a recent screenshot.',
    'FRAUD_002_0008': 'Payment time is outside the allowed window. Please upload a recent screenshot.',
    'FRAUD_002_0009': 'Payment screenshot verification failed. Use Google Pay/Paytm/BHIM, pay exactly ₹1 to COGNIT, and upload a clear success screenshot.',
    'FRAUD_002_0010': 'Payment date/time not found in screenshot',
    
    // Reuse detection
    'FRAUD_003_0001': 'This screenshot belongs to another participant. Please complete a fresh payment and upload a new screenshot.',
    'FRAUD_003_0002': 'This screenshot was previously rejected and cannot be reused. Upload a fresh screenshot from a new successful payment.',
    'FRAUD_003_0004': 'You already submitted this screenshot in your account. Upload a screenshot from a new payment attempt.',
    
    // =====================================================================
    // SYSTEM ERRORS (SYS)
    // =====================================================================
    
    'SYS_001_0001': 'Something went wrong. Please try again.',
    'SYS_001_0002': 'Database error occurred. Please try again later.',
    'SYS_001_0003': 'Image processing failed. Please try a different image.',
    'SYS_001_0004': 'Service temporarily unavailable. Please try later.',
    'SYS_001_0005': 'Internal server error. Our team has been notified.',
    'SYS_002_0001': 'Unable to reach the server. Please check your connection and try again.',
    'SYS_002_0002': 'Failed to record consent. Please try again.',
    'SYS_002_0003': 'System is not ready. Please wait for the connection to be established.',
    'SYS_002_0004': 'Image not loaded properly. Please wait or refresh.',
    'SYS_002_0005': 'Image failed to load.',
    'SYS_002_0006': 'Submission failed. Please try again.',
    'SYS_002_0007': 'Unable to connect to server. Please check your internet connection and try again.',
    'SYS_002_0008': 'The request took too long. Please try again.',
    'SYS_002_0009': 'We couldn\'t create the payment. Please try again.',
    'SYS_002_0010': 'We couldn\'t find your registration details. Please go back and complete the registration form.',
    'SYS_002_0011': 'We couldn\'t find your payment details. Please try again.',
    'SYS_002_0012': 'Payment verification failed due to a system error. Please try again or contact support if the problem persists.',
    'SYS_002_0013': 'Payment verification failed. Please try again.',
    'SYS_002_0014': 'Payment verification failed ({code}). Please try again or contact support if the problem persists.',
    'SYS_002_0015': 'Failed to load first survey image. Please try again.',
    'SYS_002_0016': 'Failed to load image. Please try again.',
    'SYS_002_0017': 'Unexpected error occurred.',
    'SYS_002_0018': 'Waiting for image to load...',
    'SYS_002_0019': 'Server returned an error (HTTP {status}). Please try again later.',
    'SYS_002_0020': 'Service degraded: {error}',
    'SYS_002_0021': 'The system is currently degraded. Please try again later.',
    'SYS_002_0022': 'Failed to create participant. Please try again.',
    'SYS_002_0023': 'Please refresh the page to continue.',
    
    // =====================================================================
    // RATE LIMIT ERRORS (RATE)
    // =====================================================================
    
    'RATE_001_0001': 'Too many attempts. Please wait a moment.',
    'RATE_001_0002': 'Rate limit exceeded. Please slow down.',

    // UPI pool capacity / limits (payment allocator)
    'PAY_001_0009': 'Daily UPI limit reached. Please try again after 24 hours.',
    'PAY_001_0010': 'Too many payment attempts from your device. Please try again later.',
    'PAY_001_0011': 'Too many payment attempts in this session. Please try again later.',
    
    // =====================================================================
    // LEGACY ERROR MAPPINGS (for backward compatibility)
    // =====================================================================
    
    'ERR_DATABASE': 'Something went wrong on our end. Please try again later.',
    'ERR_INTERNAL': 'An unexpected error occurred. Please try again.',
    'ERR_RATE_LIMIT': 'Too many requests. Please slow down and try again.',
    'ERR_MISSING_FIELDS': 'Some required information is missing. Please check your input.',
    'ERR_INVALID_FORMAT': 'The data format is incorrect. Please check your input.',
    'ERR_INVALID_UUID': 'Invalid identifier format. Please refresh the page and try again.',
    'ERR_PARTICIPANT_NOT_FOUND': 'We couldn\'t find your registration. Please complete the registration form first.',
    'ERR_PARTICIPANT_EXISTS': 'Username, email, or phone number is already registered. Please use different details.',
    'ERR_CONSENT_REQUIRED': 'Consent is required to continue. Please complete the consent process.',
    'ERR_FLAGGED_ACCOUNT': 'Your account has been flagged due to low attention scores.',
    'ERR_DESC_LENGTH': 'Description must be between 60 and 10,000 characters.',
    'ERR_FEEDBACK_LENGTH': 'Feedback must be between 5 and 2,000 characters.',
    'ERR_RATING_INVALID': 'Please select a rating between 1 and 10.',
    'ERR_WORD_COUNT': 'Your description needs more words. Please write at least 60 words.',
    'ERR_DUPLICATE_SUBMISSION': 'You have already submitted a description for this image.',
    'ERR_SURVEY_EXISTS': 'This survey round has already been submitted.',
    'ERR_PAYMENT_NOT_FOUND': 'Payment session not found. Please create a new payment.',
    'ERR_PAYMENT_EXPIRED': 'Payment session has expired. Please create a new payment.',
    'ERR_PAYMENT_INVALID_STATE': 'This payment has already been processed or is no longer valid.',
    'ERR_INVALID_AMOUNT': 'Invalid payment amount.',
    'ERR_INVALID_IMAGE_TYPE': 'Invalid image format. Please upload JPG, PNG, or WEBP.',
    'ERR_INVALID_SHA256': 'Invalid file hash. Please try uploading again.',
    'ERR_DUPLICATE_IMAGE': 'This screenshot has already been uploaded by another user. Please use a fresh payment screenshot.',
    'ERR_DUPLICATE_IMAGE_SELF': 'You already submitted this screenshot. Please use a new payment screenshot.',
    'ERR_REJECTED_REUSE': 'This screenshot was previously rejected. Please use a fresh payment screenshot.',
    'ERR_PAYMENT_REJECTED': 'Payment screenshot could not be verified. Please ensure you are using a valid UPI app and the screenshot shows a successful transaction.',
    'ERR_NO_IMAGES': 'No images are currently available. Please try again later.',
    'ERR_IMAGE_NOT_FOUND': 'Image not found.',
    'ERR_INVALID_IMAGE_ID': 'Invalid image identifier.',
  },
  
  hi: {
    // Hindi translations for key errors
    'VAL_003_0001': 'कृपया सभी आवश्यक फ़ील्ड भरें',
    'DUP_001_0001': 'यह username पहले से लिया गया है',
    'DUP_001_0002': 'यह email पहले से registered है',
    'AUTH_001_0001': 'जारी रखने के लिए कृपया सहमति दें',
    'NF_001_0001': 'Account नहीं मिला। कृपया पहले register करें।',
    'PAY_001_0001': 'Payment session expire हो गया है। कृपया नया payment शुरू करें।',
    'FRAUD_001_0001': 'Screenshot बहुत blur है। कृपया साफ़ image upload करें।',
    'SYS_001_0001': 'कुछ गलत हो गया। कृपया फिर से प्रयास करें।',
    'RATE_001_0001': 'बहुत many attempts। कृपया थोड़ा इंतज़ार करें।',
    
    // Legacy Hindi translations
    'ERR_DATABASE': 'हमारी तरफ़ से कुछ गलत हुआ। कृपया बाद में फिर से प्रयास करें।',
    'ERR_RATE_LIMIT': 'बहुत सारे requests। कृपया धीरे-धीरे करें।',
    'ERR_PARTICIPANT_NOT_FOUND': 'हमें आपका registration नहीं मिला। कृपया form भरें।',
    'ERR_CONSENT_REQUIRED': 'जारी रखने के लिए consent जरूरी है।',
    'ERR_FLAGGED_ACCOUNT': 'आपका account flag हो गया है।',
    'ERR_WORD_COUNT': 'आपके description में और words चाहिए। कम से कम 60 शब्द लिखें।',
    'ERR_DUPLICATE_SUBMISSION': 'आपने इस image का description पहले ही दे दिया है।',
    'ERR_PAYMENT_EXPIRED': 'Payment session expire हो गया है।',
  }
};

// Error categories with severity levels and suggested actions
export const ERROR_CATEGORIES = {
  VAL: { severity: 'warning', action: 'fix_input' },
  DUP: { severity: 'warning', action: 'change_input' },
  AUTH: { severity: 'error', action: 'reauthenticate' },
  NF: { severity: 'error', action: 'redirect' },
  PAY: { severity: 'warning', action: 'retry_payment' },
  FRAUD: { severity: 'error', action: 'retry_payment' },
  SYS: { severity: 'error', action: 'retry' },
  RATE: { severity: 'warning', action: 'wait' },
  ERR: { severity: 'error', action: 'retry' }, // Legacy category
};

/**
 * Check if error code exists
 */
export function hasErrorCode(errorCode) {
  return !!TRANSLATIONS.en[errorCode];
}

/**
 * Get error message for a code
 */
export function getErrorMessage(errorCode, lang = DEFAULT_LANGUAGE, params = {}) {
  const messages = TRANSLATIONS[lang] || TRANSLATIONS[DEFAULT_LANGUAGE];
  let message =
    messages[errorCode] ||
    (lang === DEFAULT_LANGUAGE ? SHARED_MESSAGES_EN[errorCode] : null) ||
    messages['SYS_001_0001'] ||
    SHARED_MESSAGES_EN['SYS_001_0001'] ||
    'An error occurred';
  
  // Replace template variables
  Object.keys(params).forEach(key => {
    message = message.replace(`{${key}}`, params[key]);
  });

  const paymentAmount = Number(runtimeConfig.paymentAmount);
  const rewardAmount = Number(runtimeConfig.rewardAmount);
  if (Number.isFinite(paymentAmount)) {
    message = message.replace(/₹1\b/g, `₹${paymentAmount}`);
  }
  if (Number.isFinite(rewardAmount)) {
    message = message.replace(/₹10\b/g, `₹${rewardAmount}`);
  }
  
  return message;
}

/**
 * Parse error response from backend
 */
export function parseErrorResponse(response) {
  if (!response) {
    return {
      code: 'SYS_001_0001',
      message: getErrorMessage('SYS_001_0001'),
      category: 'SYS',
      severity: 'error',
      action: 'retry'
    };
  }

  // Handle non-standard backend payloads gracefully.
  if (!response.error) {
    const fallbackMessage =
      response.message ||
      response.error_message ||
      response.detail ||
      getErrorMessage('SYS_001_0001');
    const fallbackCode = response.code || 'SYS_001_0001';
    const fallbackCategory = String(fallbackCode).split('_')[0] || 'SYS';
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
      timestamp: new Date().toISOString()
    };
  }
  
  const { code, message, field, fields, details, category: serverCategory, http_status, retryable, request_id } = response.error;
  const category = serverCategory || code?.split('_')[0] || 'SYS';
  const categoryInfo = ERROR_CATEGORIES[category] || ERROR_CATEGORIES.SYS;
  const mappedMessage = code && hasErrorCode(code) ? getErrorMessage(code) : null;
  
  return {
    code,
    message: mappedMessage || message || getErrorMessage('SYS_001_0001'),
    originalMessage: message,
    category,
    field,
    fields,
    details,
    status: http_status,
    retryable,
    requestId: request_id,
    severity: categoryInfo.severity,
    action: categoryInfo.action,
    timestamp: new Date().toISOString()
  };
}

/**
 * Get all available error codes by category
 */
export function getErrorCodesByCategory() {
  const codes = {};
  
  Object.keys(TRANSLATIONS.en).forEach(code => {
    const category = code.split('_')[0];
    if (!codes[category]) {
      codes[category] = [];
    }
    codes[category].push({
      code,
      message: TRANSLATIONS.en[code]
    });
  });
  
  return codes;
}

/**
 * Get language list
 */
export function getAvailableLanguages() {
  return Object.keys(TRANSLATIONS).map(lang => ({
    code: lang,
    name: lang === 'en' ? 'English' : lang === 'hi' ? 'हिन्दी' : lang
  }));
}

export default {
  getErrorMessage,
  parseErrorResponse,
  getErrorCodesByCategory,
  hasErrorCode,
  getAvailableLanguages,
  ERROR_CATEGORIES,
  DEFAULT_LANGUAGE
};
