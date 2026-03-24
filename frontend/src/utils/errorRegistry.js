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
    'VAL_003_0001': 'Please fill in all required fields.',
    'VAL_003_0002': 'Invalid request format.',
    'VAL_003_0004': 'Please upload an image file (JPG, PNG, etc.) of your payment screenshot.',
    'VAL_003_0005': 'The file is too large. Please upload a smaller image.',
    'VAL_003_0006': 'Please upload a screenshot of your payment first.',
    'VAL_003_0003': 'Invalid request ID format.',
    'VAL_003_0007': 'This action is not available here.',
    'VAL_003_0008': 'Invalid image identifier.',
    'VAL_003_0009': 'Idempotency key reuse with a different request payload is not allowed.',
    'VAL_003_0010': 'Missing required X-Idempotency-Key header.',
    'VAL_003_0011': 'X-Idempotency-Key must be <= 128 characters.',
    'VAL_003_0012': 'Invalid image data.',
    'VAL_003_0013': 'Public ID is required to create a payment.',
    'VAL_003_0014': 'Invalid file size.',
    'VAL_003_0015': 'Payment token request is missing required fields.',
    'VAL_003_0016': 'Participant creation is missing required fields.',
    'VAL_003_0017': 'Username is required.',
    'VAL_003_0018': 'Email is required.',
    'VAL_003_0019': 'Public ID is required to record consent.',
    'VAL_003_0020': 'Public ID is required to fetch participant payment status.',
    'VAL_003_0021': 'Public ID and email are required to request an email verification code.',
    'VAL_003_0022': 'Public ID, email, and verification code are required.',
    'VAL_003_0023': 'Public ID is required to submit a response.',
    'VAL_003_0024': 'Image ID is required to submit a response.',
    'VAL_003_0025': 'Upload object key is required when no image is uploaded directly.',
    'VAL_003_0026': 'SHA-256 hash is required for payment verification.',
    'VAL_003_0027': 'Upload object key format is invalid.',

    // User detail validation
    'VAL_001_0001': 'Username must be at least 2 characters and contain only letters, numbers, and underscores.',
    'VAL_001_0002': 'Please enter a valid email address from Gmail, Outlook, Hotmail, or iCloud.',
    'VAL_001_0004': 'Age must be between 13 and 100.',
    'VAL_001_0005': 'Please select a gender.',
    'VAL_001_0006': 'Please enter your location.',
    'VAL_001_0007': 'Please select your native language.',
    'VAL_001_0008': 'Please select your prior experience.',
    'VAL_001_0010': 'Username is required (minimum {min} characters).',
    'VAL_001_0011': 'Username can only contain letters, numbers, and underscores (no spaces or special characters).',
    'VAL_001_0012': 'Email is required.',
    'VAL_001_0013': 'Please enter a valid email address.',
    'VAL_001_0014': 'Only Gmail, Outlook, Hotmail, and iCloud email addresses are allowed.',
    'VAL_001_0017': 'Gender is required.',
    'VAL_001_0018': 'Age is required.',
    'VAL_001_0019': 'Age must be between {min} and {max}.',
    'VAL_001_0020': 'Place/Location is required.',
    'VAL_001_0021': 'Native language is required.',
    'VAL_001_0022': 'Prior experience is required.',

    // Content validation
    'VAL_002_0001': 'Description must be 60-10,000 characters long.',
    'VAL_002_0002': 'Description must be at least 60 characters long.',
    'VAL_002_0003': 'Description cannot exceed 10,000 characters.',
    'VAL_002_0004': 'At least {min_words} words are required.',
    'VAL_002_0005': 'Feedback must be 5-2,000 characters long.',
    'VAL_002_0006': 'Feedback must be at least 5 characters long.',
    'VAL_002_0007': 'Feedback cannot exceed 2,000 characters.',
    'VAL_002_0008': 'Rating must be between 1 and 10.',
    'VAL_002_0009': 'Rating must be at least 1.',
    'VAL_002_0010': 'Rating cannot exceed 10.',
    'VAL_002_0011': 'Invalid survey index.',
    
    // =====================================================================
    // DUPLICATE/CONFLICT ERRORS (DUP)
    // =====================================================================
    
    // User registration duplicates
    'DUP_001_0001': 'This username is already taken.',
    'DUP_001_0002': 'This email is already registered.',
    'DUP_001_0004': 'You have already registered.',
    
    // Submission duplicates
    'DUP_002_0001': 'You have already described this image.',
    'DUP_002_0002': 'You have already completed this survey round.',
    
    // Payment duplicates
    'DUP_003_0001': 'This screenshot hash is already linked to another participant. Complete a fresh ₹1 payment and upload the new screenshot.',
    'DUP_003_0002': 'This transaction has already been used.',
    'DUP_003_0003': 'This screenshot was already used by another participant. Please make a fresh payment and upload that success screenshot.',
    
    // =====================================================================
    // AUTH/PERMISSION ERRORS (AUTH)
    // =====================================================================
    
    'AUTH_001_0001': 'Please agree to the consent terms to continue.',
    'AUTH_001_0002': 'Your account has been flagged. Contact support.',
    'AUTH_001_0003': 'This account has been deactivated.',
    'AUTH_002_0001': 'Access denied.',
    'AUTH_002_0002': 'Invalid or expired payment authorization token.',
    'AUTH_002_0003': 'You are not allowed to mint a payment token for this payment.',
    'AUTH_002_0004': 'You are not allowed to verify this payment internally.',
    'AUTH_003_0001': 'Invalid verification code. Please try again.',
    'AUTH_003_0002': 'Verification code expired. Request a new one.',
    'AUTH_003_0003': 'Too many attempts. Request a new verification code.',
    'AUTH_003_0004': 'No verification code found. Please request a new one.',
    'AUTH_003_0005': 'Email service is temporarily unavailable. Please try again in a minute.',
    'AUTH_003_0006': 'Email does not match your registration details.',
    'AUTH_003_0007': 'Please enter a different email address to update.',
    'AUTH_003_0008': 'Please verify your email before submitting.',
    'AUTH_003_0009': 'Email service took too long to respond. Please try again.',
    'AUTH_003_0010': 'Email service returned an error. Please try again.',
    'BOT_001_0001': 'Human verification failed. Please retry.',
    'BOT_001_0002': 'Human verification failed while creating the participant. Please retry.',
    'BOT_001_0003': 'Human verification failed while creating the payment. Please retry.',
    'BOT_001_0004': 'Human verification failed while verifying the payment. Please retry.',
    'BOT_001_0005': 'Human verification failed while submitting the response. Please retry.',
    
    // =====================================================================
    // NOT FOUND ERRORS (NF)
    // =====================================================================
    
    'NF_001_0001': 'Account not found. Please register first.',
    'NF_001_0002': 'Image not found.',
    'NF_001_0003': 'Payment not found.',
    'NF_001_0004': 'Consent record not found.',
    'NF_001_0005': 'Route not found.',
    'NF_001_0006': 'No images are currently available. Please try again later.',
    'NF_001_0007': 'Participant not found for payment creation.',
    'NF_001_0008': 'Payment not found for QR generation.',
    'NF_001_0009': 'Payment status could not be found.',
    'NF_001_0010': 'Payment not found for verification.',
    'NF_001_0011': 'Payment not found for internal verification.',
    'NF_001_0012': 'Participant not found while recording consent.',
    'NF_001_0013': 'Participant not found while fetching payment status.',
    'NF_001_0014': 'Participant not found while submitting the response.',
    
    // =====================================================================
    // PAYMENT ERRORS (PAY)
    // =====================================================================
    
    'PAY_001_0001': 'Payment session expired. Please start a new payment.',
    'PAY_001_0002': 'This payment cannot be processed right now.',
    'PAY_001_0003': 'Invalid payment amount.',
    'PAY_001_0004': 'This payment has already been processed.',
    'PAY_001_0005': 'Invalid image format. Please upload JPG, PNG, or WEBP.',
    'PAY_001_0006': 'Invalid file hash.',
    'PAY_001_0007': 'Payment not verified. Please complete payment first.',
    'PAY_001_0008': 'Maximum verification attempts reached. Please create a new payment session.',
    
    // =====================================================================
    // FRAUD DETECTION ERRORS (FRAUD)
    // =====================================================================
    
    // Image quality issues
    'FRAUD_001_0001': 'Screenshot is too blurry. Please upload a clearer image.',
    'FRAUD_001_0002': 'Could not read the screenshot text. Please retake.',
    'FRAUD_001_0003': 'Please use Google Pay, Paytm, or BHIM.',
    'FRAUD_001_0004': 'Payment was not made to the correct beneficiary.',
    'FRAUD_001_0005': 'Payment amount must be exactly ₹1.',
    'FRAUD_001_0006': 'Payment time is outside the allowed 5-minute window. Please upload a recent screenshot.',
    'FRAUD_001_0007': 'Could not read payment date/time from screenshot. Please upload a clearer screenshot.',
    'FRAUD_001_0008': 'Payment time was not found in the screenshot.',
    
    // Payment mismatch issues
    'FRAUD_002_0001': 'Payment was not made to the correct UPI ID.',
    'FRAUD_002_0002': 'Payment note does not match. Use the exact note shown.',
    'FRAUD_002_0003': 'Payment amount must be exactly ₹1.',
    'FRAUD_002_0004': 'A successful payment was not detected in the screenshot.',
    'FRAUD_002_0005': 'Payment appears to have failed. Check your UPI app.',
    'FRAUD_002_0007': 'Payment timestamp could not be verified. Please upload a recent screenshot.',
    'FRAUD_002_0008': 'Screenshot does not appear to be a UPI payment.',
    'FRAUD_002_0009': 'Payment recipient details were not found in the screenshot.',
    'FRAUD_002_0010': 'Payment date/time was not found in the screenshot.',
    
    // Reuse detection
    'FRAUD_003_0001': 'This screenshot belongs to another participant. Please complete a fresh payment and upload a new screenshot.',
    'FRAUD_003_0002': 'This screenshot was previously rejected and cannot be reused. Upload a fresh screenshot from a new successful payment.',
    'FRAUD_003_0004': 'You already submitted this screenshot in your account. Upload a screenshot from a new payment attempt.',
    
    // =====================================================================
    // SYSTEM ERRORS (SYS)
    // =====================================================================
    
    'SYS_001_0001': 'Something went wrong. Please try again.',
    'SYS_001_0002': 'Database error occurred. Please try again later.',
    'SYS_001_0003': 'Service temporarily unavailable. Please try later.',
    'SYS_001_0004': 'Configuration error. Please contact support.',
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
    'SYS_002_0024': 'Service degraded.',
    'SYS_002_0025': 'Payment creation failed. Please try again.',
    'SYS_002_0026': 'Failed to load payment QR. Please retry.',
    'SYS_002_0027': 'Failed to prepare upload URL. Please try again.',
    'SYS_002_0028': 'Payment verification failed. Please try again.',
    'SYS_002_0029': 'Failed to save payment screenshot.',
    'SYS_002_0030': 'Failed to select a fallback image.',
    'SYS_002_0031': 'Failed to load the next image. Please try again.',
    'SYS_002_0032': 'Failed to fetch payment status. Please try again.',
    'SYS_002_0033': 'Failed to mint payment token. Please try again.',
    'SYS_002_0034': 'Failed to access payment verification state. Please try again.',
    'SYS_002_0035': 'Failed to check username availability. Please try again.',
    'SYS_002_0036': 'Failed to check email availability. Please try again.',
    'SYS_002_0037': 'Failed to record consent. Please try again.',
    'SYS_002_0038': 'Failed to fetch participant payment status. Please try again.',
    'SYS_002_0039': 'Failed to load participant options. Please try again.',
    'SYS_002_0040': 'Failed to request email verification code. Please try again.',
    'SYS_002_0041': 'Failed to verify email code. Please try again.',
    'SYS_002_0042': 'Failed to save submission. Please try again.',
    
    // =====================================================================
    // RATE LIMIT ERRORS (RATE)
    // =====================================================================
    
    'RATE_001_0001': 'Too many attempts. Please wait a moment.',
    'RATE_001_0002': 'Rate limit exceeded. Please slow down.',

    // UPI pool capacity / limits (payment allocator)
    'PAY_001_0009': 'Daily UPI limit reached. Please try again after 24 hours.',
    'PAY_001_0010': 'Too many payment attempts from your device. Please try again later.',
    'PAY_001_0011': 'Too many payment attempts in this session. Please try again later.',
    'PAY_001_0024': 'Payment amount is invalid for payment creation.',
    'PAY_001_0012': 'Payment QR cannot be generated for the current payment state.',
    'PAY_001_0013': 'Payment token cannot be minted for the current payment state.',
    'PAY_001_0014': 'Submission is not allowed in the current payment workflow state.',
    'PAY_001_0015': 'Payment expired before verification state could be updated.',
    'PAY_001_0016': 'Payment verification cannot continue from the current payment state.',
    'PAY_001_0017': 'Payment verification attempts exceeded, but state update failed.',
    'PAY_001_0018': 'Payment could not enter processing state for verification.',
    'PAY_001_0019': 'Payment could not be finalized as successful.',
    'PAY_001_0020': 'Payment could not be finalized as rejected.',
    'PAY_001_0021': 'Internal payment verification cannot start from the current payment state.',
    'PAY_001_0022': 'Internal payment verification could not be finalized.',
    'PAY_001_0023': 'Stored payment amount is invalid.',
    
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
    const pattern = new RegExp(`\\{${key}\\}`, "g");
    message = message.replace(pattern, String(params[key]));
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
