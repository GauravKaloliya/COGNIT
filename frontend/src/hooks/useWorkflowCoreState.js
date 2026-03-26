import { useCallback, useEffect, useState } from "react";
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
import { getScopeId, readCoreValue } from "../utils/appControllerState";

const CORE_STATE_STORAGE_AREA = "local";
const PII_STATE_TTL_MS = runtimeConfig.piiStateTtlMs;
const SESSION_ALIVE_KEY = runtimeConfig.storageKeys.sessionAlive;
const EXPIRED_STORAGE_PREFIXES = Object.values(runtimeConfig.storageKeys);
const EMPTY_DEMOGRAPHICS = {
  username: "",
  email: "",
  gender_code: "",
  age: "",
  location: "",
  language_code: "",
  prior_experience: "",
};
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
    publicId: scopeId,
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
  const [publicId, setPublicId] = useState(() => initialSnapshot?.publicId || "");
  const [preAuthId, setPreAuthId] = useState(() => (
    getStoredValue(runtimeConfig.storageKeys.preAuthId, "", { area: CORE_STATE_STORAGE_AREA }) || ""
  ));
  const [sessionId, setSessionId] = useState(() => initialSnapshot?.sessionId || "");
  const [stage, setStage] = useState(() => initialSnapshot?.stage || APP_FLOW.stages.consent);
  const [consentGiven, setConsentGiven] = useState(() => initialSnapshot?.consentGiven === true);
  const [userDetailsSubmitted, setUserDetailsSubmitted] = useState(() => initialSnapshot?.userDetailsSubmitted === true);
  const [emailVerified, setEmailVerified] = useState(() => initialSnapshot?.emailVerified === true);
  const [sessionHydrated, setSessionHydrated] = useState(Boolean(initialSnapshot?.publicId));
  const [frontendSessionExpired] = useState(false);
  const [demographics, setDemographics] = useState(() => initialSnapshot?.demographics || EMPTY_DEMOGRAPHICS);
  const scopeId = getScopeId(publicId);

  useEffect(() => {
    removeExpiredStorage(addToast, publicId);
  }, [addToast, publicId]);

  useEffect(() => {
    if (!publicId) return;
    const snapshot = buildScopeSnapshot(publicId);
    if (!snapshot) return;
    setSessionId(snapshot.sessionId || "");
    setStage(snapshot.stage);
    setConsentGiven(snapshot.consentGiven);
    setUserDetailsSubmitted(snapshot.userDetailsSubmitted);
    setEmailVerified(snapshot.emailVerified);
    setDemographics(snapshot.demographics || EMPTY_DEMOGRAPHICS);
  }, [publicId]);

  useEffect(() => {
    const bestSnapshot = findBestStoredSnapshot();
    if (!bestSnapshot?.publicId || bestSnapshot.publicId === publicId) return;
    setPublicId(bestSnapshot.publicId);
  }, [publicId]);

  useEffect(() => {
    const normalizedStage = normalizeAppStage(stage);
    if (normalizedStage !== stage) {
      setStage(normalizedStage);
    }
  }, [stage]);

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

  const clearUserStorage = useCallback((scopeOverride = null) => {
    const preservedDarkMode = readExpiringValue(runtimeConfig.storageKeys.darkMode, null, {
      area: "local",
      schemaVersion: runtimeConfig.uiStateSchemaVersion,
      ttlMs: runtimeConfig.uiStateTtlMs,
    });
    const targetScope = getScopeId(scopeOverride || publicId);
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

    if (typeof preservedDarkMode === "boolean") {
      writeExpiringValue(runtimeConfig.storageKeys.darkMode, preservedDarkMode, {
        area: "local",
        schemaVersion: runtimeConfig.uiStateSchemaVersion,
        ttlMs: runtimeConfig.uiStateTtlMs,
      });
    }
  }, [publicId]);

  return {
    publicId,
    setPublicId,
    preAuthId,
    setPreAuthId,
    scopeId,
    sessionId,
    setSessionId,
    stage,
    setStage,
    consentGiven,
    setConsentGiven,
    userDetailsSubmitted,
    setUserDetailsSubmitted,
    emailVerified,
    setEmailVerified,
    sessionHydrated,
    setSessionHydrated,
    frontendSessionExpired,
    demographics,
    setDemographics,
    clearUserStorage,
  };
}
