import { forEachStorageArea, readExpiringValue, removeStoredKey, writeExpiringValue } from "./storage";

function migrateScopedValue({ scopedKey, legacyKey, readOptions }) {
  const scopedSession = readExpiringValue(scopedKey, null, { ...readOptions, area: "session" });
  if (scopedSession) {
    try {
      writeExpiringValue(scopedKey, scopedSession, { ...readOptions, area: "local" });
    } catch {
      // Ignore migration failures.
    }
    removeStoredKey(scopedKey, "session");
    return scopedSession;
  }

  const legacy =
    readExpiringValue(legacyKey, null, { ...readOptions, area: "local" }) ||
    readExpiringValue(legacyKey, null, { ...readOptions, area: "session" });
  if (!legacy) return null;
  try {
    writeExpiringValue(scopedKey, legacy, { ...readOptions, area: "local" });
  } catch {
    // Ignore migration failures.
  }
  removeStoredKey(legacyKey, "local");
  removeStoredKey(legacyKey, "session");
  removeStoredKey(scopedKey, "session");
  return legacy;
}

export function savePaymentViewState({ isOnline, scopedPaymentStateKey, paymentStateKey, schemaVersion, ttlMs, state }) {
  if (!isOnline) return;
  try {
    writeExpiringValue(scopedPaymentStateKey, { ...(state || {}) }, {
      area: "local",
      schemaVersion,
      ttlMs,
    });
    removeStoredKey(paymentStateKey, "session");
    removeStoredKey(paymentStateKey, "local");
  } catch {
    // Ignore storage failures.
  }
}

export function clearPaymentScopedState({ paymentStateKey, scopedPaymentStateKey, paymentTokenKey, scopedPaymentTokenKey }) {
  forEachStorageArea((area) => {
    removeStoredKey(paymentStateKey, area);
    removeStoredKey(scopedPaymentStateKey, area);
    removeStoredKey(paymentTokenKey, area);
    removeStoredKey(scopedPaymentTokenKey, area);
  });
}

export function saveScopedPaymentToken({ token, paymentId = null, scopedPaymentTokenKey, paymentTokenKey, schemaVersion, ttlMs }) {
  if (!token) return;
  try {
    writeExpiringValue(scopedPaymentTokenKey, {
      token,
      paymentId: paymentId || null,
      mintedAt: Date.now(),
    }, {
      area: "local",
      schemaVersion,
      ttlMs,
    });
    removeStoredKey(paymentTokenKey, "session");
    removeStoredKey(paymentTokenKey, "local");
  } catch {
    // Ignore storage failures.
  }
}

function normalizeTokenValue(value) {
  if (!value) return null;
  if (typeof value === "string") return { token: value, paymentId: null };
  if (typeof value === "object" && value.token) return value;
  return null;
}

export function loadScopedPaymentToken({ expectedPaymentId = null, scopedPaymentTokenKey, paymentTokenKey, schemaVersion, ttlMs }) {
  try {
    const readOptions = { schemaVersion, ttlMs };
    const scopedLocal = normalizeTokenValue(readExpiringValue(scopedPaymentTokenKey, null, { ...readOptions, area: "local" }));
    const isMatch = (value) => !expectedPaymentId || !value?.paymentId || value.paymentId === expectedPaymentId;
    if (scopedLocal && isMatch(scopedLocal)) return scopedLocal.token;

    const migrated = normalizeTokenValue(migrateScopedValue({
      scopedKey: scopedPaymentTokenKey,
      legacyKey: paymentTokenKey,
      readOptions,
    }));
    if (migrated && isMatch(migrated)) return migrated.token;
  } catch {
    // Ignore storage failures.
  }
  return null;
}

export function loadPaymentViewState({ publicId, scopedPaymentStateKey, paymentStateKey, schemaVersion, ttlMs, publicIdField }) {
  try {
    const readOptions = { schemaVersion, ttlMs };
    let data = readExpiringValue(scopedPaymentStateKey, null, { ...readOptions, area: "local" });
    if (!data) {
      data = migrateScopedValue({
        scopedKey: scopedPaymentStateKey,
        legacyKey: paymentStateKey,
        readOptions,
      });
    }
    if (!data || data[publicIdField] !== publicId) return null;
    return data;
  } catch {
    return null;
  }
}

export function saveScopedPaymentId({ paymentId, scopedPaymentIdKey, paymentIdKey, schemaVersion, ttlMs }) {
  writeExpiringValue(scopedPaymentIdKey, paymentId, {
    area: "local",
    schemaVersion,
    ttlMs,
  });
  removeStoredKey(paymentIdKey, "session");
  removeStoredKey(paymentIdKey, "local");
}

export function loadStoredPaymentId({ scopedPaymentIdKey, paymentIdKey, schemaVersion, ttlMs }) {
  try {
    const readOptions = { schemaVersion, ttlMs };
    const localValue = readExpiringValue(scopedPaymentIdKey, null, { ...readOptions, area: "local" });
    if (localValue) return localValue;
    return migrateScopedValue({
      scopedKey: scopedPaymentIdKey,
      legacyKey: paymentIdKey,
      readOptions,
    });
  } catch {
    // Ignore storage failures.
  }
  return null;
}

export function saveTimerState({ scopedPaymentTimerKey, paymentTimerKey, schemaVersion, ttlMs, expiresAt, totalDurationMs, paused = null }) {
  writeExpiringValue(scopedPaymentTimerKey, {
    expiresAt,
    totalDurationMs: Math.max(1000, totalDurationMs || 1000),
    pausedRemainingMs: paused?.remainingMs ?? null,
    pausedAt: paused?.pausedAt ?? null,
  }, {
    area: "local",
    schemaVersion,
    ttlMs,
  });
  removeStoredKey(paymentTimerKey, "session");
  removeStoredKey(paymentTimerKey, "local");
}

export function clearScopedTimerState({ paymentTimerKey, scopedPaymentTimerKey }) {
  forEachStorageArea((area) => {
    removeStoredKey(paymentTimerKey, area);
    removeStoredKey(scopedPaymentTimerKey, area);
  });
}

export function getStoredTimerState({ scopedPaymentTimerKey, paymentTimerKey, schemaVersion, ttlMs }) {
  const readOptions = { schemaVersion, ttlMs };
  let value = readExpiringValue(scopedPaymentTimerKey, null, { ...readOptions, area: "local" });
  if (!value) {
    value = migrateScopedValue({
      scopedKey: scopedPaymentTimerKey,
      legacyKey: paymentTimerKey,
      readOptions,
    });
  }
  if (typeof value === "string") {
    return { expiresAt: value, totalDurationMs: null, pausedRemainingMs: null, pausedAt: null };
  }
  if (value && typeof value === "object") {
    return {
      expiresAt: value.expiresAt || null,
      totalDurationMs: Number.isFinite(Number(value.totalDurationMs)) ? Number(value.totalDurationMs) : null,
      pausedRemainingMs: Number.isFinite(Number(value.pausedRemainingMs)) ? Number(value.pausedRemainingMs) : null,
      pausedAt: Number.isFinite(Number(value.pausedAt)) ? Number(value.pausedAt) : null,
    };
  }
  return null;
}
