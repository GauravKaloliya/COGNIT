import { getApiUrl } from './apiBase';
import { parseErrorResponse, getErrorMessage } from './errorRegistry';
import { getTurnstileToken } from './turnstile';

/**
 * Enhanced fetch wrapper with standardized error handling
 */
export async function apiFetch(endpoint, options = {}) {
  const url = getApiUrl(endpoint);
  const method = String(options.method || "GET").toUpperCase();
  const hasBody = options.body !== undefined && options.body !== null;
  const requestId = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const baseHeaders = { ...(options.headers || {}) };
  const requestBody = options.body;

  // Keep GET/HEAD requests as "simple requests" to avoid unnecessary CORS preflights.
  // Add tracing/content headers only for requests that send a body or mutate state.
  if (hasBody && !baseHeaders['Content-Type']) {
    baseHeaders['Content-Type'] = 'application/json';
  }
  if (method !== 'GET' && method !== 'HEAD' && !baseHeaders['X-Request-ID']) {
    baseHeaders['X-Request-ID'] = requestId;
  }

  try {
    const response = await fetch(url, {
      ...options,
      headers: baseHeaders,
      body: requestBody,
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
    
    // Backend success envelope: { success: true, data: ... }
    if (data && typeof data === "object" && data.success === true) {
      return data.data ?? data;
    }
    return data;
  } catch (error) {
    if (error?.name === "AbortError") {
      error.code = "REQ_ABORTED";
      error.category = "SYS";
      error.severity = "info";
      error.action = "ignore";
      error.message = "Request cancelled";
      if (!error.requestId) {
        error.requestId = requestId;
      }
      throw error;
    }

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

const generateIdempotencyKey = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `idem_${Date.now()}_${Math.random().toString(16).slice(2)}`;

const withIdempotencyHeader = (options = {}) => {
  const method = String(options.method || "").toUpperCase();
  const isMutating = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
  if (!isMutating) return options;

  const headers = {
    ...(options.headers || {})
  };
  if (!headers["X-Idempotency-Key"]) {
    headers["X-Idempotency-Key"] = generateIdempotencyKey();
  }
  return { ...options, headers };
};

/**
 * Convenience methods for common HTTP verbs
 */
export const api = {
  get: (endpoint, options = {}) => apiFetch(endpoint, { 
    method: 'GET',
    ...options
  }),
  
  post: (endpoint, body, options = {}) => apiFetch(endpoint, withIdempotencyHeader({ 
    method: 'POST',
    body: JSON.stringify(body),
    ...options
  })),
  
  put: (endpoint, body, options = {}) => apiFetch(endpoint, withIdempotencyHeader({ 
    method: 'PUT',
    body: JSON.stringify(body),
    ...options
  })),
  
  delete: (endpoint, options = {}) => apiFetch(endpoint, withIdempotencyHeader({ 
    method: 'DELETE',
    ...options
  }))
};

/**
 * API endpoints for COGNIT
 */
export const endpoints = {
  // Health and info
  health: (options = {}) => api.get('/health', options),
  
  // Participant management
  createParticipant: async (data, options = {}) => {
    const turnstileToken = await getTurnstileToken("register_submit");
    const payload = { ...(data || {}) };
    // Prevent legacy/stale client ids from causing duplicate public_id conflicts.
    delete payload.public_id;
    delete payload.session_id;
    return api.post('/participants', {
      ...payload,
      turnstile_token: turnstileToken || undefined,
    }, options);
  },
  checkUsername: (username, options = {}) => api.get(`/check-username?username=${encodeURIComponent(username)}`, options),
  checkEmail: (email, options = {}) => api.get(`/check-email?email=${encodeURIComponent(email)}`, options),
  checkPhone: (phone, options = {}) => api.get(`/check-phone?phone=${encodeURIComponent(phone)}`, options),
  
  // Consent
  recordConsent: (publicId, options = {}) => api.post('/consent', { public_id: publicId }, options),
  
  // Images
  getRandomImage: (exclude = [], publicId = null, options = {}) => {
    const params = new URLSearchParams();
    if (exclude.length > 0) params.set('exclude', exclude.join(','));
    if (publicId) params.set('public_id', publicId);
    const qs = params.toString();
    return api.get(`/images/random${qs ? `?${qs}` : ''}`, options);
  },
  
  // Submissions
  submitDescription: async (data, options = {}) => {
    const turnstileToken = await getTurnstileToken("submission_submit");
    return api.post('/submit', {
      ...data,
      turnstile_token: turnstileToken || undefined,
    }, options);
  },
  
  // Payment
  createPayment: async (publicId, amount, options = {}) => {
    const turnstileToken = await getTurnstileToken("payment_create");
    return api.post('/payments/create', {
      public_id: publicId,
      amount,
      turnstile_token: turnstileToken || undefined,
    }, options);
  },
  getPaymentQr: (paymentId, options = {}) => api.get(`/payments/${paymentId}/qr`, options),
  getPaymentStatus: (paymentId, options = {}) => api.get(`/payments/${paymentId}/status`, options),
  getParticipantPaymentStatus: (publicId, options = {}) => api.get(`/participants/${publicId}/payment-status`, options),
  getPaymentUploadUrl: (paymentId, payload, options = {}) => api.post(`/payments/${paymentId}/upload-url`, payload, options),
  verifyUpload: async (paymentId, payloadOrImageBase64, fileExtension, sha256, extra = {}, options = {}) => {
    const turnstileToken = await getTurnstileToken("payment_verify");
    if (payloadOrImageBase64 && typeof payloadOrImageBase64 === "object" && !Array.isArray(payloadOrImageBase64)) {
      const requestOptions = (fileExtension && typeof fileExtension === "object" && !Array.isArray(fileExtension))
        ? fileExtension
        : (options || {});
      return api.post(`/payments/${paymentId}/verify-upload`, {
        ...payloadOrImageBase64,
        turnstile_token: turnstileToken || undefined,
      }, requestOptions);
    }
    return api.post(`/payments/${paymentId}/verify-upload`, {
      image_base64: payloadOrImageBase64,
      file_extension: fileExtension,
      sha256: sha256,
      turnstile_token: turnstileToken || undefined,
      ...extra
    }, options);
  },
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
