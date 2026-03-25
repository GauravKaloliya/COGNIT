import { useCallback, useEffect, useRef, useState } from "react";
import { runtimeConfig } from "../config/runtime";
import { uiText } from "../utils/uiText";
import {
  ALL_STORAGE_AREAS,
  forEachStorageArea,
  getStoredValue,
  makeScopedKey,
  readExpiringValue,
  readStoredMeta,
  removeStoredKey,
  writeExpiringValue,
} from "../utils/storage";
import { APP_FLOW } from "../config/appFlow";
import { getScopeId, readCoreValue } from "../utils/appControllerState";

const CORE_STATE_STORAGE_AREA = "local";
const CORE_SCOPE_ANON = "anon";
const PII_STATE_TTL_MS = runtimeConfig.piiStateTtlMs;
const SESSION_ALIVE_KEY = runtimeConfig.storageKeys.sessionAlive;
const EXPIRED_STORAGE_PREFIXES = Object.values(runtimeConfig.storageKeys);

export function useWorkflowCoreState({ addToast }) {
  const [publicId, setPublicId] = useState(() => (
    getStoredValue(runtimeConfig.storageKeys.publicId, "", { area: CORE_STATE_STORAGE_AREA }) || ""
  ));
  const scopeId = getScopeId(publicId);
  const [sessionId, setSessionId] = useState(() => readCoreValue(runtimeConfig.storageKeys.sessionId, "", scopeId));
  const [stage, setStage] = useState(() => readCoreValue(runtimeConfig.storageKeys.stage, APP_FLOW.stages.consent, scopeId));
  const [consentGiven, setConsentGiven] = useState(() => readCoreValue(runtimeConfig.storageKeys.consentGiven, false, scopeId));
  const [userDetailsSubmitted, setUserDetailsSubmitted] = useState(() => readCoreValue(runtimeConfig.storageKeys.userDetailsSubmitted, false, scopeId));
  const [emailVerified, setEmailVerified] = useState(() => readCoreValue(runtimeConfig.storageKeys.emailVerified, false, scopeId));
  const [sessionHydrated, setSessionHydrated] = useState(false);
  const [frontendSessionExpired, setFrontendSessionExpired] = useState(false);
  const [demographics, setDemographics] = useState(
    readCoreValue(runtimeConfig.storageKeys.demographics, {
      username: "",
      email: "",
      gender_code: "",
      age: "",
      location: "",
      language_code: "",
      prior_experience: "",
    }, scopeId, { ttlMs: PII_STATE_TTL_MS })
  );
  const expiryNoticeShownRef = useRef(false);

  useEffect(() => {
    if (expiryNoticeShownRef.current) return;
    const now = Date.now();
    let expiredFound = false;
    const matchesPrefix = (key) => EXPIRED_STORAGE_PREFIXES.some((prefix) =>
      key === prefix || key.startsWith(`${prefix}:`) || key.startsWith(`${prefix}_`)
    );
    ALL_STORAGE_AREAS.forEach((area) => {
      const storage = area === CORE_STATE_STORAGE_AREA ? localStorage : sessionStorage;
      for (let i = storage.length - 1; i >= 0; i -= 1) {
        const key = storage.key(i);
        if (!key || !matchesPrefix(key)) continue;
        const meta = readStoredMeta(key, area);
        if (!meta || typeof meta.expiresAt !== "number") continue;
        if (now <= meta.expiresAt) continue;
        removeStoredKey(key, area);
        expiredFound = true;
      }
    });
    if (expiredFound) {
      expiryNoticeShownRef.current = true;
      setFrontendSessionExpired(true);
      setPublicId("");
      setSessionId("");
      setStage(APP_FLOW.stages.consent);
      setConsentGiven(false);
      setUserDetailsSubmitted(false);
      setEmailVerified(false);
      setDemographics({
        username: "",
        email: "",
        gender_code: "",
        age: "",
        location: "",
        language_code: "",
        prior_experience: "",
      });
      addToast(uiText("app.sessionExpired"), "warning");
    }
  }, [addToast]);

  const clearUserStorage = useCallback((scopeOverride = null) => {
    let darkMode = readExpiringValue(runtimeConfig.storageKeys.darkMode, null, {
      area: "local",
      schemaVersion: runtimeConfig.uiStateSchemaVersion,
      ttlMs: runtimeConfig.uiStateTtlMs,
    });
    if (typeof darkMode !== "boolean") {
      darkMode = readExpiringValue(runtimeConfig.storageKeys.darkMode, null, {
        area: "session",
        schemaVersion: runtimeConfig.uiStateSchemaVersion,
        ttlMs: runtimeConfig.uiStateTtlMs,
      });
    }

    const scope = String(scopeOverride || publicId || "").trim() || CORE_SCOPE_ANON;
    const keysToClear = [
      runtimeConfig.storageKeys.activeTabLock,
      runtimeConfig.storageKeys.publicId,
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
      runtimeConfig.storageKeys.telemetryBlocked,
      runtimeConfig.storageKeys.sessionAlive,
    ];
    keysToClear.forEach((key) => {
      forEachStorageArea((area) => {
        removeStoredKey(key, area);
        removeStoredKey(makeScopedKey(key, scope), area);
        removeStoredKey(makeScopedKey(key, CORE_SCOPE_ANON), area);
      });
    });

    const prefixesToClear = [
      runtimeConfig.storageKeys.surveyDraftPrefix,
      runtimeConfig.storageKeys.surveyDraftActivePrefix,
    ].filter(Boolean);
    prefixesToClear.forEach((prefix) => {
      forEachStorageArea((area) => {
        const storage = area === CORE_STATE_STORAGE_AREA ? localStorage : sessionStorage;
        for (let i = storage.length - 1; i >= 0; i -= 1) {
          const key = storage.key(i);
          if (!key) continue;
          if (key.startsWith(`${prefix}_`)) {
            removeStoredKey(key, area);
          }
        }
      });
    });

    if (typeof darkMode === "boolean") {
      writeExpiringValue(runtimeConfig.storageKeys.darkMode, darkMode, {
        area: "local",
        schemaVersion: runtimeConfig.uiStateSchemaVersion,
        ttlMs: runtimeConfig.uiStateTtlMs,
      });
    }
  }, [publicId]);

  useEffect(() => {
    if (stage === "email-verify") {
      setStage(APP_FLOW.stages.userDetails);
    }
  }, [stage]);

  useEffect(() => {
    writeExpiringValue(SESSION_ALIVE_KEY, "1", {
      area: "session",
      schemaVersion: runtimeConfig.uiStateSchemaVersion,
      ttlMs: runtimeConfig.uiStateTtlMs,
    });
  }, []);

  return {
    publicId,
    setPublicId,
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
