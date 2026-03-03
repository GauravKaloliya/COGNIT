/**
 * Standardized error code mappings for frontend display.
 * These should match the ERROR_CODES defined in the backend.
 * 
 * @deprecated Use errorRegistry.js instead for new code.
 * This file is kept for backward compatibility.
 */

import { 
  getErrorMessage, 
  parseErrorResponse, 
  ERROR_CATEGORIES
} from './errorRegistry';

// Re-export from errorRegistry for backward compatibility
export { 
  getErrorMessage, 
  parseErrorResponse, 
  ERROR_CATEGORIES
};

// Legacy export for backward compatibility
export const ERROR_MESSAGES = {
  // General errors
  'ERR_DATABASE': 'Something went wrong on our end. Please try again later.',
  'ERR_INTERNAL': 'An unexpected error occurred. Please try again.',
  'ERR_RATE_LIMIT': 'Too many requests. Please slow down and try again.',
  
  // Validation errors
  'ERR_MISSING_FIELDS': 'Some required information is missing. Please check your input.',
  'ERR_INVALID_FORMAT': 'The data format is incorrect. Please check your input.',
  'ERR_INVALID_UUID': 'Invalid identifier format. Please refresh the page and try again.',
  
  // Participant errors
  'ERR_PARTICIPANT_NOT_FOUND': 'We couldn\'t find your registration. Please complete the registration form first.',
  'ERR_PARTICIPANT_EXISTS': 'Username, email, or phone number is already registered. Please use different details.',
  'ERR_CONSENT_REQUIRED': 'Consent is required to continue. Please complete the consent process.',
  'ERR_FLAGGED_ACCOUNT': 'Your account has been flagged due to low attention scores.',
  
  // Submission errors
  'ERR_DESC_LENGTH': 'Description must be between 60 and 10,000 characters.',
  'ERR_FEEDBACK_LENGTH': 'Feedback must be between 5 and 2,000 characters.',
  'ERR_RATING_INVALID': 'Please select a rating between 1 and 10.',
  'ERR_WORD_COUNT': 'Your description needs more words. Please write at least 60 words.',
  'ERR_DUPLICATE_SUBMISSION': 'You have already submitted a description for this image.',
  'ERR_SURVEY_EXISTS': 'This survey round has already been submitted.',
  
  // Payment errors
  'ERR_PAYMENT_NOT_FOUND': 'Payment session not found. Please create a new payment.',
  'ERR_PAYMENT_EXPIRED': 'Payment session has expired. Please create a new payment.',
  'ERR_PAYMENT_INVALID_STATE': 'This payment has already been processed or is no longer valid.',
  'ERR_INVALID_AMOUNT': 'Invalid payment amount.',
  'ERR_INVALID_IMAGE_TYPE': 'Invalid image format. Please upload JPG, PNG, or WEBP.',
  'ERR_INVALID_SHA256': 'Invalid file hash. Please try uploading again.',
  
  // Fraud detection errors
  'ERR_DUPLICATE_IMAGE': 'This screenshot has already been uploaded by another user. Please use a fresh payment screenshot.',
  'ERR_DUPLICATE_IMAGE_SELF': 'You already submitted this screenshot. Please use a new payment screenshot.',
  'ERR_REJECTED_REUSE': 'This screenshot was previously rejected. Please use a fresh payment screenshot.',
  'ERR_PAYMENT_REJECTED': 'Payment screenshot could not be verified. Please ensure you are using a valid UPI app and the screenshot shows a successful transaction.',
  
  // Image errors
  'ERR_NO_IMAGES': 'No images are currently available. Please try again later.',
  'ERR_IMAGE_NOT_FOUND': 'Image not found.',
  'ERR_INVALID_IMAGE_ID': 'Invalid image identifier.',
};

/**
 * Extract error code from API error response.
 * Supports both old format {error: "message"} and new format {error: {code: "...", message: "..."}}.
 * 
 * @param {Error|Response|Object} error - The error object from API call
 * @returns {string|null} - The error code or null if not found
 */
export function extractErrorCode(error) {
  if (!error) return null;
  
  // Handle new format error objects
  if (error.error?.code) {
    return error.error.code;
  }
  
  // Handle old format string errors
  if (typeof error.error === 'string') {
    // Try to map common error messages to codes for backward compatibility
    const message = error.error.toLowerCase();
    if (message.includes('participant not found') || message.includes('not found or deleted')) {
      return 'ERR_PARTICIPANT_NOT_FOUND';
    }
    if (message.includes('consent required')) {
      return 'ERR_CONSENT_REQUIRED';
    }
    if (message.includes('flagged')) {
      return 'ERR_FLAGGED_ACCOUNT';
    }
    if (message.includes('already registered') || message.includes('already exists')) {
      return 'ERR_PARTICIPANT_EXISTS';
    }
    if (message.includes('expired')) {
      return 'ERR_PAYMENT_EXPIRED';
    }
    if (message.includes('words required')) {
      return 'ERR_WORD_COUNT';
    }
    if (message.includes('description must be')) {
      return 'ERR_DESC_LENGTH';
    }
    if (message.includes('feedback')) {
      return 'ERR_FEEDBACK_LENGTH';
    }
    if (message.includes('rating')) {
      return 'ERR_RATING_INVALID';
    }
    if (message.includes('duplicate') || message.includes('already submitted')) {
      return 'ERR_DUPLICATE_SUBMISSION';
    }
  }
  
  return null;
}

/**
 * Get user-friendly error message from API error.
 * 
 * @param {Error|Object} error - The error from API call
 * @param {string} defaultMessage - Fallback message if error code not found
 * @returns {string} - User-friendly error message
 */
export function getErrorMessageFromCode(error, defaultMessage = 'Something went wrong. Please try again.') {
  // If it's a network error
  if (error?.message?.includes('network') || error?.message?.includes('fetch')) {
    return 'We\'re having trouble connecting. Please check your internet connection and try again.';
  }
  
  // If it's a timeout
  if (error?.message?.includes('timeout')) {
    return 'The request took too long. Please try again.';
  }
  
  const code = extractErrorCode(error);
  if (code && ERROR_MESSAGES[code]) {
    return ERROR_MESSAGES[code];
  }
  
  // Return the error message directly if available
  if (error?.error?.message) {
    return error.error.message;
  }
  
  if (error?.message) {
    return error.message;
  }
  
  return defaultMessage;
}

/**
 * Parse API response and extract error information.
 * 
 * @param {Response} response - Fetch API response object
 * @returns {Promise<{ok: boolean, error: Object|null, data: any}>}
 */
export async function parseApiResponse(response) {
  const data = await response.json().catch(() => null);
  
  if (!response.ok) {
    return {
      ok: false,
      error: data || { error: { code: 'ERR_INTERNAL', message: 'Request failed' } },
      data: null
    };
  }
  
  return {
    ok: true,
    error: null,
    data
  };
}

/**
 * Handle API error and return user-friendly message.
 * This is a convenience function for consistent error handling.
 * 
 * @param {Error|Object} error - The error from API call
 * @param {Object} options - Options for error handling
 * @param {string} options.context - Context where error occurred (for logging)
 * @param {Function} options.onError - Callback for error handling
 * @returns {string} - User-friendly error message
 */
export function handleApiError(error, options = {}) {
  const { context, onError } = options;
  
  if (context) {
    console.error(`Error in ${context}:`, error);
  }
  
  const message = getErrorMessageFromCode(error);
  
  if (onError) {
    onError(message, error);
  }
  
  return message;
}
