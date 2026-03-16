export const REQUEST_METHODS = {
  get: "GET",
  post: "POST",
  put: "PUT",
  patch: "PATCH",
  delete: "DELETE",
  head: "HEAD",
};

export const REQUEST_CACHE = {
  noStore: "no-store",
};

export const REQUEST_HEADERS = {
  contentType: "Content-Type",
  requestId: "X-Request-ID",
  idempotencyKey: "X-Idempotency-Key",
  authorization: "Authorization",
};

export const REQUEST_CODES = {
  aborted: "REQ_ABORTED",
};

export const ERROR_NAMES = {
  abort: "AbortError",
};

export const REQUEST_ACTIONS = {
  ignore: "ignore",
  retry: "retry",
};

export const REQUEST_CATEGORIES = {
  system: "SYS",
};

export const REQUEST_SEVERITY = {
  info: "info",
  error: "error",
};

export const NETWORK_ERROR_HINTS = {
  timeout: "timeout",
  fetch: "fetch",
};
