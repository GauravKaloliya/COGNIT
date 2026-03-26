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
import { clearScheduledTimeout, scheduleTimeout } from "../utils/timing";
import { telemetryIncrement } from "../utils/clientTelemetry";
import { migratePreAuthScopeToPublic } from "../utils/preAuthMigration";

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
  const demographicsSaveTimeoutRef = useRef(null);
  const migratedScopePairRef = useRef("");
  const migrationOwnerIdRef = useRef(
    `tab_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
  );
  const canPersistCore = Boolean(sessionHydrated && publicId);

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
    if (!canPersistCore) return;
    writeCoreValue(runtimeConfig.storageKeys.stage, stage, scopeId);
  }, [canPersistCore, scopeId, stage]);
  useEffect(() => {
    if (!canPersistCore) return;
    writeCoreValue(runtimeConfig.storageKeys.sessionId, sessionId, scopeId);
  }, [canPersistCore, scopeId, sessionId]);
  useEffect(() => {
    if (!canPersistCore) return;
    writeCoreValue(runtimeConfig.storageKeys.consentGiven, consentGiven, scopeId);
  }, [canPersistCore, consentGiven, scopeId]);
  useEffect(() => {
    if (!canPersistCore) return;
    writeCoreValue(runtimeConfig.storageKeys.userDetailsSubmitted, userDetailsSubmitted, scopeId);
  }, [canPersistCore, scopeId, userDetailsSubmitted]);
  useEffect(() => {
    if (!canPersistCore) return;
    writeCoreValue(runtimeConfig.storageKeys.emailVerified, emailVerified, scopeId);
  }, [canPersistCore, emailVerified, scopeId]);
  useEffect(() => {
    if (!canPersistCore || !isOnline) return;
    if (demographicsSaveTimeoutRef.current) {
      clearScheduledTimeout(demographicsSaveTimeoutRef.current);
    }
    demographicsSaveTimeoutRef.current = scheduleTimeout(() => {
      writeCoreValue(runtimeConfig.storageKeys.demographics, demographics, scopeId, { ttlMs: PII_STATE_TTL_MS });
    }, 700);
  }, [canPersistCore, demographics, isOnline, scopeId]);
  useEffect(() => () => {
    if (demographicsSaveTimeoutRef.current) {
      clearScheduledTimeout(demographicsSaveTimeoutRef.current);
    }
  }, []);
  useEffect(() => {
    if (!canPersistCore) return;
    writeCoreValue(runtimeConfig.storageKeys.survey, survey, scopeId);
  }, [canPersistCore, scopeId, survey]);
  useEffect(() => {
    if (!canPersistCore) return;
    writeCoreValue(runtimeConfig.storageKeys.surveyCompleted, surveyCompleted, scopeId);
  }, [canPersistCore, scopeId, surveyCompleted]);
  useEffect(() => {
    if (!canPersistCore) return;
    writeCoreValue(runtimeConfig.storageKeys.surveyFeedbackReady, surveyFeedbackReady, scopeId);
  }, [canPersistCore, scopeId, surveyFeedbackReady]);
  useEffect(() => {
    if (!canPersistCore) return;
    writeCoreValue(runtimeConfig.storageKeys.lastSubmissionSucceeded, lastSubmissionSucceeded, scopeId);
  }, [canPersistCore, lastSubmissionSucceeded, scopeId]);
  useEffect(() => {
    if (!canPersistCore) return;
    writeCoreValue(runtimeConfig.storageKeys.shownImages, shownImages, scopeId);
  }, [canPersistCore, scopeId, shownImages]);

  useEffect(() => {
    if (!publicId) return;

    const sessionStored = readCoreValue(runtimeConfig.storageKeys.sessionId, "", publicId);
    setSessionId((prev) => (sessionStored ? sessionStored : prev));
    const stageStored = readCoreValue(runtimeConfig.storageKeys.stage, APP_FLOW.stages.consent, publicId);
    setStage((prev) => (stageStored ? normalizeAppStage(stageStored) : prev));
    const consentStored = readCoreValue(runtimeConfig.storageKeys.consentGiven, null, publicId);
    if (typeof consentStored === "boolean") setConsentGiven((prev) => (consentStored !== prev ? consentStored : prev));
    const userDetailsStored = readCoreValue(runtimeConfig.storageKeys.userDetailsSubmitted, null, publicId);
    if (typeof userDetailsStored === "boolean") setUserDetailsSubmitted((prev) => (userDetailsStored !== prev ? userDetailsStored : prev));
    const emailStored = readCoreValue(runtimeConfig.storageKeys.emailVerified, null, publicId);
    if (typeof emailStored === "boolean") setEmailVerified((prev) => (emailStored !== prev ? emailStored : prev));
    const storedDemographics = readCoreValue(runtimeConfig.storageKeys.demographics, {
      username: "",
      email: "",
      gender_code: "",
      age: "",
      location: "",
      language_code: "",
      prior_experience: "",
    }, publicId, { ttlMs: PII_STATE_TTL_MS });
    setDemographics((prev) => (hasAnyDemographicsValue(storedDemographics) ? storedDemographics : prev));

    const storedSurvey = normalizeStoredSurvey(readCoreValue(runtimeConfig.storageKeys.survey, null, publicId));
    if (storedSurvey) {
      setSurvey((prev) => {
        if (prev?.[SURVEY_API_FIELDS.imageId] && prev?.[SURVEY_API_FIELDS.url]) return prev;
        return storedSurvey;
      });
    }

    const storedSurveyCompleted = readCoreValue(runtimeConfig.storageKeys.surveyCompleted, null, publicId);
    if (Number.isInteger(storedSurveyCompleted) && storedSurveyCompleted >= 0) {
      setSurveyCompleted((prev) => (storedSurveyCompleted !== prev ? storedSurveyCompleted : prev));
    }

    const storedSurveyFeedbackReady = readCoreValue(runtimeConfig.storageKeys.surveyFeedbackReady, null, publicId);
    if (typeof storedSurveyFeedbackReady === "boolean") setSurveyFeedbackReady(storedSurveyFeedbackReady);

    const storedLastSubmissionSucceeded = readCoreValue(runtimeConfig.storageKeys.lastSubmissionSucceeded, null, publicId);
    if (typeof storedLastSubmissionSucceeded === "boolean") setLastSubmissionSucceeded(storedLastSubmissionSucceeded);

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
