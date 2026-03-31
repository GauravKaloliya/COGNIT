import { getApiUrl } from "./apiBase";
import { parseErrorResponse, getErrorMessage } from "./errorRegistry";
import { applyCodeSpecificErrorBehavior } from "./errorBehavior";
import { getTurnstileToken, isTurnstileRequired } from "./turnstile";
import { assertPublicId } from "./publicId";
import {
  ERROR_NAMES,
  REQUEST_ACTIONS,
  REQUEST_CATEGORIES,
  REQUEST_CODES,
  REQUEST_HEADERS,
  REQUEST_METHODS,
  REQUEST_SEVERITY,
} from "../constants/request";
import { API_ROUTES, APP_ROUTES } from "../constants/routes";
import { ERROR_UI_EVENTS } from "../constants/errorUiEvents";
import { reportClientError } from "./errorReporter";
import { PROTECTED_SUBMIT_PHASES } from "./protectedSubmitStatus";

const SAFE_GET_CACHE = new Map();

function createStructuredError({
  message,
  code = "SYS_001_0001",
  category,
  severity = REQUEST_SEVERITY.error,
  action = REQUEST_ACTIONS.retry,
  status = 0,
  retryable,
  field,
  fields,
  details,
  requestId,
}) {
  const resolvedCategory = category || String(code || "SYS").split("_")[0] || REQUEST_CATEGORIES.system;
  const error = new Error(String(message || getErrorMessage(code)));
  error.code = code;
  error.category = resolvedCategory;
  error.severity = severity;
  error.action = action;
  error.status = Number(status) || 0;
  error.retryable = typeof retryable === "boolean" ? retryable : action === REQUEST_ACTIONS.retry;
  error.field = field;
  error.fields = fields;
  error.details = details;
  error.requestId = requestId;
  return error;
}

function closeSessionTransport(endpoint, payload) {
  const url = getApiUrl(endpoint);
  const body = JSON.stringify(payload || {});
  try {
    if (typeof fetch === "function") {
      void fetch(url, {
        method: REQUEST_METHODS.post,
        credentials: "include",
        headers: { [REQUEST_HEADERS.contentType]: "application/json" },
        body,
        keepalive: true,
      }).catch(() => {});
      return true;
    }
  } catch {
    // Fall through to beacon.
  }
  try {
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const blob = new Blob([body], { type: "application/json" });
      return navigator.sendBeacon(url, blob);
    }
  } catch {
    // Ignore unload transport failures.
  }
  return false;
}

function notifyProtectedSubmitPhase(callback, phase) {
  if (typeof callback === "function") {
    callback(phase);
  }
}

async function withTurnstileProtection(action, options, operation) {
  const protectedSubmitCallback = options?.onProtectedSubmitPhaseChange;
  notifyProtectedSubmitPhase(protectedSubmitCallback, PROTECTED_SUBMIT_PHASES.verifyingSecurity);
  let turnstileToken = "";
  try {
    turnstileToken = await getTurnstileToken(action);
  } catch (error) {
    notifyProtectedSubmitPhase(protectedSubmitCallback, PROTECTED_SUBMIT_PHASES.idle);
    if (error?.isTurnstileClientError) {
      throw createStructuredError({
        code: error.code || "BOT_001_0005",
        message: error.message || getErrorMessage("BOT_001_0005"),
        category: error.category || "BOT",
        severity: REQUEST_SEVERITY.error,
        action: REQUEST_ACTIONS.retry,
        status: 400,
        retryable: true,
        details: {
          source: "turnstile_client",
          action: error.turnstileAction || action,
        },
      });
    }
    throw error;
  }
  if (isTurnstileRequired() && !String(turnstileToken || "").trim()) {
    notifyProtectedSubmitPhase(protectedSubmitCallback, PROTECTED_SUBMIT_PHASES.idle);
    throw createStructuredError({
      code: action === "register_submit" ? "BOT_001_0002" : "BOT_001_0005",
      message: getErrorMessage(action === "register_submit" ? "BOT_001_0002" : "BOT_001_0005"),
      category: "BOT",
      severity: REQUEST_SEVERITY.error,
      action: REQUEST_ACTIONS.retry,
      status: 400,
      retryable: true,
    });
  }
  notifyProtectedSubmitPhase(protectedSubmitCallback, PROTECTED_SUBMIT_PHASES.submitting);
  try {
    return await operation(turnstileToken);
  } finally {
    notifyProtectedSubmitPhase(protectedSubmitCallback, PROTECTED_SUBMIT_PHASES.idle);
  }
}

function isAbortSignal(signal) {
  return signal && typeof signal === "object" && "aborted" in signal;
}

function buildCacheKey(endpoint, options = {}) {
  const authScope = options.credentials || "include";
  return `${String(endpoint)}::${String(authScope)}`;
}

async function runSafeGetRequest(endpoint, options = {}) {
  return apiFetch(endpoint, { method: REQUEST_METHODS.get, ...options });
}

function readSafeCache(cacheKey) {
  const entry = SAFE_GET_CACHE.get(cacheKey);
  if (!entry || typeof entry !== "object") return null;
  return entry;
}

function writeSafeCache(cacheKey, payload) {
  SAFE_GET_CACHE.set(cacheKey, payload);
  return payload;
}

async function getSafeCached(endpoint, options = {}, cacheConfig = {}) {
  const ttlMs = Math.max(0, Number(cacheConfig.ttlMs || 0));
  const staleMs = Math.max(ttlMs, Number(cacheConfig.staleMs || ttlMs));
  const swr = cacheConfig.swr !== false;
  const key = cacheConfig.key || buildCacheKey(endpoint, options);
  const now = Date.now();
  const current = readSafeCache(key);

  if (current?.inflight) {
    return current.inflight;
  }

  const fetchAndStore = async () => {
    const nextData = await runSafeGetRequest(endpoint, options);
    writeSafeCache(key, {
      data: nextData,
      updatedAt: Date.now(),
      freshUntil: Date.now() + ttlMs,
      staleUntil: Date.now() + staleMs,
      inflight: null,
    });
    return nextData;
  };

  if (current?.data !== undefined && now < Number(current.freshUntil || 0)) {
    return current.data;
  }

  if (current?.data !== undefined && now < Number(current.staleUntil || 0) && swr) {
    const revalidatePromise = fetchAndStore().catch(() => current.data);
    writeSafeCache(key, { ...current, inflight: revalidatePromise });
    return current.data;
  }

  const networkPromise = fetchAndStore().finally(() => {
    const latest = readSafeCache(key);
    if (!latest) return;
    writeSafeCache(key, { ...latest, inflight: null });
  });
  writeSafeCache(key, {
    data: current?.data,
    updatedAt: current?.updatedAt || 0,
    freshUntil: current?.freshUntil || 0,
    staleUntil: current?.staleUntil || 0,
    inflight: networkPromise,
  });
  return networkPromise;
}

export async function apiFetch(endpoint, options = {}) {
  const url = getApiUrl(endpoint);
  const providedBody = options.body;
  const hasProvidedBody = providedBody !== undefined && providedBody !== null;
  let method = String(options.method || (hasProvidedBody ? REQUEST_METHODS.post : REQUEST_METHODS.get)).toUpperCase();
  if (String(endpoint || "").startsWith("/email-otp/") && method !== REQUEST_METHODS.post) {
    method = REQUEST_METHODS.post;
  }
  const requestId = typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const headers = { ...(options.headers || {}) };
  const requestBody = (method !== REQUEST_METHODS.get && method !== REQUEST_METHODS.head) ? providedBody : undefined;
  if (requestBody !== undefined && requestBody !== null && !headers[REQUEST_HEADERS.contentType]) {
    headers[REQUEST_HEADERS.contentType] = "application/json";
  }
  if (method !== REQUEST_METHODS.get && method !== REQUEST_METHODS.head && !headers[REQUEST_HEADERS.requestId]) {
    headers[REQUEST_HEADERS.requestId] = requestId;
  }

  try {
    const response = await fetch(url, {
      ...options,
      method,
      credentials: options.credentials || "include",
      headers,
      body: requestBody,
    });
    const data = await response.json().catch(() => null);

    const throwParsedError = (parsedError, fallbackStatus) => {
      const effectiveStatus = Number(parsedError?.status) || Number(fallbackStatus) || 0;
      applyCodeSpecificErrorBehavior(parsedError);
      const error = new Error(parsedError.message);
      error.key = parsedError.key;
      error.code = parsedError.code;
      error.category = parsedError.category;
      error.severity = parsedError.severity;
      error.action = parsedError.action;
      error.field = parsedError.field;
      error.fields = parsedError.fields;
      error.status = effectiveStatus;
      error.details = parsedError.details;
      error.originalMessage = parsedError.originalMessage;
      error.requestId = parsedError.requestId || response.headers.get(REQUEST_HEADERS.requestId) || requestId;
      if (effectiveStatus === 503 && typeof window !== "undefined") {
        try {
          window.dispatchEvent(new CustomEvent(ERROR_UI_EVENTS.maintenance, { detail: error }));
        } catch {
          // Ignore dispatch failures outside browser contexts.
        }
      }
      if ((effectiveStatus === 429 || parsedError?.category === "RATE") && typeof window !== "undefined") {
        try {
          window.dispatchEvent(new CustomEvent(ERROR_UI_EVENTS.rateLimit, { detail: error }));
        } catch {
          // Ignore dispatch failures outside browser contexts.
        }
      }
      throw error;
    };

    if (data && typeof data === "object" && data.success === false) {
      throwParsedError(parseErrorResponse(data), response.status);
    }
    if (!response.ok) {
      throwParsedError(parseErrorResponse(data), response.status);
    }
    if (data && typeof data === "object" && data.success === true) {
      return data.data ?? data;
    }
    return data;
  } catch (error) {
    const wrapError = (base, fields) => Object.assign(new Error(fields.message || base?.message || "Request failed"), fields);
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
    throw wrapError(error, {
      code: error?.code || "SYS_002_0007",
      category: error?.category || REQUEST_CATEGORIES.system,
      severity: error?.severity || REQUEST_SEVERITY.error,
      action: error?.action || REQUEST_ACTIONS.retry,
      message: error?.message || getErrorMessage("SYS_002_0007"),
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
  const isMutating = [REQUEST_METHODS.post, REQUEST_METHODS.put, REQUEST_METHODS.patch, REQUEST_METHODS.delete].includes(method);
  if (!isMutating) return options;
  const headers = { ...(options.headers || {}) };
  if (!headers[REQUEST_HEADERS.idempotencyKey]) {
    headers[REQUEST_HEADERS.idempotencyKey] = generateIdempotencyKey();
  }
  return { ...options, headers };
};

export const api = {
  get: (endpoint, options = {}) => apiFetch(endpoint, { method: REQUEST_METHODS.get, ...options }),
  getCached: (endpoint, options = {}, cacheConfig = {}) => {
    if (isAbortSignal(options?.signal) && options.signal.aborted) {
      return Promise.reject(Object.assign(new Error("Request cancelled"), { code: REQUEST_CODES.aborted }));
    }
    return getSafeCached(endpoint, options, cacheConfig);
  },
  post: (endpoint, body, options = {}) => apiFetch(endpoint, withIdempotencyHeader({ ...options, method: REQUEST_METHODS.post, body: JSON.stringify(body) })),
  put: (endpoint, body, options = {}) => apiFetch(endpoint, withIdempotencyHeader({ ...options, method: REQUEST_METHODS.put, body: JSON.stringify(body) })),
  delete: (endpoint, options = {}) => apiFetch(endpoint, withIdempotencyHeader({ ...options, method: REQUEST_METHODS.delete })),
};

export const endpoints = {
  createParticipant: async (data, options = {}) => {
    const { onProtectedSubmitPhaseChange, ...requestOptions } = options || {};
    const payload = { ...(data || {}) };
    delete payload.public_id;
    delete payload.session_id;
    return withTurnstileProtection("register_submit", { onProtectedSubmitPhaseChange }, (turnstileToken) =>
      api.post(API_ROUTES.participants, { ...payload, turnstile_token: turnstileToken || undefined }, requestOptions)
    );
  },
  checkUsername: (username, options = {}) => api.get(API_ROUTES.checkUsername(username), options),
  checkEmail: (email, options = {}) => api.get(API_ROUTES.checkEmail(email), options),
  getParticipantOptions: (options = {}) => api.getCached(API_ROUTES.participantOptions, options, {
    key: "participant-options",
    ttlMs: 15000,
    staleMs: 60000,
    swr: true,
  }),
  recordConsent: (publicId, options = {}) => {
    const safePublicId = assertPublicId(publicId, null, { message: getErrorMessage("NF_001_0001") });
    return api.post(API_ROUTES.consent, { public_id: safePublicId }, options);
  },
  requestEmailOtp: (publicId, email, emailUpdate = false, options = {}) => {
    const safePublicId = assertPublicId(publicId, null, { message: getErrorMessage("NF_001_0001") });
    return api.post(API_ROUTES.emailOtpRequest, { public_id: safePublicId, email, email_update: emailUpdate }, options);
  },
  verifyEmailOtp: (publicId, email, otp, options = {}) => {
    const safePublicId = assertPublicId(publicId, null, { message: getErrorMessage("NF_001_0001") });
    return api.post(API_ROUTES.emailOtpVerify, { public_id: safePublicId, email, otp }, options);
  },
  getRandomImage: (exclude = [], publicId = null, options = {}) => {
    const params = new URLSearchParams();
    if (exclude.length > 0) params.set("exclude", exclude.join(","));
    if (publicId) params.set("public_id", publicId);
    return api.get(API_ROUTES.randomImage(params.toString()), options);
  },
  renewImageReservation: (publicId, imageId, options = {}) => {
    const safePublicId = assertPublicId(publicId, null, { message: getErrorMessage("NF_001_0001") });
    return api.post(API_ROUTES.renewImageReservation, { public_id: safePublicId, image_id: imageId }, options);
  },
  submitDescription: async (data, options = {}) => {
    const { onProtectedSubmitPhaseChange, ...requestOptions } = options || {};
    const safePublicId = assertPublicId(data?.public_id, null, { message: getErrorMessage("NF_001_0001") });
    return withTurnstileProtection("submission_submit", { onProtectedSubmitPhaseChange }, (turnstileToken) =>
      api.post(API_ROUTES.submit, { ...data, public_id: safePublicId, turnstile_token: turnstileToken || undefined }, requestOptions)
    );
  },
  getParticipantSession: (options = {}) => api.getCached(API_ROUTES.participantSession, options, {
    key: "participant-session",
    ttlMs: 5000,
    staleMs: 30000,
    swr: true,
  }),
  getParticipantSessionFresh: (options = {}) => api.get(API_ROUTES.participantSession, options),
  updateParticipantSessionPresence: (payload = {}, options = {}) =>
    api.post(API_ROUTES.participantSessionPresence, payload, options),
  closeParticipantSession: (payload = {}, options = {}) =>
    api.post(API_ROUTES.participantSessionClose, payload, options),
  signalParticipantSessionPresence: (payload = {}) =>
    closeSessionTransport(API_ROUTES.participantSessionPresence, payload),
  signalParticipantSessionClose: (payload = {}) =>
    closeSessionTransport(API_ROUTES.participantSessionClose, payload),
};

export function handleApiError(error, options = {}) {
  const { context, onError, onFieldError, onRetry, onRedirect, onWait } = options;
  applyCodeSpecificErrorBehavior(error, { onRedirect });
  if (context) {
    reportClientError({
      message: error?.message || String(error || ""),
      context,
      route: typeof window !== "undefined" ? window.location.pathname : "",
      tag: "api_error",
    });
  }
  switch (error.action) {
    case "fix_input":
      if (onFieldError && error.field) onFieldError(error.field, error.message);
      else if (onError) onError(error.message);
      break;
    case "change_input":
    case "retry":
      if (onRetry && error.action === "retry") onRetry(error.message);
      else if (onError) onError(error.message);
      break;
    case "redirect":
      if (onRedirect) onRedirect(error.message);
      else if (onError) onError(error.message);
      break;
    case "reauthenticate":
      if (onRedirect) onRedirect(error.message);
      else window.location.href = APP_ROUTES.home;
      break;
    case "wait":
      if (onWait) onWait(error.message);
      else if (onError) onError(error.message);
      break;
    default:
      if (onError) onError(error.message);
  }
  return error.message;
}

export default api;
