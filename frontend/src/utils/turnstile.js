import { runtimeConfig } from "../config/runtime";

let scriptPromise = null;

const TURNSTILE_SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

const isLocalhost = () => {
  if (typeof window === "undefined") return false;
  const host = String(window.location.hostname || "").toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
};

const ensureTurnstileScript = () => {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Turnstile unavailable in non-browser context"));
  }
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src^="${TURNSTILE_SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Failed to load Turnstile script")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error("Failed to load Turnstile script"));
    };
    document.head.appendChild(script);
  });

  return scriptPromise;
};

export const getTurnstileToken = async (action = "submit") => {
  if (!runtimeConfig.turnstileEnabled) return "";
  if (isLocalhost()) {
    // Local dev runs on http://localhost by default and often fails Turnstile execution.
    // Keep UX unblocked for local development.
    return "";
  }
  const siteKey = (runtimeConfig.turnstileSiteKey || "").trim();
  if (!siteKey) {
    throw new Error("Turnstile site key is missing");
  }
  try {
    await ensureTurnstileScript();
    if (!window.turnstile) {
      throw new Error("Turnstile not initialized");
    }

    const container = document.createElement("div");
    container.style.position = "fixed";
    container.style.left = "-9999px";
    container.style.top = "0";
    container.style.width = "1px";
    container.style.height = "1px";
    container.style.opacity = "0";
    document.body.appendChild(container);

    return await new Promise((resolve, reject) => {
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
            cleanup();
            resolve(token || "");
          },
          "error-callback": () => {
            cleanup();
            reject(new Error("Turnstile execution failed"));
          },
          "expired-callback": () => {
            cleanup();
            reject(new Error("Turnstile token expired"));
          },
        });
        window.turnstile.execute(widgetId);
      } catch (error) {
        cleanup();
        reject(error instanceof Error ? error : new Error("Turnstile render failed"));
      }
    });
  } catch (error) {
    // Avoid hard-blocking UX on runtime Turnstile failures.
    // Backend remains source of truth and can enforce challenge in non-local environments.
    if (isLocalhost()) return "";
    throw error instanceof Error ? error : new Error("Turnstile unavailable");
  }
};
