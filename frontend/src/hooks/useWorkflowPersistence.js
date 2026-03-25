import { useEffect, useRef } from "react";
import { endpoints } from "../utils/api.js";
import { runtimeConfig } from "../config/runtime";
import { APP_FLOW, APP_STAGE_ORDER, normalizeAppStage } from "../config/appFlow";
import {
  makeScopedKey,
  readExpiringValue,
  removeStoredKey,
  saveStoredValue,
  writeExpiringValue,
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

const CORE_STATE_STORAGE_AREA = "local";
const CORE_STATE_SCHEMA_VERSION = runtimeConfig.uiStateSchemaVersion;
const CORE_STATE_TTL_MS = runtimeConfig.uiStateTtlMs;
const PII_STATE_TTL_MS = runtimeConfig.piiStateTtlMs;
const CORE_SCOPE_ANON = "anon";
const CORE_SCOPED_KEYS = [
  runtimeConfig.storageKeys.stage,
  runtimeConfig.storageKeys.sessionId,
  runtimeConfig.storageKeys.consentGiven,
  runtimeConfig.storageKeys.userDetailsSubmitted,
  runtimeConfig.storageKeys.emailVerified,
  runtimeConfig.storageKeys.demographics,
  runtimeConfig.storageKeys.survey,
  runtimeConfig.storageKeys.surveyCompleted,
  runtimeConfig.storageKeys.surveyFeedbackReady,
  runtimeConfig.storageKeys.lastSubmissionSucceeded,
  runtimeConfig.storageKeys.shownImages,
];

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
  useEffect(() => writeCoreValue(runtimeConfig.storageKeys.stage, stage, scopeId), [scopeId, stage]);
  useEffect(() => writeCoreValue(runtimeConfig.storageKeys.sessionId, sessionId, scopeId), [scopeId, sessionId]);
  useEffect(() => writeCoreValue(runtimeConfig.storageKeys.consentGiven, consentGiven, scopeId), [consentGiven, scopeId]);
  useEffect(() => writeCoreValue(runtimeConfig.storageKeys.userDetailsSubmitted, userDetailsSubmitted, scopeId), [scopeId, userDetailsSubmitted]);
  useEffect(() => writeCoreValue(runtimeConfig.storageKeys.emailVerified, emailVerified, scopeId), [emailVerified, scopeId]);
  useEffect(() => {
    if (!isOnline) return;
    if (demographicsSaveTimeoutRef.current) {
      clearScheduledTimeout(demographicsSaveTimeoutRef.current);
    }
    demographicsSaveTimeoutRef.current = scheduleTimeout(() => {
      writeCoreValue(runtimeConfig.storageKeys.demographics, demographics, scopeId, { ttlMs: PII_STATE_TTL_MS });
    }, 700);
  }, [demographics, isOnline, scopeId]);
  useEffect(() => () => {
    if (demographicsSaveTimeoutRef.current) {
      clearScheduledTimeout(demographicsSaveTimeoutRef.current);
    }
  }, []);
  useEffect(() => writeCoreValue(runtimeConfig.storageKeys.survey, survey, scopeId), [scopeId, survey]);
  useEffect(() => writeCoreValue(runtimeConfig.storageKeys.surveyCompleted, surveyCompleted, scopeId), [scopeId, surveyCompleted]);
  useEffect(() => writeCoreValue(runtimeConfig.storageKeys.surveyFeedbackReady, surveyFeedbackReady, scopeId), [scopeId, surveyFeedbackReady]);
  useEffect(() => writeCoreValue(runtimeConfig.storageKeys.lastSubmissionSucceeded, lastSubmissionSucceeded, scopeId), [lastSubmissionSucceeded, scopeId]);
  useEffect(() => writeCoreValue(runtimeConfig.storageKeys.shownImages, shownImages, scopeId), [scopeId, shownImages]);

  useEffect(() => {
    if (!publicId) return;
    const fromScope = CORE_SCOPE_ANON;
    const toScope = publicId;
    CORE_SCOPED_KEYS.forEach((baseKey) => {
      const ttlMs = baseKey === runtimeConfig.storageKeys.demographics ? PII_STATE_TTL_MS : CORE_STATE_TTL_MS;
      const fromKey = makeScopedKey(baseKey, fromScope);
      const toKey = makeScopedKey(baseKey, toScope);
      const already = readExpiringValue(toKey, undefined, { area: CORE_STATE_STORAGE_AREA, schemaVersion: CORE_STATE_SCHEMA_VERSION, ttlMs });
      if (already !== undefined) return;
      const fromVal = readExpiringValue(fromKey, undefined, { area: CORE_STATE_STORAGE_AREA, schemaVersion: CORE_STATE_SCHEMA_VERSION, ttlMs });
      if (fromVal === undefined) return;
      writeExpiringValue(toKey, fromVal, { area: CORE_STATE_STORAGE_AREA, schemaVersion: CORE_STATE_SCHEMA_VERSION, ttlMs });
      removeStoredKey(fromKey, CORE_STATE_STORAGE_AREA);
    });

    const readScoped = (baseKey, fallback, ttlMs) => {
      const scopedKey = makeScopedKey(baseKey, publicId);
      const stored = readExpiringValue(scopedKey, undefined, { area: CORE_STATE_STORAGE_AREA, schemaVersion: CORE_STATE_SCHEMA_VERSION, ttlMs });
      return stored === undefined ? { hasValue: false, value: fallback } : { hasValue: true, value: stored };
    };

    const sessionStored = readScoped(runtimeConfig.storageKeys.sessionId, "", CORE_STATE_TTL_MS);
    setSessionId((prev) => (sessionStored.hasValue ? sessionStored.value : prev));
    const stageStored = readScoped(runtimeConfig.storageKeys.stage, APP_FLOW.stages.consent, CORE_STATE_TTL_MS);
    setStage((prev) => (stageStored.hasValue ? normalizeAppStage(stageStored.value) : prev));
    const consentStored = readScoped(runtimeConfig.storageKeys.consentGiven, false, CORE_STATE_TTL_MS);
    setConsentGiven((prev) => (consentStored.hasValue ? consentStored.value : prev));
    const userDetailsStored = readScoped(runtimeConfig.storageKeys.userDetailsSubmitted, false, CORE_STATE_TTL_MS);
    setUserDetailsSubmitted((prev) => (userDetailsStored.hasValue ? userDetailsStored.value : prev));
    const emailStored = readScoped(runtimeConfig.storageKeys.emailVerified, false, CORE_STATE_TTL_MS);
    setEmailVerified((prev) => (emailStored.hasValue ? emailStored.value : prev));
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

    const storedSurveyCompleted = readCoreValue(runtimeConfig.storageKeys.surveyCompleted, 0, publicId);
    setSurveyCompleted((prev) => (storedSurveyCompleted > 0 ? storedSurveyCompleted : prev));

    const storedSurveyFeedbackReady = readCoreValue(runtimeConfig.storageKeys.surveyFeedbackReady, false, publicId);
    if (storedSurveyFeedbackReady) {
      setSurveyFeedbackReady(true);
      setStage((prev) => (prev === APP_FLOW.stages.survey ? APP_FLOW.stages.postSurvey : prev));
    }

    const storedLastSubmissionSucceeded = readCoreValue(runtimeConfig.storageKeys.lastSubmissionSucceeded, false, publicId);
    if (storedLastSubmissionSucceeded) {
      setLastSubmissionSucceeded(true);
    }

    const storedShownImages = readCoreValue(runtimeConfig.storageKeys.shownImages, [], publicId);
    if (Array.isArray(storedShownImages) && storedShownImages.length > 0) {
      setShownImages((prev) => (prev.length > 0 ? prev : storedShownImages));
    }
  }, [
    publicId,
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
