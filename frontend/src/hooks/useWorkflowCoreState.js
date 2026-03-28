import { useCallback, useEffect, useReducer, useState } from "react";
import { runtimeConfig } from "../config/runtime";
import { uiText } from "../utils/uiText";
import {
  ALL_STORAGE_AREAS,
  forEachStoredKey,
  forEachStorageArea,
  getStoredValue,
  makeScopedKey,
  readExpiringValue,
  readStoredMeta,
  removeStoredKey,
  writeExpiringValue,
} from "../utils/storage";
import { APP_FLOW, normalizeAppStage } from "../config/appFlow";
import { getScopeId, readCoreValue, writeCoreValue } from "../utils/appControllerState";
import {
  createWorkflowState,
  EMPTY_DEMOGRAPHICS,
  workflowStateReducer,
  WORKFLOW_EVENT_TYPES,
} from "../utils/workflowStateMachine";

const CORE_STATE_STORAGE_AREA = "local";
const PII_STATE_TTL_MS = runtimeConfig.piiStateTtlMs;
const SESSION_ALIVE_KEY = runtimeConfig.storageKeys.sessionAlive;
const EXPIRED_STORAGE_PREFIXES = Object.values(runtimeConfig.storageKeys);
const RESTORE_BASE_KEYS = [
  runtimeConfig.storageKeys.stage,
  runtimeConfig.storageKeys.consentGiven,
  runtimeConfig.storageKeys.userDetailsSubmitted,
  runtimeConfig.storageKeys.emailVerified,
  runtimeConfig.storageKeys.demographics,
  runtimeConfig.storageKeys.survey,
  runtimeConfig.storageKeys.surveyCompleted,
];

function generatePreAuthId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `preauth_${crypto.randomUUID()}`;
  }
  return `preauth_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function readStoredSurvey(scopeId) {
  const survey = readCoreValue(runtimeConfig.storageKeys.survey, null, scopeId);
  if (!survey || typeof survey !== "object") return null;
  const imageId = String(survey.image_id || survey.imageId || "").trim();
  const imageUrl = String(survey.url || survey.image_url || survey.imageUrl || "").trim();
  return imageId && imageUrl ? { imageId, imageUrl } : null;
}

function buildScopeSnapshot(scope) {
  const scopeId = getScopeId(scope);
  if (!scopeId) return null;
  const isPreAuthScope = scopeId.startsWith("preauth_");

  const survey = readStoredSurvey(scopeId);
  const stage = normalizeAppStage(
    readCoreValue(runtimeConfig.storageKeys.stage, APP_FLOW.stages.consent, scopeId)
  );
  const consentGiven = readCoreValue(runtimeConfig.storageKeys.consentGiven, false, scopeId) === true;
  const userDetailsSubmitted = readCoreValue(runtimeConfig.storageKeys.userDetailsSubmitted, false, scopeId) === true;
  const emailVerified = readCoreValue(runtimeConfig.storageKeys.emailVerified, false, scopeId) === true;
  const surveyCompleted = Math.max(0, Number(readCoreValue(runtimeConfig.storageKeys.surveyCompleted, 0, scopeId)) || 0);
  const savedAt = Math.max(
    Number(readStoredMeta(makeScopedKey(runtimeConfig.storageKeys.stage, scopeId), CORE_STATE_STORAGE_AREA)?.savedAt) || 0,
    Number(readStoredMeta(makeScopedKey(runtimeConfig.storageKeys.survey, scopeId), CORE_STATE_STORAGE_AREA)?.savedAt) || 0,
    Number(readStoredMeta(makeScopedKey(runtimeConfig.storageKeys.userDetailsSubmitted, scopeId), CORE_STATE_STORAGE_AREA)?.savedAt) || 0,
    Number(readStoredMeta(makeScopedKey(runtimeConfig.storageKeys.emailVerified, scopeId), CORE_STATE_STORAGE_AREA)?.savedAt) || 0,
  );

  return {
    publicId: isPreAuthScope ? "" : scopeId,
    sessionId: readCoreValue(runtimeConfig.storageKeys.sessionId, "", scopeId),
    stage,
    consentGiven,
    userDetailsSubmitted,
    emailVerified,
    demographics: readCoreValue(runtimeConfig.storageKeys.demographics, EMPTY_DEMOGRAPHICS, scopeId, { ttlMs: PII_STATE_TTL_MS }),
    hasSurvey: Boolean(survey),
    surveyCompleted,
    savedAt,
    score:
      (survey ? 1000 : 0)
      + (emailVerified ? 200 : 0)
      + (userDetailsSubmitted ? 100 : 0)
      + (consentGiven ? 50 : 0)
      + (surveyCompleted * 10)
      + ({
        [APP_FLOW.stages.consent]: 1,
        [APP_FLOW.stages.userDetails]: 2,
        [APP_FLOW.stages.survey]: 3,
        [APP_FLOW.stages.postSurvey]: 4,
      }[stage] || 0),
  };
}

function getCandidateScopes() {
  const scopes = new Set();
  const rootPublicId = getScopeId(getStoredValue(runtimeConfig.storageKeys.publicId, "", { area: CORE_STATE_STORAGE_AREA }));
  if (rootPublicId) scopes.add(rootPublicId);
  const rootPreAuthId = getScopeId(getStoredValue(runtimeConfig.storageKeys.preAuthId, "", { area: CORE_STATE_STORAGE_AREA }));
  if (rootPreAuthId) scopes.add(rootPreAuthId);

  forEachStoredKey(CORE_STATE_STORAGE_AREA, (key) => {
    const rawKey = String(key || "");
    const separator = rawKey.indexOf(":");
    if (separator <= 0) return;
    const baseKey = rawKey.slice(0, separator);
    if (!RESTORE_BASE_KEYS.includes(baseKey)) return;
    const scope = getScopeId(rawKey.slice(separator + 1));
    if (scope) scopes.add(scope);
  });

  return Array.from(scopes);
}

function findBestStoredSnapshot() {
  let best = null;
  getCandidateScopes().forEach((scope) => {
    const snapshot = buildScopeSnapshot(scope);
    if (!snapshot) return;
    if (!best || snapshot.score > best.score || (snapshot.score === best.score && snapshot.savedAt > best.savedAt)) {
      best = snapshot;
    }
  });
  return best;
}

function removeExpiredStorage(addToast, publicId) {
  const now = Date.now();
  const currentScope = getScopeId(publicId);
  let expiredFoundForCurrentSession = false;

  const isCurrentSessionKey = (key) => {
    if (key === runtimeConfig.storageKeys.publicId) return true;
    const [baseKey, scopedPart] = String(key || "").split(":");
    return scopedPart === currentScope && RESTORE_BASE_KEYS.includes(baseKey);
  };

  ALL_STORAGE_AREAS.forEach((area) => {
    forEachStoredKey(area, (key) => {
      if (!key || !EXPIRED_STORAGE_PREFIXES.some((prefix) => key === prefix || key.startsWith(`${prefix}:`) || key.startsWith(`${prefix}_`))) {
        return;
      }
      const meta = readStoredMeta(key, area);
      if (!meta || typeof meta.expiresAt !== "number" || now <= meta.expiresAt) return;
      if (isCurrentSessionKey(key)) {
        expiredFoundForCurrentSession = true;
      }
      removeStoredKey(key, area);
    });
  });

  if (expiredFoundForCurrentSession) {
    addToast(uiText("app.sessionExpired"), "info");
  }
}

export function useWorkflowCoreState({ addToast }) {
  const initialSnapshot = findBestStoredSnapshot();
  const [workflowState, dispatchWorkflow] = useReducer(
    workflowStateReducer,
    initialSnapshot,
    createWorkflowState
  );
  const [preAuthId, setPreAuthId] = useState(() => (
    getStoredValue(runtimeConfig.storageKeys.preAuthId, "", { area: CORE_STATE_STORAGE_AREA }) || ""
  ));
  const [sessionHydrated, setSessionHydrated] = useState(Boolean(initialSnapshot?.publicId));
  const [frontendSessionExpired] = useState(false);
  const scopeId = getScopeId(workflowState.publicId || preAuthId);
  const publicId = workflowState.publicId;

  const updateWorkflowState = useCallback((patch) => {
    dispatchWorkflow({
      type: WORKFLOW_EVENT_TYPES.PATCH,
      patch,
    });
  }, []);

  const resetWorkflowState = useCallback((nextState) => {
    dispatchWorkflow({
      type: WORKFLOW_EVENT_TYPES.RESET_TO_CONSENT,
      nextState: {
        publicId: "",
        sessionId: "",
        stage: APP_FLOW.stages.consent,
        consentGiven: false,
        userDetailsSubmitted: false,
        emailVerified: false,
        demographics: EMPTY_DEMOGRAPHICS,
        ...(nextState || {}),
      },
    });
  }, []);

  useEffect(() => {
    removeExpiredStorage(addToast, publicId);
  }, [addToast, publicId]);

  useEffect(() => {
    if (!publicId) return;
    const snapshot = buildScopeSnapshot(publicId);
    if (!snapshot) return;
    dispatchWorkflow({
      type: WORKFLOW_EVENT_TYPES.HYDRATE_SCOPE,
      snapshot: {
        publicId,
        sessionId: snapshot.sessionId || "",
        stage: snapshot.stage,
        consentGiven: snapshot.consentGiven,
        userDetailsSubmitted: snapshot.userDetailsSubmitted,
        emailVerified: snapshot.emailVerified,
        demographics: snapshot.demographics || EMPTY_DEMOGRAPHICS,
      },
    });
  }, [publicId]);

  useEffect(() => {
    const bestSnapshot = findBestStoredSnapshot();
    if (!bestSnapshot?.publicId || bestSnapshot.publicId === publicId) return;
    dispatchWorkflow({
      type: WORKFLOW_EVENT_TYPES.HYDRATE_SCOPE,
      snapshot: {
        publicId: bestSnapshot.publicId,
        sessionId: bestSnapshot.sessionId || "",
        stage: bestSnapshot.stage,
        consentGiven: bestSnapshot.consentGiven,
        userDetailsSubmitted: bestSnapshot.userDetailsSubmitted,
        emailVerified: bestSnapshot.emailVerified,
        demographics: bestSnapshot.demographics || EMPTY_DEMOGRAPHICS,
      },
    });
  }, [publicId]);

  useEffect(() => {
    const normalizedStage = normalizeAppStage(workflowState.stage);
    if (normalizedStage !== workflowState.stage) {
      dispatchWorkflow({
        type: WORKFLOW_EVENT_TYPES.PATCH,
        patch: { stage: normalizedStage },
      });
    }
  }, [workflowState.stage]);

  useEffect(() => {
    if (preAuthId) return;
    const nextPreAuthId = generatePreAuthId();
    setPreAuthId(nextPreAuthId);
    writeExpiringValue(runtimeConfig.storageKeys.preAuthId, nextPreAuthId, {
      area: CORE_STATE_STORAGE_AREA,
      schemaVersion: runtimeConfig.uiStateSchemaVersion,
      ttlMs: runtimeConfig.uiStateTtlMs,
    });
  }, [preAuthId]);

  useEffect(() => {
    writeExpiringValue(SESSION_ALIVE_KEY, "1", {
      area: "session",
      schemaVersion: runtimeConfig.uiStateSchemaVersion,
      ttlMs: runtimeConfig.uiStateTtlMs,
    });
  }, []);

  const clearUserStorage = useCallback((scopeOverride = null, options = {}) => {
    const clearAll = options?.clearAll === true;
    const preserveDarkMode = options?.preserveDarkMode !== false;
    const preserveKeys = Array.isArray(options?.preserveKeys) ? options.preserveKeys.filter(Boolean) : [];
    const preserveRootValues = options?.preserveRootValues && typeof options.preserveRootValues === "object"
      ? options.preserveRootValues
      : null;
    const preserveScopedValues = options?.preserveScopedValues && typeof options.preserveScopedValues === "object"
      ? options.preserveScopedValues
      : null;
    const dropPreAuthScope = options?.dropPreAuthScope === true;
    const preservedDarkMode = preserveDarkMode
      ? readExpiringValue(runtimeConfig.storageKeys.darkMode, null, {
        area: "local",
        schemaVersion: runtimeConfig.uiStateSchemaVersion,
        ttlMs: runtimeConfig.uiStateTtlMs,
      })
      : null;

    if (clearAll) {
      forEachStorageArea((area) => {
        forEachStoredKey(area, (key) => {
          if (key) {
            removeStoredKey(key, area);
          }
        });
      });

      if (typeof preservedDarkMode === "boolean") {
        writeExpiringValue(runtimeConfig.storageKeys.darkMode, preservedDarkMode, {
          area: "local",
          schemaVersion: runtimeConfig.uiStateSchemaVersion,
          ttlMs: runtimeConfig.uiStateTtlMs,
        });
      }
      return;
    }

    const targetScope = getScopeId(scopeOverride || publicId);
    const preservedEntries = [];
    preserveKeys.forEach((key) => {
      forEachStorageArea((area) => {
        const rootMeta = readStoredMeta(key, area);
        if (rootMeta) {
          preservedEntries.push({
            key,
            area,
            value: getStoredValue(key, null, { area }),
            meta: rootMeta,
          });
        }
        if (targetScope) {
          const scopedKey = makeScopedKey(key, targetScope);
          const scopedMeta = readStoredMeta(scopedKey, area);
          if (scopedMeta) {
            preservedEntries.push({
              key: scopedKey,
              area,
              value: getStoredValue(scopedKey, null, { area }),
              meta: scopedMeta,
            });
          }
        }
      });
    });
    const keysToClear = [
      runtimeConfig.storageKeys.activeTabLock,
      runtimeConfig.storageKeys.publicId,
      runtimeConfig.storageKeys.preAuthId,
      runtimeConfig.storageKeys.stage,
      runtimeConfig.storageKeys.consentGiven,
      runtimeConfig.storageKeys.userDetailsSubmitted,
      runtimeConfig.storageKeys.emailVerified,
      runtimeConfig.storageKeys.demographics,
      runtimeConfig.storageKeys.survey,
      runtimeConfig.storageKeys.surveyCompleted,
      runtimeConfig.storageKeys.surveyFeedbackReady,
      runtimeConfig.storageKeys.lastSubmissionSucceeded,
      runtimeConfig.storageKeys.shownImages,
      runtimeConfig.storageKeys.sessionId,
      runtimeConfig.storageKeys.emailOtpState,
      runtimeConfig.storageKeys.consentDraft,
      runtimeConfig.storageKeys.consentPending,
      runtimeConfig.storageKeys.userDetailsPending,
      runtimeConfig.storageKeys.surveyPendingSubmit,
      runtimeConfig.storageKeys.surveyFeedPendingContinue,
      runtimeConfig.storageKeys.surveyFeedPendingFinish,
      runtimeConfig.storageKeys.participantOptions,
      runtimeConfig.storageKeys.autoLocationPrompt,
      runtimeConfig.storageKeys.autoLocationSuccess,
      runtimeConfig.storageKeys.desktopLocationSession,
      runtimeConfig.storageKeys.reverseGeocodeState,
      runtimeConfig.storageKeys.telemetry,
      runtimeConfig.storageKeys.clientErrorQueue,
      runtimeConfig.storageKeys.telemetryBlocked,
      runtimeConfig.storageKeys.sessionAlive,
    ];

    keysToClear.forEach((key) => {
      forEachStorageArea((area) => {
        removeStoredKey(key, area);
        if (targetScope) {
          removeStoredKey(makeScopedKey(key, targetScope), area);
        }
      });
    });

    [runtimeConfig.storageKeys.surveyDraftPrefix, runtimeConfig.storageKeys.surveyDraftActivePrefix]
      .filter(Boolean)
      .forEach((prefix) => {
        forEachStorageArea((area) => {
          forEachStoredKey(area, (key) => {
            if (key?.startsWith(`${prefix}_`)) {
              removeStoredKey(key, area);
            }
          });
        });
      });

    if (dropPreAuthScope && preAuthId) {
      const staleScope = getScopeId(preAuthId);
      if (staleScope) {
        forEachStorageArea((area) => {
          forEachStoredKey(area, (key) => {
            if (!key) return;
            if (key.endsWith(`:${staleScope}`)) {
              removeStoredKey(key, area);
              return;
            }
            if (key.startsWith(`${runtimeConfig.storageKeys.surveyDraftPrefix}_${staleScope}_`)) {
              removeStoredKey(key, area);
              return;
            }
            if (key === `${runtimeConfig.storageKeys.surveyDraftActivePrefix}_${staleScope}`) {
              removeStoredKey(key, area);
            }
          });
        });
      }
    }

    if (typeof preservedDarkMode === "boolean") {
      writeExpiringValue(runtimeConfig.storageKeys.darkMode, preservedDarkMode, {
        area: "local",
        schemaVersion: runtimeConfig.uiStateSchemaVersion,
        ttlMs: runtimeConfig.uiStateTtlMs,
      });
    }

    preservedEntries.forEach(({ key, area, value, meta }) => {
      writeExpiringValue(key, value, {
        area,
        schemaVersion: meta?.schemaVersion ?? runtimeConfig.uiStateSchemaVersion,
        ttlMs: Math.max(
          0,
          Number(meta?.expiresAt || 0) - Date.now(),
        ) || runtimeConfig.uiStateTtlMs,
      });
    });

    if (preserveRootValues) {
      Object.entries(preserveRootValues).forEach(([key, value]) => {
        if (!key) return;
        writeExpiringValue(key, value, {
          area: CORE_STATE_STORAGE_AREA,
          schemaVersion: runtimeConfig.uiStateSchemaVersion,
          ttlMs: runtimeConfig.uiStateTtlMs,
        });
      });
    }

    if (preserveScopedValues && targetScope) {
      Object.entries(preserveScopedValues).forEach(([key, value]) => {
        if (!key) return;
        writeCoreValue(key, value, targetScope);
      });
    }
  }, [preAuthId, publicId]);

  return {
    workflowState,
    dispatchWorkflow,
    updateWorkflowState,
    resetWorkflowState,
    publicId,
    preAuthId,
    setPreAuthId,
    scopeId,
    sessionId: workflowState.sessionId,
    stage: workflowState.stage,
    consentGiven: workflowState.consentGiven,
    userDetailsSubmitted: workflowState.userDetailsSubmitted,
    emailVerified: workflowState.emailVerified,
    sessionHydrated,
    setSessionHydrated,
    frontendSessionExpired,
    demographics: workflowState.demographics,
    clearUserStorage,
  };
}
