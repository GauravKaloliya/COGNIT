import { runtimeConfig } from "../config/runtime";

const UI_STATE_SCHEMA_VERSION = runtimeConfig.uiStateSchemaVersion;
const UI_STATE_TTL_MS = runtimeConfig.uiStateTtlMs;

export function getStoredValue(key, fallback) {
  // Client storage is UX-only and user-controllable.
  // Backend must remain source of truth for security-critical decisions.
  try {
    const stored = sessionStorage.getItem(key);
    if (!stored) return fallback;
    const parsed = JSON.parse(stored);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      parsed.__schema_version !== UI_STATE_SCHEMA_VERSION ||
      typeof parsed.saved_at !== "number" ||
      typeof parsed.expires_at !== "number"
    ) {
      return fallback;
    }
    if (Date.now() > parsed.expires_at) {
      sessionStorage.removeItem(key);
      return fallback;
    }
    return parsed.data ?? fallback;
  } catch {
    return fallback;
  }
}

export function saveStoredValue(key, value) {
  // Client storage is UX-only and user-controllable.
  // Backend must remain source of truth for security-critical decisions.
  try {
    const now = Date.now();
    sessionStorage.setItem(
      key,
      JSON.stringify({
        __schema_version: UI_STATE_SCHEMA_VERSION,
        saved_at: now,
        expires_at: now + UI_STATE_TTL_MS,
        data: value
      })
    );
  } catch {
    // Ignore storage failures; app should remain usable.
  }
}
