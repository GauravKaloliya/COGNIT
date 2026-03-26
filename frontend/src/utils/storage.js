import { runtimeConfig } from "../config/runtime";

const UI_STATE_SCHEMA_VERSION = runtimeConfig.uiStateSchemaVersion;
const UI_STATE_TTL_MS = runtimeConfig.uiStateTtlMs;
export const STORAGE_AREAS = {
  local: "local",
  session: "session",
};

export const ALL_STORAGE_AREAS = [STORAGE_AREAS.local, STORAGE_AREAS.session];

const STORAGE_AREA_POLICY = {
  [runtimeConfig.storageKeys.activeTabLock]: STORAGE_AREAS.local,
  [runtimeConfig.storageKeys.darkMode]: STORAGE_AREAS.local,
  [runtimeConfig.storageKeys.stage]: STORAGE_AREAS.local,
  [runtimeConfig.storageKeys.consentGiven]: STORAGE_AREAS.local,
  [runtimeConfig.storageKeys.userDetailsSubmitted]: STORAGE_AREAS.local,
  [runtimeConfig.storageKeys.emailVerified]: STORAGE_AREAS.local,
  [runtimeConfig.storageKeys.demographics]: STORAGE_AREAS.local,
  [runtimeConfig.storageKeys.survey]: STORAGE_AREAS.local,
  [runtimeConfig.storageKeys.surveyCompleted]: STORAGE_AREAS.local,
  [runtimeConfig.storageKeys.surveyFeedbackReady]: STORAGE_AREAS.local,
  [runtimeConfig.storageKeys.lastSubmissionSucceeded]: STORAGE_AREAS.local,
  [runtimeConfig.storageKeys.shownImages]: STORAGE_AREAS.local,
  [runtimeConfig.storageKeys.sessionId]: STORAGE_AREAS.local,
  [runtimeConfig.storageKeys.publicId]: STORAGE_AREAS.local,
  [runtimeConfig.storageKeys.preAuthId]: STORAGE_AREAS.local,
  [runtimeConfig.storageKeys.preAuthMigrationLock]: STORAGE_AREAS.local,
  [runtimeConfig.storageKeys.preAuthMigrationDonePrefix]: STORAGE_AREAS.local,
  [runtimeConfig.storageKeys.consentDraft]: STORAGE_AREAS.local,
  [runtimeConfig.storageKeys.emailOtpState]: STORAGE_AREAS.local,

  [runtimeConfig.storageKeys.consentPending]: STORAGE_AREAS.session,
  [runtimeConfig.storageKeys.userDetailsPending]: STORAGE_AREAS.session,
  [runtimeConfig.storageKeys.surveyPendingSubmit]: STORAGE_AREAS.session,
  [runtimeConfig.storageKeys.surveyFeedPendingContinue]: STORAGE_AREAS.session,
  [runtimeConfig.storageKeys.surveyFeedPendingFinish]: STORAGE_AREAS.session,
  [runtimeConfig.storageKeys.participantOptions]: STORAGE_AREAS.session,
  [runtimeConfig.storageKeys.autoLocationPrompt]: STORAGE_AREAS.session,
  [runtimeConfig.storageKeys.autoLocationSuccess]: STORAGE_AREAS.session,
  [runtimeConfig.storageKeys.desktopLocationSession]: STORAGE_AREAS.session,
  [runtimeConfig.storageKeys.reverseGeocodeState]: STORAGE_AREAS.session,
  [runtimeConfig.storageKeys.telemetry]: STORAGE_AREAS.session,
  [runtimeConfig.storageKeys.clientErrorQueue]: STORAGE_AREAS.session,
  [runtimeConfig.storageKeys.telemetryBlocked]: STORAGE_AREAS.session,
  [runtimeConfig.storageKeys.clearOnClose]: STORAGE_AREAS.session,
  [runtimeConfig.storageKeys.sessionAlive]: STORAGE_AREAS.session,
};

const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);
const isBoolean = (value) => typeof value === "boolean";
const isString = (value) => typeof value === "string";
const isStringArray = (value) => Array.isArray(value) && value.every((item) => typeof item === "string");

const STORAGE_SHAPE_VALIDATORS = {
  [runtimeConfig.storageKeys.darkMode]: (value) => isBoolean(value),
  [runtimeConfig.storageKeys.stage]: (value) => isString(value),
  [runtimeConfig.storageKeys.consentGiven]: (value) => isBoolean(value),
  [runtimeConfig.storageKeys.userDetailsSubmitted]: (value) => isBoolean(value),
  [runtimeConfig.storageKeys.emailVerified]: (value) => isBoolean(value),
  [runtimeConfig.storageKeys.sessionId]: (value) => isString(value),
  [runtimeConfig.storageKeys.publicId]: (value) => isString(value),
  [runtimeConfig.storageKeys.preAuthId]: (value) => isString(value),
  [runtimeConfig.storageKeys.preAuthMigrationLock]: (value) => isPlainObject(value),
  [runtimeConfig.storageKeys.preAuthMigrationDonePrefix]: (value) => isBoolean(value),
  [runtimeConfig.storageKeys.surveyCompleted]: (value) => Number.isInteger(value) && value >= 0,
  [runtimeConfig.storageKeys.surveyFeedbackReady]: (value) => isBoolean(value),
  [runtimeConfig.storageKeys.lastSubmissionSucceeded]: (value) => isBoolean(value),
  [runtimeConfig.storageKeys.shownImages]: (value) => isStringArray(value),
  [runtimeConfig.storageKeys.demographics]: (value) => {
    if (!isPlainObject(value)) return false;
    const allowed = ["username", "email", "gender_code", "age", "location", "language_code", "prior_experience"];
    return Object.keys(value).every((key) => allowed.includes(key) && (isString(value[key]) || value[key] === ""));
  },
  [runtimeConfig.storageKeys.survey]: (value) => {
    if (value == null) return true;
    if (!isPlainObject(value)) return false;
    const imageId = value.image_id ?? value.imageId;
    const imageUrl = value.url ?? value.image_url ?? value.imageUrl;
    if (imageId != null && !isString(imageId)) return false;
    if (imageUrl != null && !isString(imageUrl)) return false;
    return true;
  },
  [runtimeConfig.storageKeys.emailOtpState]: (value) => {
    if (!isPlainObject(value)) return false;
    const numericKeys = ["resendEndsAt", "otpExpiresAt"];
    return numericKeys.every((key) => value[key] == null || isFiniteNumber(value[key]));
  },
  [runtimeConfig.storageKeys.desktopLocationSession]: (value) => (
    isPlainObject(value)
    && (value.prompted == null || isBoolean(value.prompted))
    && (value.permission == null || isString(value.permission))
    && (value.value == null || isString(value.value))
  ),
  [runtimeConfig.storageKeys.reverseGeocodeState]: (value) => (
    isPlainObject(value)
    && (value.next_allowed_at == null || isFiniteNumber(value.next_allowed_at))
    && (value.fail_count == null || isFiniteNumber(value.fail_count))
  ),
  [runtimeConfig.storageKeys.telemetry]: (value) => isPlainObject(value),
  [runtimeConfig.storageKeys.clientErrorQueue]: (value) => Array.isArray(value),
  [runtimeConfig.storageKeys.telemetryBlocked]: (value) => isPlainObject(value),
};

function resolveBaseKey(key) {
  const rawKey = String(key || "").trim();
  if (!rawKey) return "";
  return rawKey.split(":")[0];
}

function validateStoredShape(key, value) {
  const baseKey = resolveBaseKey(key);
  const validate = STORAGE_SHAPE_VALIDATORS[baseKey];
  if (typeof validate !== "function") return true;
  try {
    return validate(value) === true;
  } catch {
    return false;
  }
}

function resolvePolicyArea(key, fallbackArea = STORAGE_AREAS.session) {
  const rawKey = String(key || "").trim();
  if (!rawKey) return fallbackArea;

  if (
    rawKey.startsWith(`${runtimeConfig.storageKeys.surveyDraftPrefix}_`) ||
    rawKey.startsWith(`${runtimeConfig.storageKeys.surveyDraftActivePrefix}_`)
  ) {
    return STORAGE_AREAS.local;
  }

  const baseKey = resolveBaseKey(rawKey);
  return STORAGE_AREA_POLICY[baseKey] || fallbackArea;
}

export function resolveStorageArea(key, fallbackArea = STORAGE_AREAS.session) {
  return resolvePolicyArea(key, fallbackArea);
}

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

export function readExpiringValue(key, fallback, options = {}) {
  const { schemaVersion = UI_STATE_SCHEMA_VERSION } = options;
  const area = resolvePolicyArea(key, options.area || STORAGE_AREAS.session);

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
    const data = parsed[STORAGE_ENVELOPE_FIELDS.data] ?? fallback;
    if (!validateStoredShape(key, data)) {
      storage.removeItem(key);
      return fallback;
    }
    return data;
  } catch {
    return fallback;
  }
}

export function writeExpiringValue(key, value, options = {}) {
  const { schemaVersion = UI_STATE_SCHEMA_VERSION, ttlMs = UI_STATE_TTL_MS } = options;
  const area = resolvePolicyArea(key, options.area || STORAGE_AREAS.session);

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

export function getPendingFlag(key, area = STORAGE_AREAS.session) {
  try {
    const storage = getStorageArea(resolvePolicyArea(key, area));
    return storage.getItem(key) === STORAGE_FLAG_VALUES.enabled;
  } catch {
    return false;
  }
}

export function setPendingFlag(key, area = STORAGE_AREAS.session) {
  try {
    const storage = getStorageArea(resolvePolicyArea(key, area));
    storage.setItem(key, STORAGE_FLAG_VALUES.enabled);
  } catch {
    // Ignore storage failures.
  }
}

export function clearPendingFlag(key, area = STORAGE_AREAS.session) {
  removeStoredKey(key, area);
}

export function forEachStoredKey(area = STORAGE_AREAS.session, callback) {
  try {
    const storage = getStorageArea(area);
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index);
      if (!key) continue;
      callback(key, index);
    }
  } catch {
    // Ignore storage iteration failures.
  }
}

export function createStorageAdapter(baseKey, options = {}) {
  const defaultSchemaVersion = options.schemaVersion !== undefined ? options.schemaVersion : UI_STATE_SCHEMA_VERSION;
  const defaultTtlMs = options.ttlMs !== undefined ? options.ttlMs : UI_STATE_TTL_MS;
  const defaultArea = resolvePolicyArea(baseKey, options.area || STORAGE_AREAS.session);
  const toScopedKey = (scope) => makeScopedKey(baseKey, scope);

  return {
    key: baseKey,
    area: defaultArea,
    scopedKey(scope) {
      return toScopedKey(scope);
    },
    read(scope, fallback, readOptions = {}) {
      const scopedKey = toScopedKey(scope);
      return readExpiringValue(scopedKey, fallback, {
        area: defaultArea,
        schemaVersion: readOptions.schemaVersion !== undefined ? readOptions.schemaVersion : defaultSchemaVersion,
        ttlMs: readOptions.ttlMs !== undefined ? readOptions.ttlMs : defaultTtlMs,
      });
    },
    write(scope, value, writeOptions = {}) {
      const scopedKey = toScopedKey(scope);
      writeExpiringValue(scopedKey, value, {
        area: defaultArea,
        schemaVersion: writeOptions.schemaVersion !== undefined ? writeOptions.schemaVersion : defaultSchemaVersion,
        ttlMs: writeOptions.ttlMs !== undefined ? writeOptions.ttlMs : defaultTtlMs,
      });
    },
    remove(scope) {
      removeStoredKey(toScopedKey(scope), defaultArea);
    },
    setPending(scope) {
      setPendingFlag(toScopedKey(scope), defaultArea);
    },
    getPending(scope) {
      return getPendingFlag(toScopedKey(scope), defaultArea);
    },
    clearPending(scope) {
      clearPendingFlag(toScopedKey(scope), defaultArea);
    },
  };
}
