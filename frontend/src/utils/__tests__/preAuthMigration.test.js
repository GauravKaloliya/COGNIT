import { beforeEach, describe, expect, it } from "vitest";
import { runtimeConfig } from "../../config/runtime";
import {
  clearPendingFlag,
  getPendingFlag,
  makeScopedKey,
  readExpiringValue,
  setPendingFlag,
  writeExpiringValue,
} from "../storage";
import { migratePreAuthScopeToPublic } from "../preAuthMigration";

function createStorageMock(shouldThrowOnSet = null) {
  const map = new Map();
  return {
    get length() {
      return map.size;
    },
    key(index) {
      return Array.from(map.keys())[index] ?? null;
    },
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      if (typeof shouldThrowOnSet === "function" && shouldThrowOnSet(String(key), String(value))) {
        throw new Error(`setItem blocked for key=${key}`);
      }
      map.set(String(key), String(value));
    },
    removeItem(key) {
      map.delete(String(key));
    },
    clear() {
      map.clear();
    },
  };
}

describe("preAuth migration", () => {
  beforeEach(() => {
    global.localStorage = createStorageMock();
    global.sessionStorage = createStorageMock();
  });

  it("migrates pre-auth data to public scope and cleans stale keys", () => {
    const preAuthId = "preauth_1";
    const publicId = "public_1";
    const preConsentDraftKey = makeScopedKey(runtimeConfig.storageKeys.consentDraft, preAuthId);
    const preDemographicsKey = makeScopedKey(runtimeConfig.storageKeys.demographics, preAuthId);
    const preOtpKey = makeScopedKey(runtimeConfig.storageKeys.emailOtpState, preAuthId);
    const surveyDraftKey = `${runtimeConfig.storageKeys.surveyDraftPrefix}_${preAuthId}_53.svg`;
    const surveyDraftActiveKey = `${runtimeConfig.storageKeys.surveyDraftActivePrefix}_${preAuthId}`;

    writeExpiringValue(preConsentDraftKey, true, {
      area: "local",
      schemaVersion: runtimeConfig.consentDraftSchemaVersion,
      ttlMs: runtimeConfig.consentDraftTtlMs,
    });
    writeExpiringValue(preDemographicsKey, { username: "alice", email: "a@b.com" }, {
      area: "local",
      schemaVersion: runtimeConfig.uiStateSchemaVersion,
      ttlMs: runtimeConfig.piiStateTtlMs,
    });
    writeExpiringValue(preOtpKey, { otpStatus: "sent", submittedEmail: "a@b.com" }, {
      area: "local",
      schemaVersion: runtimeConfig.uiStateSchemaVersion,
      ttlMs: runtimeConfig.uiStateTtlMs,
    });
    writeExpiringValue(surveyDraftKey, { imageId: "53.svg", description: "demo" }, {
      area: "local",
      schemaVersion: runtimeConfig.surveyDraftSchemaVersion,
      ttlMs: runtimeConfig.uiStateTtlMs,
    });
    writeExpiringValue(surveyDraftActiveKey, { imageId: "53.svg" }, {
      area: "local",
      schemaVersion: runtimeConfig.surveyDraftSchemaVersion,
      ttlMs: runtimeConfig.uiStateTtlMs,
    });

    setPendingFlag(makeScopedKey(runtimeConfig.storageKeys.consentPending, preAuthId), "session");
    setPendingFlag(makeScopedKey(runtimeConfig.storageKeys.userDetailsPending, preAuthId), "session");

    const events = [];
    const result = migratePreAuthScopeToPublic(
      { preAuthId, publicId },
      { ownerId: "tab_1", onEvent: (event) => events.push(event) }
    );

    expect(result.status).toBe("success");
    expect(result.movedCount).toBeGreaterThanOrEqual(3);
    expect(result.cleanedCount).toBeGreaterThanOrEqual(2);
    expect(events).toContain("preauth_migration_success");

    expect(readExpiringValue(preConsentDraftKey, null, { area: "local" })).toBeNull();
    expect(readExpiringValue(preDemographicsKey, null, { area: "local" })).toBeNull();
    expect(readExpiringValue(preOtpKey, null, { area: "local" })).toBeNull();
    expect(readExpiringValue(surveyDraftKey, null, { area: "local" })).toBeNull();
    expect(readExpiringValue(surveyDraftActiveKey, null, { area: "local" })).toBeNull();

    const publicConsentDraftKey = makeScopedKey(runtimeConfig.storageKeys.consentDraft, publicId);
    const publicDemographicsKey = makeScopedKey(runtimeConfig.storageKeys.demographics, publicId);
    const publicOtpKey = makeScopedKey(runtimeConfig.storageKeys.emailOtpState, publicId);
    expect(readExpiringValue(publicConsentDraftKey, false, { area: "local" })).toBe(true);
    expect(readExpiringValue(publicDemographicsKey, null, { area: "local" })).toMatchObject({ username: "alice" });
    expect(readExpiringValue(publicOtpKey, null, { area: "local" })).toMatchObject({ otpStatus: "sent" });

    expect(getPendingFlag(makeScopedKey(runtimeConfig.storageKeys.consentPending, preAuthId), "session")).toBe(false);
    expect(getPendingFlag(makeScopedKey(runtimeConfig.storageKeys.userDetailsPending, preAuthId), "session")).toBe(false);
    expect(getPendingFlag(makeScopedKey(runtimeConfig.storageKeys.consentPending, publicId), "session")).toBe(true);
    expect(getPendingFlag(makeScopedKey(runtimeConfig.storageKeys.userDetailsPending, publicId), "session")).toBe(true);

    clearPendingFlag(makeScopedKey(runtimeConfig.storageKeys.consentPending, publicId), "session");
    clearPendingFlag(makeScopedKey(runtimeConfig.storageKeys.userDetailsPending, publicId), "session");
  });

  it("skips migration when another tab owns live lock", () => {
    const now = Date.now();
    writeExpiringValue(runtimeConfig.storageKeys.preAuthMigrationLock, {
      ownerId: "other_tab",
      pairKey: "preauth_1->public_1",
      createdAt: now,
      expiresAt: now + 30000,
    }, {
      area: "local",
      schemaVersion: runtimeConfig.uiStateSchemaVersion,
      ttlMs: runtimeConfig.preAuthMigrationLockTtlMs,
    });

    const events = [];
    const result = migratePreAuthScopeToPublic(
      { preAuthId: "preauth_1", publicId: "public_1" },
      { ownerId: "tab_2", onEvent: (event) => events.push(event) }
    );

    expect(result.status).toBe("skipped_locked");
    expect(events).toContain("preauth_migration_skipped_locked");
  });

  it("is idempotent across refresh/re-entry once done marker exists", () => {
    const preAuthId = "preauth_1";
    const publicId = "public_1";
    const doneKey = `${runtimeConfig.storageKeys.preAuthMigrationDonePrefix}:${preAuthId}:${publicId}`;
    writeExpiringValue(doneKey, true, {
      area: "local",
      schemaVersion: runtimeConfig.uiStateSchemaVersion,
      ttlMs: runtimeConfig.preAuthMigrationDoneTtlMs,
    });

    const events = [];
    const result = migratePreAuthScopeToPublic(
      { preAuthId, publicId },
      { ownerId: "tab_refresh", onEvent: (event) => events.push(event) }
    );

    expect(result.status).toBe("skipped_idempotent");
    expect(events).toContain("preauth_migration_skipped_idempotent");
  });

  it("returns partial when migration is interrupted, then succeeds on next refresh", () => {
    const preAuthId = "preauth_partial";
    const publicId = "public_partial";
    const preConsentDraftKey = makeScopedKey(runtimeConfig.storageKeys.consentDraft, preAuthId);
    const preDemographicsKey = makeScopedKey(runtimeConfig.storageKeys.demographics, preAuthId);
    const publicDemographicsKey = makeScopedKey(runtimeConfig.storageKeys.demographics, publicId);

    writeExpiringValue(preConsentDraftKey, true, {
      area: "local",
      schemaVersion: runtimeConfig.consentDraftSchemaVersion,
      ttlMs: runtimeConfig.consentDraftTtlMs,
    });
    writeExpiringValue(preDemographicsKey, { username: "broken" }, {
      area: "local",
      schemaVersion: runtimeConfig.uiStateSchemaVersion,
      ttlMs: runtimeConfig.piiStateTtlMs,
    });

    global.localStorage = createStorageMock((key) => key === publicDemographicsKey);
    writeExpiringValue(preConsentDraftKey, true, {
      area: "local",
      schemaVersion: runtimeConfig.consentDraftSchemaVersion,
      ttlMs: runtimeConfig.consentDraftTtlMs,
    });
    writeExpiringValue(preDemographicsKey, { username: "broken" }, {
      area: "local",
      schemaVersion: runtimeConfig.uiStateSchemaVersion,
      ttlMs: runtimeConfig.piiStateTtlMs,
    });

    const partialEvents = [];
    const partial = migratePreAuthScopeToPublic(
      { preAuthId, publicId },
      { ownerId: "tab_partial", onEvent: (event) => partialEvents.push(event) }
    );
    expect(partial.status).toBe("partial");
    expect(partial.errors.length).toBeGreaterThan(0);
    expect(partialEvents).toContain("preauth_migration_partial");

    global.localStorage = createStorageMock();
    global.sessionStorage = createStorageMock();
    writeExpiringValue(preDemographicsKey, { username: "recovered" }, {
      area: "local",
      schemaVersion: runtimeConfig.uiStateSchemaVersion,
      ttlMs: runtimeConfig.piiStateTtlMs,
    });

    const retryEvents = [];
    const retry = migratePreAuthScopeToPublic(
      { preAuthId, publicId },
      { ownerId: "tab_partial_retry", onEvent: (event) => retryEvents.push(event) }
    );
    expect(retry.status).toBe("success");
    expect(readExpiringValue(publicDemographicsKey, null, { area: "local" })).toMatchObject({ username: "recovered" });
    expect(retryEvents).toContain("preauth_migration_success");
  });
});
