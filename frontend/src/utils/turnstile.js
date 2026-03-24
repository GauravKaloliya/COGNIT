import { runtimeConfig } from "../config/runtime";
import { reportClientError } from "./errorReporter";
import { scheduleTimeout } from "./timing";
import { uiText } from "./uiText.js";

let scriptPromise = null;
const TURNSTILE_MAX_ATTEMPTS = 2;

const TURNSTILE_SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

const isLocalhost = () => {
  if (typeof window === "undefined") return false;
  const host = String(window.location.hostname || "").toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
};

const ensureTurnstileScript = () => {
  if (typeof window === "undefined") {
    return Promise.reject(new Error(uiText("turnstile.unavailableBrowser")));
  }
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src^="${TURNSTILE_SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error(uiText("turnstile.loadFailed"))), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error(uiText("turnstile.loadFailed")));
    };
    document.head.appendChild(script);
  });

  return scriptPromise;
};

const TURNSTILE_TIMEOUT_MS = 8000;

export const isTurnstileRequired = () => {
  if (!runtimeConfig.turnstileEnabled) return false;
  if (import.meta.env.DEV || isLocalhost()) return false;
  return true;
};

export const getTurnstileToken = async (action = "submit") => {
  if (!isTurnstileRequired()) {
    // Local development should never block on Turnstile.
    return "";
  }
  const siteKey = (runtimeConfig.turnstileSiteKey || "").trim();
  if (!siteKey) {
    throw new Error(uiText("turnstile.siteKeyMissing"));
  }
  let lastError = null;
  for (let attempt = 1; attempt <= TURNSTILE_MAX_ATTEMPTS; attempt += 1) {
    try {
      await Promise.race([
        ensureTurnstileScript(),
        new Promise((_, reject) =>
          scheduleTimeout(() => reject(new Error(uiText("turnstile.loadTimedOut"))), TURNSTILE_TIMEOUT_MS)
        ),
      ]);
      if (!window.turnstile) {
        throw new Error(uiText("turnstile.notInitialized"));
      }

      const container = document.createElement("div");
      container.style.position = "fixed";
      container.style.left = "-9999px";
      container.style.top = "0";
      container.style.width = "1px";
      container.style.height = "1px";
      container.style.opacity = "0";
      document.body.appendChild(container);

      return await Promise.race([
        new Promise((resolve, reject) => {
          let widgetId = null;
          const cleanup = () => {
            try {
              if (widgetId !== null && window.turnstile?.remove) {
                window.turnstile.remove(widgetId);
              }
            } catch {
              // ignore
            }
            try {
              if (container.parentNode) container.parentNode.removeChild(container);
            } catch {
              // ignore
            }
          };

          try {
            widgetId = window.turnstile.render(container, {
              sitekey: siteKey,
              action,
              appearance: "interaction-only",
              execution: "execute",
              callback: (token) => {
                const safeToken = String(token || "").trim();
                cleanup();
                if (!safeToken) {
                  reject(new Error(uiText("turnstile.executionFailed")));
                  return;
                }
                resolve(safeToken);
              },
              "error-callback": async (errorCode) => {
                cleanup();
                await reportClientError({
                  message: uiText("turnstile.executionFailed"),
                  context: "turnstile_error_callback",
                  route: typeof window !== "undefined" ? window.location.pathname : "",
                  tag: "turnstile_client_error",
                  meta: {
                    action,
                    attempt,
                    errorCode: String(errorCode || ""),
                  },
                });
                reject(new Error(uiText("turnstile.executionFailed")));
              },
              "expired-callback": async () => {
                cleanup();
                await reportClientError({
                  message: uiText("turnstile.tokenExpired"),
                  context: "turnstile_expired_callback",
                  route: typeof window !== "undefined" ? window.location.pathname : "",
                  tag: "turnstile_client_error",
                  meta: { action, attempt },
                });
                reject(new Error(uiText("turnstile.tokenExpired")));
              },
            });
            window.turnstile.execute(widgetId);
          } catch (error) {
            cleanup();
            reject(error instanceof Error ? error : new Error(uiText("turnstile.renderFailed")));
          }
        }),
        new Promise((_, reject) =>
          scheduleTimeout(() => reject(new Error(uiText("turnstile.executionTimedOut"))), TURNSTILE_TIMEOUT_MS)
        ),
      ]);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(uiText("turnstile.unavailable"));
      await reportClientError({
        message: lastError.message,
        context: "turnstile_get_token",
        route: typeof window !== "undefined" ? window.location.pathname : "",
        tag: "turnstile_client_error",
        meta: { action, attempt },
      });
      if (attempt < TURNSTILE_MAX_ATTEMPTS) {
        scriptPromise = null;
        continue;
      }
    }
  }
  if (isLocalhost()) return "";
  throw lastError instanceof Error ? lastError : new Error(uiText("turnstile.unavailable"));
};
