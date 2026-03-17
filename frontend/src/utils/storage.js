import { runtimeConfig } from "../config/runtime";

const UI_STATE_SCHEMA_VERSION = runtimeConfig.uiStateSchemaVersion;
const UI_STATE_TTL_MS = runtimeConfig.uiStateTtlMs;
export const STORAGE_AREAS = {
  local: "local",
  session: "session",
};

export const ALL_STORAGE_AREAS = [STORAGE_AREAS.local, STORAGE_AREAS.session];

export function forEachStorageArea(callback, areas = ALL_STORAGE_AREAS) {
  areas.forEach((area) => callback(area));
}

export const STORAGE_ENVELOPE_FIELDS = {
  schemaVersion: "__schema_version",
  savedAt: "saved_at",
  expiresAt: "expires_at",
  data: "data",
};

export const STORAGE_FLAG_VALUES = {
  enabled: "1",
};

function getStorageArea(area = STORAGE_AREAS.session) {
  return area === STORAGE_AREAS.local ? localStorage : sessionStorage;
}

export function isStorageAvailable(area = STORAGE_AREAS.session) {
  try {
    const storage = getStorageArea(area);
    const key = "__cognit_storage_probe__";
    storage.setItem(key, "1");
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function makeScopedKey(key, scope) {
  const scoped = String(scope || "").trim();
  if (!scoped) return key;
  return `${key}:${scoped}`;
}

export function readJsonValue(key, fallback = null, area = STORAGE_AREAS.session) {
  try {
    const storage = getStorageArea(area);
    const raw = storage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function readStoredMeta(key, area = STORAGE_AREAS.session) {
  try {
    const parsed = readJsonValue(key, null, area);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      savedAt: parsed[STORAGE_ENVELOPE_FIELDS.savedAt],
      expiresAt: parsed[STORAGE_ENVELOPE_FIELDS.expiresAt],
      schemaVersion: parsed[STORAGE_ENVELOPE_FIELDS.schemaVersion],
    };
  } catch {
    return null;
  }
}

export function writeJsonValue(key, value, area = STORAGE_AREAS.session) {
  try {
    const storage = getStorageArea(area);
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage failures; app should remain usable.
  }
}

export function removeStoredKey(key, area = STORAGE_AREAS.session) {
  try {
    const storage = getStorageArea(area);
    storage.removeItem(key);
  } catch {
    // Ignore storage failures.
  }
}

export function getStoredValue(key, fallback, options = {}) {
  return readExpiringValue(key, fallback, {
    ...options,
    schemaVersion: options.schemaVersion !== undefined ? options.schemaVersion : UI_STATE_SCHEMA_VERSION,
    ttlMs: options.ttlMs !== undefined ? options.ttlMs : UI_STATE_TTL_MS,
  });
}

export function saveStoredValue(key, value, options = {}) {
  writeExpiringValue(key, value, {
    ...options,
    schemaVersion: options.schemaVersion !== undefined ? options.schemaVersion : UI_STATE_SCHEMA_VERSION,
    ttlMs: options.ttlMs !== undefined ? options.ttlMs : UI_STATE_TTL_MS,
  });
}

export function readExpiringValue(key, fallback, options = {}) {
  const {
    area = "session",
    schemaVersion = UI_STATE_SCHEMA_VERSION,
  } = options;

  try {
    const storage = getStorageArea(area);
    const parsed = readJsonValue(key, null, area);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      parsed[STORAGE_ENVELOPE_FIELDS.schemaVersion] !== schemaVersion ||
      typeof parsed[STORAGE_ENVELOPE_FIELDS.savedAt] !== "number" ||
      typeof parsed[STORAGE_ENVELOPE_FIELDS.expiresAt] !== "number"
    ) {
      return fallback;
    }
    if (Date.now() > parsed[STORAGE_ENVELOPE_FIELDS.expiresAt]) {
      storage.removeItem(key);
      return fallback;
    }
    return parsed[STORAGE_ENVELOPE_FIELDS.data] ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeExpiringValue(key, value, options = {}) {
  const {
    area = "session",
    schemaVersion = UI_STATE_SCHEMA_VERSION,
    ttlMs = UI_STATE_TTL_MS,
  } = options;

  try {
    const now = Date.now();
    const effectiveTtlMs = ttlMs === null ? Number.MAX_SAFE_INTEGER - now : ttlMs;
    writeJsonValue(key, {
      [STORAGE_ENVELOPE_FIELDS.schemaVersion]: schemaVersion,
      [STORAGE_ENVELOPE_FIELDS.savedAt]: now,
      [STORAGE_ENVELOPE_FIELDS.expiresAt]: now + effectiveTtlMs,
      [STORAGE_ENVELOPE_FIELDS.data]: value,
    }, area);
  } catch {
    // Ignore storage failures.
  }
}

export function getPendingFlag(key, area = STORAGE_AREAS.session) {
  try {
    const storage = getStorageArea(area);
    return storage.getItem(key) === STORAGE_FLAG_VALUES.enabled;
  } catch {
    return false;
  }
}

export function setPendingFlag(key, area = STORAGE_AREAS.session) {
  try {
    const storage = getStorageArea(area);
    storage.setItem(key, STORAGE_FLAG_VALUES.enabled);
  } catch {
    // Ignore storage failures.
  }
}

export function clearPendingFlag(key, area = STORAGE_AREAS.session) {
  removeStoredKey(key, area);
}
