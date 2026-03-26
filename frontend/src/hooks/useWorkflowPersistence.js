import { useEffect, useRef } from "react";
import { endpoints } from "../utils/api.js";
import { runtimeConfig } from "../config/runtime";
import { APP_FLOW, APP_STAGE_ORDER, normalizeAppStage } from "../config/appFlow";
import {
  saveStoredValue,
} from "../utils/storage";
import {
  deriveMaxAllowedStage,
  hasAnyDemographicsValue,
  isDemographicsComplete,
  readCoreValue,
  validateStageTransition,
  writeCoreValue,
} from "../utils/appControllerState";
import { SURVEY_API_FIELDS } from "../constants/fields";
import { telemetryIncrement } from "../utils/clientTelemetry";
import { migratePreAuthScopeToPublic } from "../utils/preAuthMigration";
import { useDebouncedPersistence } from "./useDebouncedPersistence";

const CORE_STATE_STORAGE_AREA = "local";
const PII_STATE_TTL_MS = runtimeConfig.piiStateTtlMs;

function normalizeStoredSurvey(value) {
  if (!value || typeof value !== "object") return null;
  const imageId = value[SURVEY_API_FIELDS.imageId] || value.imageId || null;
  const imageUrl = value[SURVEY_API_FIELDS.url] || value[SURVEY_API_FIELDS.imageUrl] || value.imageUrl || "";
  if (!imageId || !String(imageUrl).trim()) return null;
  return {
    ...value,
    [SURVEY_API_FIELDS.imageId]: imageId,
    [SURVEY_API_FIELDS.url]: imageUrl,
  };
}

export function useWorkflowPersistence({
  publicId,
  preAuthId,
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
  isOnline,
  survey,
  setSurvey,
  surveyCompleted,
  setSurveyCompleted,
  surveyFeedbackReady,
  setSurveyFeedbackReady,
  lastSubmissionSucceeded,
  setLastSubmissionSucceeded,
  shownImages,
  setShownImages,
}) {
  const migratedScopePairRef = useRef("");
  const migrationOwnerIdRef = useRef(
    `tab_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
  );
  const canPersistCore = Boolean(sessionHydrated && publicId);

  useDebouncedPersistence({
    enabled: canPersistCore,
    value: stage,
    delayMs: 250,
    onWrite: (nextStage) => writeCoreValue(runtimeConfig.storageKeys.stage, nextStage, scopeId),
  });

  useDebouncedPersistence({
    enabled: canPersistCore,
    value: sessionId,
    delayMs: 250,
    onWrite: (nextSessionId) => writeCoreValue(runtimeConfig.storageKeys.sessionId, nextSessionId, scopeId),
  });

  useDebouncedPersistence({
    enabled: canPersistCore,
    value: consentGiven,
    delayMs: 250,
    onWrite: (nextConsentGiven) => writeCoreValue(runtimeConfig.storageKeys.consentGiven, nextConsentGiven, scopeId),
  });

  useDebouncedPersistence({
    enabled: canPersistCore,
    value: userDetailsSubmitted,
    delayMs: 250,
    onWrite: (nextUserDetailsSubmitted) => writeCoreValue(runtimeConfig.storageKeys.userDetailsSubmitted, nextUserDetailsSubmitted, scopeId),
  });

  useDebouncedPersistence({
    enabled: canPersistCore,
    value: emailVerified,
    delayMs: 250,
    onWrite: (nextEmailVerified) => writeCoreValue(runtimeConfig.storageKeys.emailVerified, nextEmailVerified, scopeId),
  });

  useDebouncedPersistence({
    enabled: Boolean(canPersistCore && isOnline),
    value: demographics,
    delayMs: 700,
    onWrite: (nextDemographics) => {
      writeCoreValue(runtimeConfig.storageKeys.demographics, nextDemographics, scopeId, { ttlMs: PII_STATE_TTL_MS });
    },
  });

  useDebouncedPersistence({
    enabled: canPersistCore,
    value: survey,
    delayMs: 300,
    onWrite: (nextSurvey) => writeCoreValue(runtimeConfig.storageKeys.survey, nextSurvey, scopeId),
  });

  useDebouncedPersistence({
    enabled: canPersistCore,
    value: surveyCompleted,
    delayMs: 250,
    onWrite: (nextSurveyCompleted) => writeCoreValue(runtimeConfig.storageKeys.surveyCompleted, nextSurveyCompleted, scopeId),
  });

  useDebouncedPersistence({
    enabled: canPersistCore,
    value: surveyFeedbackReady,
    delayMs: 250,
    onWrite: (nextSurveyFeedbackReady) => writeCoreValue(runtimeConfig.storageKeys.surveyFeedbackReady, nextSurveyFeedbackReady, scopeId),
  });

  useDebouncedPersistence({
    enabled: canPersistCore,
    value: lastSubmissionSucceeded,
    delayMs: 250,
    onWrite: (nextLastSubmissionSucceeded) => {
      writeCoreValue(runtimeConfig.storageKeys.lastSubmissionSucceeded, nextLastSubmissionSucceeded, scopeId);
    },
  });

  useDebouncedPersistence({
    enabled: canPersistCore,
    value: shownImages,
    delayMs: 300,
    onWrite: (nextShownImages) => writeCoreValue(runtimeConfig.storageKeys.shownImages, nextShownImages, scopeId),
  });

  useEffect(() => {
    let cancelled = false;
    const hydrateFromCookies = async () => {
      if (frontendSessionExpired) {
        if (!cancelled) setSessionHydrated(true);
        return;
      }
      if (publicId) {
        if (!cancelled) setSessionHydrated(true);
        return;
      }
      try {
        const session = await endpoints.getParticipantSession();
        if (cancelled) return;
        if (session?.public_id) setPublicId(session.public_id);
        if (session?.session_id) setSessionId(session.session_id);
      } catch {
        // Ignore; user can still continue fresh.
      } finally {
        if (!cancelled) setSessionHydrated(true);
      }
    };
    hydrateFromCookies();
    return () => {
      cancelled = true;
    };
  }, [frontendSessionExpired, publicId, setPublicId, setSessionHydrated, setSessionId]);

  useEffect(() => saveStoredValue(runtimeConfig.storageKeys.publicId, publicId, { area: CORE_STATE_STORAGE_AREA }), [publicId]);
  useEffect(() => saveStoredValue(runtimeConfig.storageKeys.preAuthId, preAuthId, { area: CORE_STATE_STORAGE_AREA }), [preAuthId]);

  useEffect(() => {
    if (!sessionHydrated || !publicId || !preAuthId || preAuthId === publicId) return;
    const pair = `${preAuthId}->${publicId}`;
    if (migratedScopePairRef.current === pair) return;
    const result = migratePreAuthScopeToPublic(
      { preAuthId, publicId },
      {
        ownerId: migrationOwnerIdRef.current,
        onEvent: (eventName) => telemetryIncrement(eventName),
      }
    );
    if (result.status === "failed") {
      telemetryIncrement("preauth_migration_failed_retryable");
      return;
    }
    migratedScopePairRef.current = pair;
  }, [preAuthId, publicId, sessionHydrated]);
  useEffect(() => {
    if (!publicId) return;

    const sessionStored = readCoreValue(runtimeConfig.storageKeys.sessionId, "", publicId);
    setSessionId((prev) => (prev || sessionStored || ""));
    const stageStored = readCoreValue(runtimeConfig.storageKeys.stage, APP_FLOW.stages.consent, publicId);
    setStage((prev) => {
      if (prev && prev !== APP_FLOW.stages.consent) return prev;
      return stageStored ? normalizeAppStage(stageStored) : prev;
    });
    const consentStored = readCoreValue(runtimeConfig.storageKeys.consentGiven, null, publicId);
    if (typeof consentStored === "boolean") setConsentGiven((prev) => (prev ? prev : consentStored));
    const userDetailsStored = readCoreValue(runtimeConfig.storageKeys.userDetailsSubmitted, null, publicId);
    if (typeof userDetailsStored === "boolean") setUserDetailsSubmitted((prev) => (prev ? prev : userDetailsStored));
    const emailStored = readCoreValue(runtimeConfig.storageKeys.emailVerified, null, publicId);
    if (typeof emailStored === "boolean") setEmailVerified((prev) => (prev ? prev : emailStored));
    const storedDemographics = readCoreValue(runtimeConfig.storageKeys.demographics, {
      username: "",
      email: "",
      gender_code: "",
      age: "",
      location: "",
      language_code: "",
      prior_experience: "",
    }, publicId, { ttlMs: PII_STATE_TTL_MS });
    setDemographics((prev) => {
      if (hasAnyDemographicsValue(prev)) return prev;
      return hasAnyDemographicsValue(storedDemographics) ? storedDemographics : prev;
    });

    const storedSurvey = normalizeStoredSurvey(readCoreValue(runtimeConfig.storageKeys.survey, null, publicId));
    if (storedSurvey) {
      setSurvey((prev) => {
        if (prev?.[SURVEY_API_FIELDS.imageId] && prev?.[SURVEY_API_FIELDS.url]) return prev;
        return storedSurvey;
      });
    }

    const storedSurveyCompleted = readCoreValue(runtimeConfig.storageKeys.surveyCompleted, null, publicId);
    if (Number.isInteger(storedSurveyCompleted) && storedSurveyCompleted >= 0) {
      setSurveyCompleted((prev) => Math.max(prev, storedSurveyCompleted));
    }

    const storedSurveyFeedbackReady = readCoreValue(runtimeConfig.storageKeys.surveyFeedbackReady, null, publicId);
    if (typeof storedSurveyFeedbackReady === "boolean") {
      setSurveyFeedbackReady((prev) => (prev ? prev : storedSurveyFeedbackReady));
    }

    const storedLastSubmissionSucceeded = readCoreValue(runtimeConfig.storageKeys.lastSubmissionSucceeded, null, publicId);
    if (typeof storedLastSubmissionSucceeded === "boolean") {
      setLastSubmissionSucceeded((prev) => (prev ? prev : storedLastSubmissionSucceeded));
    }

    const storedShownImages = readCoreValue(runtimeConfig.storageKeys.shownImages, [], publicId);
    if (Array.isArray(storedShownImages) && storedShownImages.length > 0) {
      setShownImages((prev) => (prev.length > 0 ? prev : storedShownImages));
    }
  }, [
    publicId,
    preAuthId,
    setConsentGiven,
    setDemographics,
    setEmailVerified,
    setLastSubmissionSucceeded,
    setSessionId,
    setShownImages,
    setStage,
    setSurvey,
    setSurveyCompleted,
    setSurveyFeedbackReady,
    setUserDetailsSubmitted,
  ]);

  useEffect(() => {
    if (!sessionHydrated) return;
    const normalizedStage = normalizeAppStage(stage);
    const maxAllowedStage = deriveMaxAllowedStage({
      currentStage: normalizedStage,
      consentGiven,
      hasParticipant: Boolean(publicId),
      userDetailsSubmitted,
      demographicsComplete: isDemographicsComplete(demographics),
      emailVerified,
      surveyCompleted,
      surveyFeedbackReady,
      lastSubmissionSucceeded,
    });
    const currentIndex = APP_STAGE_ORDER.indexOf(normalizedStage);
    const maxAllowedIndex = APP_STAGE_ORDER.indexOf(maxAllowedStage);
    if (maxAllowedIndex >= 0) {
      if (currentIndex > maxAllowedIndex) {
        setStage(maxAllowedStage);
      } else if (currentIndex >= 0 && currentIndex < maxAllowedIndex) {
        let nextStage = normalizedStage;
        let nextIndex = currentIndex;
        while (nextIndex < maxAllowedIndex) {
          const candidate = APP_STAGE_ORDER[nextIndex + 1];
          if (!validateStageTransition(nextStage, candidate)) break;
          nextStage = candidate;
          nextIndex += 1;
        }
        if (nextStage !== normalizedStage) {
          setStage(nextStage);
        }
      }
    }
    if (normalizedStage !== stage) {
      setStage(normalizedStage);
    }
    if (surveyFeedbackReady && !lastSubmissionSucceeded) {
      setSurveyFeedbackReady(false);
    }
  }, [
    consentGiven,
    demographics,
    lastSubmissionSucceeded,
    emailVerified,
    publicId,
    sessionHydrated,
    stage,
    surveyCompleted,
    surveyFeedbackReady,
    setStage,
    setSurveyFeedbackReady,
    userDetailsSubmitted,
  ]);
}
