import { getApiUrl } from './apiBase';
import { parseErrorResponse, getErrorMessage } from './errorRegistry';

/**
 * Enhanced fetch wrapper with standardized error handling
 */
export async function apiFetch(endpoint, options = {}) {
  const url = getApiUrl(endpoint);
  const requestId = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-Request-ID': requestId,
        ...options.headers
      }
    });
    
    const data = await response.json().catch(() => null);
    
    if (!response.ok) {
      if (!data && response.status === 413) {
        const error = new Error(getErrorMessage('VAL_003_0005'));
        error.code = 'VAL_003_0005';
        error.category = 'VAL';
        error.severity = 'warning';
        error.action = 'fix_input';
        error.status = response.status;
        throw error;
      }

      const parsedError = parseErrorResponse(data);
      
      // Create Error object with extra properties
      const error = new Error(parsedError.message);
      error.code = parsedError.code;
      error.category = parsedError.category;
      error.severity = parsedError.severity;
      error.action = parsedError.action;
      error.field = parsedError.field;
      error.fields = parsedError.fields;
      error.status = response.status;
      error.details = parsedError.details;
      error.originalMessage = parsedError.originalMessage;
      error.requestId = parsedError.requestId || response.headers.get('X-Request-ID') || requestId;
      
      throw error;
    }
    
    return data;
  } catch (error) {
    // Network errors or other fetch failures
    if (!error.code) {
      error.code = 'SYS_002_0007';
      error.category = 'SYS';
      error.severity = 'error';
      error.action = 'retry';
      error.message = getErrorMessage('SYS_002_0007');
    }
    if (!error.requestId) {
      error.requestId = requestId;
    }
    throw error;
  }
}

/**
 * Convenience methods for common HTTP verbs
 */
export const api = {
  get: (endpoint, options = {}) => apiFetch(endpoint, { 
    method: 'GET',
    ...options
  }),
  
  post: (endpoint, body, options = {}) => apiFetch(endpoint, { 
    method: 'POST',
    body: JSON.stringify(body),
    ...options
  }),
  
  put: (endpoint, body, options = {}) => apiFetch(endpoint, { 
    method: 'PUT',
    body: JSON.stringify(body),
    ...options
  }),
  
  delete: (endpoint, options = {}) => apiFetch(endpoint, { 
    method: 'DELETE',
    ...options
  })
};

/**
 * API endpoints for COGNIT
 */
export const endpoints = {
  // Health and info
  health: (options = {}) => api.get('/health', options),
  
  // Participant management
  createParticipant: (data) => api.post('/participants', data),
  checkUsername: (username) => api.get(`/check-username?username=${encodeURIComponent(username)}`),
  checkEmail: (email) => api.get(`/check-email?email=${encodeURIComponent(email)}`),
  checkPhone: (phone) => api.get(`/check-phone?phone=${encodeURIComponent(phone)}`),
  
  // Consent
  recordConsent: (publicId) => api.post('/consent', { public_id: publicId }),
  
  // Images
  getRandomImage: (exclude = [], publicId = null) => {
    const params = new URLSearchParams();
    if (exclude.length > 0) params.set('exclude', exclude.join(','));
    if (publicId) params.set('public_id', publicId);
    const qs = params.toString();
    return api.get(`/images/random${qs ? `?${qs}` : ''}`);
  },
  
  // Submissions
  submitDescription: (data) => api.post('/submit', data),
  trackEngagement: (data) => api.post('/engagement/track', data),
  
  // Payment
  createPayment: (publicId, amount) => api.post('/payments/create', {
    public_id: publicId,
    amount
  }),
  getPaymentStatus: (paymentId) => api.get(`/payments/${paymentId}/status`),
  getParticipantPaymentStatus: (publicId) => api.get(`/participants/${publicId}/payment-status`),
  verifyUpload: (paymentId, imageBase64, fileExtension, sha256) => api.post(`/payments/${paymentId}/verify-upload`, {
    image_base64: imageBase64,
    file_extension: fileExtension,
    sha256: sha256
  }),
};

/**
 * Handle common API errors with user-friendly messages
 */
export function handleApiError(error, options = {}) {
  const {
    context,
    onError,
    onFieldError,
    onRetry,
    onRedirect,
    onWait
  } = options;
  
  // Log the error
  if (context) {
    console.error(`Error in ${context}:`, error);
  }
  
  // Determine appropriate action based on error category
  switch (error.action) {
    case 'fix_input':
      if (onFieldError && error.field) {
        onFieldError(error.field, error.message);
      } else if (onError) {
        onError(error.message);
      }
      break;
      
    case 'change_input':
      if (onError) {
        onError(error.message);
      }
      break;
      
    case 'retry':
      if (onRetry) {
        onRetry(error.message);
      } else if (onError) {
        onError(error.message);
      }
      break;
      
    case 'redirect':
      if (onRedirect) {
        onRedirect(error.message);
      } else if (onError) {
        onError(error.message);
      }
      break;
      
    case 'reauthenticate':
      if (onRedirect) {
        onRedirect(error.message);
      } else {
        // Default redirect to home
        window.location.href = '/';
      }
      break;
      
    case 'retry_payment':
      if (onError) {
        onError(error.message);
      }
      break;
      
    case 'wait':
      if (onWait) {
        onWait(error.message);
      } else if (onError) {
        onError(error.message);
      }
      break;
      
    default:
      if (onError) {
        onError(error.message);
      }
  }
  
  return error.message;
}

export default api;
