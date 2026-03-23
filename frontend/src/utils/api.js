import { getApiUrl } from './apiBase';
import { parseErrorResponse, getErrorMessage } from './errorRegistry';
import { getTurnstileToken } from './turnstile';
import { assertPublicId } from './publicId';
import {
  ERROR_NAMES,
  REQUEST_ACTIONS,
  REQUEST_CATEGORIES,
  REQUEST_CODES,
  REQUEST_HEADERS,
  REQUEST_METHODS,
  REQUEST_SEVERITY,
} from "../constants/request";
import { PAYMENT_ERROR_CODES } from "../constants/payment";
import { API_ROUTES, APP_ROUTES } from "../constants/routes";
import { reportClientError } from "./errorReporter";

const RATE_LIMIT_EVENT = "cognit:rate-limit";
const MAINTENANCE_EVENT = "cognit:maintenance";
const MAINTENANCE_CODES = new Set([
  "PAY_001_0009",
  "PAY_001_0010",
  "PAY_001_0011",
]);

/**
 * Enhanced fetch wrapper with standardized error handling
 */
export async function apiFetch(endpoint, options = {}) {
  const url = getApiUrl(endpoint);
  const providedBody = options.body;
  const hasProvidedBody = providedBody !== undefined && providedBody !== null;
  const inferredMethod = options.method || (hasProvidedBody ? REQUEST_METHODS.post : REQUEST_METHODS.get);
  let method = String(inferredMethod).toUpperCase();
  // Safety: Email OTP endpoints must be POST-only.
  if (String(endpoint || "").startsWith("/email-otp/") && method !== REQUEST_METHODS.post) {
    method = REQUEST_METHODS.post;
  }
  // Safety: payment token mint endpoint is POST-only.
  if (/^\/payments\/[^/]+\/token\/?$/.test(String(endpoint || "")) && method !== REQUEST_METHODS.post) {
    method = REQUEST_METHODS.post;
  }
  // Safety: verify-upload endpoint is POST-only.
  if (/^\/payments\/[^/]+\/verify-upload\/?$/.test(String(endpoint || "")) && method !== REQUEST_METHODS.post) {
    method = REQUEST_METHODS.post;
  }
  const requestId = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const baseHeaders = { ...(options.headers || {}) };
  const requestBody = (method !== REQUEST_METHODS.get && method !== REQUEST_METHODS.head)
    ? providedBody
    : undefined;
  const hasBody = requestBody !== undefined && requestBody !== null;

  // Keep GET/HEAD requests as "simple requests" to avoid unnecessary CORS preflights.
  // Add tracing/content headers only for requests that send a body or mutate state.
  if (hasBody && !baseHeaders[REQUEST_HEADERS.contentType]) {
    baseHeaders[REQUEST_HEADERS.contentType] = 'application/json';
  }
  if (method !== REQUEST_METHODS.get && method !== REQUEST_METHODS.head && !baseHeaders[REQUEST_HEADERS.requestId]) {
    baseHeaders[REQUEST_HEADERS.requestId] = requestId;
  }

  try {
    const response = await fetch(url, {
      ...options,
      method,
      credentials: options.credentials || "include",
      headers: baseHeaders,
      body: requestBody,
    });
    
    const data = await response.json().catch(() => null);
    
    if (!response.ok) {
      if (!data && response.status === 413) {
        const error = new Error(getErrorMessage(PAYMENT_ERROR_CODES.uploadTooLarge));
        error.code = PAYMENT_ERROR_CODES.uploadTooLarge;
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
      error.requestId = parsedError.requestId || response.headers.get(REQUEST_HEADERS.requestId) || requestId;
      
      const isMaintenance = parsedError?.code && MAINTENANCE_CODES.has(parsedError.code);
      if (isMaintenance) {
        try {
          window.dispatchEvent(new CustomEvent(MAINTENANCE_EVENT, { detail: error }));
        } catch {
          // ignore event dispatch failures
        }
      }
      if (!isMaintenance && (response.status === 429 || parsedError?.code === "ERR_RATE_LIMIT" || parsedError?.category === "RATE")) {
        try {
          window.dispatchEvent(new CustomEvent(RATE_LIMIT_EVENT, { detail: error }));
        } catch {
          // ignore event dispatch failures
        }
      }
      throw error;
    }
    
    // Backend success envelope: { success: true, data: ... }
    if (data && typeof data === "object" && data.success === true) {
      return data.data ?? data;
    }
    return data;
  } catch (error) {
    const wrapError = (base, fields) => {
      const wrapped = new Error(fields.message || base?.message || "Request failed");
      Object.assign(wrapped, fields);
      return wrapped;
    };

    if (error?.name === ERROR_NAMES.abort) {
      throw wrapError(error, {
        code: REQUEST_CODES.aborted,
        category: REQUEST_CATEGORIES.system,
        severity: REQUEST_SEVERITY.info,
        action: REQUEST_ACTIONS.ignore,
        message: "Request cancelled",
        requestId: error?.requestId || requestId,
      });
    }

    // Network errors or other fetch failures
    const code = error?.code || "SYS_002_0007";
    const message = error?.message || getErrorMessage("SYS_002_0007");
    throw wrapError(error, {
      code,
      category: error?.category || REQUEST_CATEGORIES.system,
      severity: error?.severity || REQUEST_SEVERITY.error,
      action: error?.action || REQUEST_ACTIONS.retry,
      message,
      requestId: error?.requestId || requestId,
    });
  }
}

const generateIdempotencyKey = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `idem_${Date.now()}_${Math.random().toString(16).slice(2)}`;

const withIdempotencyHeader = (options = {}) => {
  const method = String(options.method || "").toUpperCase();
  const isMutating = [
    REQUEST_METHODS.post,
    REQUEST_METHODS.put,
    REQUEST_METHODS.patch,
    REQUEST_METHODS.delete,
  ].includes(method);
  if (!isMutating) return options;

  const headers = {
    ...(options.headers || {})
  };
  if (!headers[REQUEST_HEADERS.idempotencyKey]) {
    headers[REQUEST_HEADERS.idempotencyKey] = generateIdempotencyKey();
  }
  return { ...options, headers };
};

/**
 * Convenience methods for common HTTP verbs
 */
export const api = {
  get: (endpoint, options = {}) => apiFetch(endpoint, { 
    method: REQUEST_METHODS.get,
    ...options
  }),
  
  post: (endpoint, body, options = {}) => apiFetch(endpoint, withIdempotencyHeader({ 
    ...options,
    method: REQUEST_METHODS.post,
    body: JSON.stringify(body),
  })),
  
  put: (endpoint, body, options = {}) => apiFetch(endpoint, withIdempotencyHeader({ 
    ...options,
    method: REQUEST_METHODS.put,
    body: JSON.stringify(body),
  })),
  
  delete: (endpoint, options = {}) => apiFetch(endpoint, withIdempotencyHeader({ 
    ...options,
    method: REQUEST_METHODS.delete,
  }))
};

/**
 * API endpoints for COGNIT
 */
export const endpoints = {
  // Participant management
  createParticipant: async (data, options = {}) => {
    const turnstileToken = await getTurnstileToken("register_submit");
    const payload = { ...(data || {}) };
    // Prevent legacy/stale client ids from causing duplicate public_id conflicts.
    delete payload.public_id;
    delete payload.session_id;
    return api.post(API_ROUTES.participants, {
      ...payload,
      turnstile_token: turnstileToken || undefined,
    }, options);
  },
  checkUsername: (username, options = {}) => api.get(API_ROUTES.checkUsername(username), options),
  checkEmail: (email, options = {}) => api.get(API_ROUTES.checkEmail(email), options),
  checkPhone: (phone, options = {}) => api.get(API_ROUTES.checkPhone(phone), options),
  getParticipantOptions: (options = {}) => api.get(API_ROUTES.participantOptions, options),
  
  // Consent
  recordConsent: (publicId, options = {}) => {
    const safePublicId = assertPublicId(publicId, null, { message: getErrorMessage("NF_001_0001") });
    return api.post(API_ROUTES.consent, { public_id: safePublicId }, options);
  },

  // Email OTP verification
  requestEmailOtp: (publicId, email, emailUpdate = false, options = {}) => {
    const safePublicId = assertPublicId(publicId, null, { message: getErrorMessage("NF_001_0001") });
    return api.post(API_ROUTES.emailOtpRequest, { public_id: safePublicId, email, email_update: emailUpdate }, options);
  },
  verifyEmailOtp: (publicId, email, otp, options = {}) => {
    const safePublicId = assertPublicId(publicId, null, { message: getErrorMessage("NF_001_0001") });
    return api.post(API_ROUTES.emailOtpVerify, { public_id: safePublicId, email, otp }, options);
  },
  
  // Images
  getRandomImage: (exclude = [], publicId = null, options = {}) => {
    const params = new URLSearchParams();
    if (exclude.length > 0) params.set('exclude', exclude.join(','));
    if (publicId) params.set('public_id', publicId);
    // Force attention images only (temporary).
    params.set("force_attention", "1");
    const qs = params.toString();
    return api.get(API_ROUTES.randomImage(qs), options);
  },
  
  // Submissions
  submitDescription: async (data, options = {}) => {
    const turnstileToken = await getTurnstileToken("submission_submit");
    const safePublicId = assertPublicId(data?.public_id, null, { message: getErrorMessage("NF_001_0001") });
    return api.post(API_ROUTES.submit, {
      ...data,
      public_id: safePublicId,
      turnstile_token: turnstileToken || undefined,
    }, options);
  },
  
  // Payment
  createPayment: async (publicId, options = {}) => {
    const turnstileToken = await getTurnstileToken("payment_create");
    const safePublicId = assertPublicId(publicId, null, { message: getErrorMessage("NF_001_0001") });
    return api.post(API_ROUTES.createPayment, {
      public_id: safePublicId,
      turnstile_token: turnstileToken || undefined,
    }, options);
  },
  getPaymentQr: (paymentId, options = {}) => api.get(API_ROUTES.paymentQr(paymentId), options),
  getPaymentStatus: (paymentId, options = {}, paymentToken = null) => {
    const headers = { ...(options.headers || {}) };
    if (paymentToken && !headers[REQUEST_HEADERS.authorization]) {
      headers[REQUEST_HEADERS.authorization] = `Bearer ${paymentToken}`;
    }
    return api.get(API_ROUTES.paymentStatus(paymentId), { ...options, headers });
  },
  mintPaymentToken: (paymentId, publicId, sessionId, options = {}) => {
    const safePublicId = assertPublicId(publicId, null, { message: getErrorMessage("NF_001_0001") });
    const payload = { public_id: safePublicId };
    if (sessionId) payload.session_id = sessionId;
    return api.post(API_ROUTES.paymentToken(paymentId), payload, options);
  },
  getParticipantPaymentStatus: (publicId, options = {}) => {
    const safePublicId = assertPublicId(publicId, null, { message: getErrorMessage("NF_001_0001") });
    return api.get(API_ROUTES.participantPaymentStatus(safePublicId), options);
  },
  getParticipantSession: (options = {}) => api.get(API_ROUTES.participantSession, options),
  verifyUpload: async (paymentId, payloadOrImageBase64, fileExtension, sha256, extra = {}, options = {}) => {
    const turnstileToken = await getTurnstileToken("payment_verify");
    if (payloadOrImageBase64 && typeof payloadOrImageBase64 === "object" && !Array.isArray(payloadOrImageBase64)) {
      const requestOptions = (fileExtension && typeof fileExtension === "object" && !Array.isArray(fileExtension))
        ? fileExtension
        : (options || {});
      return api.post(API_ROUTES.paymentVerifyUpload(paymentId), {
        ...payloadOrImageBase64,
        turnstile_token: turnstileToken || undefined,
      }, requestOptions);
    }
    return api.post(API_ROUTES.paymentVerifyUpload(paymentId), {
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
  
  // Report errors safely without leaking sensitive payloads.
  if (context) {
    reportClientError({
      message: error?.message || String(error || ""),
      context,
      route: typeof window !== "undefined" ? window.location.pathname : "",
      tag: "api_error",
    });
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
        window.location.href = APP_ROUTES.home;
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
