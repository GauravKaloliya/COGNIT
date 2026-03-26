import { runtimeConfig } from "../config/runtime";
import {
  ALL_STORAGE_AREAS,
  clearPendingFlag,
  forEachStoredKey,
  getPendingFlag,
  makeScopedKey,
  readExpiringValue,
  readStoredMeta,
  removeStoredKey,
  setPendingFlag,
  writeExpiringValue,
} from "./storage";

const MIGRATION_EVENTS = {
  success: "preauth_migration_success",
  failed: "preauth_migration_failed",
  partial: "preauth_migration_partial",
  skippedLocked: "preauth_migration_skipped_locked",
  skippedIdempotent: "preauth_migration_skipped_idempotent",
  skippedInvalid: "preauth_migration_skipped_invalid",
};

function nowMs() {
  return Date.now();
}

function doneKeyForPair(preAuthId, publicId) {
  return `${runtimeConfig.storageKeys.preAuthMigrationDonePrefix}:${preAuthId}:${publicId}`;
}

function withDefaultDeps(deps = {}) {
  return {
    now: deps.now || nowMs,
    onEvent: deps.onEvent || (() => {}),
    ownerId: String(deps.ownerId || ""),
    readLock: deps.readLock || (() => readExpiringValue(runtimeConfig.storageKeys.preAuthMigrationLock, null, {
      area: "local",
      schemaVersion: runtimeConfig.uiStateSchemaVersion,
      ttlMs: runtimeConfig.preAuthMigrationLockTtlMs,
    })),
    writeLock: deps.writeLock || ((payload) => writeExpiringValue(runtimeConfig.storageKeys.preAuthMigrationLock, payload, {
      area: "local",
      schemaVersion: runtimeConfig.uiStateSchemaVersion,
      ttlMs: runtimeConfig.preAuthMigrationLockTtlMs,
    })),
    removeLock: deps.removeLock || (() => removeStoredKey(runtimeConfig.storageKeys.preAuthMigrationLock, "local")),
  };
}

function acquireLock({ pairKey, lockTtlMs }, deps) {
  const now = deps.now();
  const existing = deps.readLock();
  if (existing && typeof existing === "object") {
    const expiresAt = Number(existing.expiresAt || 0);
    const hasLiveLock = expiresAt > now;
    if (hasLiveLock && existing.ownerId && existing.ownerId !== deps.ownerId) {
      return false;
    }
  }
  const payload = {
    ownerId: deps.ownerId,
    pairKey,
    createdAt: now,
    expiresAt: now + Math.max(1000, Number(lockTtlMs || 10000)),
  };
  deps.writeLock(payload);
  const verify = deps.readLock();
  return Boolean(verify && verify.ownerId === deps.ownerId && verify.pairKey === pairKey);
}

function releaseLock(deps) {
  const current = deps.readLock();
  if (current && current.ownerId && current.ownerId !== deps.ownerId) return;
  deps.removeLock();
}

function migrateExpiringScopedValue(preAuthId, publicId, baseKey, { area = "local", ttlMs = runtimeConfig.uiStateTtlMs } = {}) {
  const fromKey = makeScopedKey(baseKey, preAuthId);
  const toKey = makeScopedKey(baseKey, publicId);
  const meta = readStoredMeta(fromKey, area);
  if (!meta) return false;
  const value = readExpiringValue(fromKey, null, {
    area,
    schemaVersion: runtimeConfig.uiStateSchemaVersion,
    ttlMs,
  });
  writeExpiringValue(toKey, value, {
    area,
    schemaVersion: runtimeConfig.uiStateSchemaVersion,
    ttlMs,
  });
  const wroteMeta = readStoredMeta(toKey, area);
  if (!wroteMeta) {
    throw new Error(`write_failed:${toKey}`);
  }
  removeStoredKey(fromKey, area);
  return true;
}

function migratePendingFlags(preAuthId, publicId) {
  let moved = 0;
  const keys = [
    runtimeConfig.storageKeys.consentPending,
    runtimeConfig.storageKeys.userDetailsPending,
  ];
  keys.forEach((baseKey) => {
    const fromKey = makeScopedKey(baseKey, preAuthId);
    const toKey = makeScopedKey(baseKey, publicId);
    if (getPendingFlag(fromKey, "session")) {
      setPendingFlag(toKey, "session");
      clearPendingFlag(fromKey, "session");
      moved += 1;
    }
  });
  return moved;
}

function cleanupStalePreAuthScope(preAuthId) {
  let cleaned = 0;
  const scopedSuffix = `:${preAuthId}`;
  const draftPrefix = `${runtimeConfig.storageKeys.surveyDraftPrefix}_${preAuthId}_`;
  const activeDraftKey = `${runtimeConfig.storageKeys.surveyDraftActivePrefix}_${preAuthId}`;

  ALL_STORAGE_AREAS.forEach((area) => {
    forEachStoredKey(area, (key) => {
      if (!key) return;
      if (key.endsWith(scopedSuffix) || key.startsWith(draftPrefix) || key === activeDraftKey) {
        removeStoredKey(key, area);
        cleaned += 1;
      }
    });
  });
  return cleaned;
}

export function migratePreAuthScopeToPublic({ preAuthId, publicId }, depsInput = {}) {
  const deps = withDefaultDeps(depsInput);
  const preAuth = String(preAuthId || "").trim();
  const pub = String(publicId || "").trim();
  if (!preAuth || !pub || preAuth === pub) {
    deps.onEvent(MIGRATION_EVENTS.skippedInvalid);
    return { status: "skipped_invalid", movedCount: 0, cleanedCount: 0, errors: [] };
  }

  const pairKey = `${preAuth}->${pub}`;
  const doneKey = doneKeyForPair(preAuth, pub);
  const done = readExpiringValue(doneKey, false, {
    area: "local",
    schemaVersion: runtimeConfig.uiStateSchemaVersion,
    ttlMs: runtimeConfig.preAuthMigrationDoneTtlMs,
  });
  if (done === true) {
    deps.onEvent(MIGRATION_EVENTS.skippedIdempotent);
    return { status: "skipped_idempotent", movedCount: 0, cleanedCount: 0, errors: [] };
  }

  const acquired = acquireLock({ pairKey, lockTtlMs: runtimeConfig.preAuthMigrationLockTtlMs }, deps);
  if (!acquired) {
    deps.onEvent(MIGRATION_EVENTS.skippedLocked);
    return { status: "skipped_locked", movedCount: 0, cleanedCount: 0, errors: [] };
  }

  const errors = [];
  let movedCount = 0;
  let cleanedCount = 0;
  try {
    try {
      if (migrateExpiringScopedValue(preAuth, pub, runtimeConfig.storageKeys.consentDraft, {
        area: "local",
        ttlMs: runtimeConfig.consentDraftTtlMs,
      })) {
        movedCount += 1;
      }
    } catch (error) {
      errors.push(`consentDraft:${String(error?.message || "unknown")}`);
    }

    try {
      if (migrateExpiringScopedValue(preAuth, pub, runtimeConfig.storageKeys.demographics, {
        area: "local",
        ttlMs: runtimeConfig.piiStateTtlMs,
      })) {
        movedCount += 1;
      }
    } catch (error) {
      errors.push(`demographics:${String(error?.message || "unknown")}`);
    }

    try {
      if (migrateExpiringScopedValue(preAuth, pub, runtimeConfig.storageKeys.emailOtpState, {
        area: "local",
        ttlMs: Math.max(30000, (runtimeConfig.emailOtpExpirySeconds || 300) * 1000),
      })) {
        movedCount += 1;
      }
    } catch (error) {
      errors.push(`emailOtpState:${String(error?.message || "unknown")}`);
    }

    try {
      movedCount += migratePendingFlags(preAuth, pub);
    } catch (error) {
      errors.push(`pending:${String(error?.message || "unknown")}`);
    }

    try {
      cleanedCount += cleanupStalePreAuthScope(preAuth);
    } catch (error) {
      errors.push(`cleanup:${String(error?.message || "unknown")}`);
    }

    if (errors.length === 0) {
      writeExpiringValue(doneKey, true, {
        area: "local",
        schemaVersion: runtimeConfig.uiStateSchemaVersion,
        ttlMs: runtimeConfig.preAuthMigrationDoneTtlMs,
      });
      deps.onEvent(MIGRATION_EVENTS.success);
      return { status: "success", movedCount, cleanedCount, errors };
    }

    deps.onEvent(MIGRATION_EVENTS.partial);
    return { status: "partial", movedCount, cleanedCount, errors };
  } catch (error) {
    deps.onEvent(MIGRATION_EVENTS.failed);
    return {
      status: "failed",
      movedCount,
      cleanedCount,
      errors: [...errors, `fatal:${String(error?.message || "unknown")}`],
    };
  } finally {
    releaseLock(deps);
  }
}

export { MIGRATION_EVENTS };
