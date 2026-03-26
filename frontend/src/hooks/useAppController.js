import { useCallback, useEffect, useMemo, useRef } from "react";
import { endpoints } from "../utils/api.js";
import { getErrorMessage } from "../utils/errorRegistry.js";
import { getDisplayErrorMessage } from "../utils/appError.js";
import { useOnlineStatus } from "./useOnlineStatus";
import { useSystemHealth } from "./useSystemHealth";
import { useSurveyFlow } from "./useSurveyFlow";
import { runtimeConfig } from "../config/runtime";
import { uiText } from "../utils/uiText";
import { APP_FLOW, normalizeAppStage } from "../config/appFlow";
import {
  deriveMaxAllowedStage,
  isDemographicsComplete,
  readCoreValue,
  writeCoreValue,
  validateStageTransition,
} from "../utils/appControllerState";
import { useToastState } from "./useToastState";
import { useActiveTabOwnership } from "./useActiveTabOwnership";
import { useWorkflowCoreState } from "./useWorkflowCoreState";
import { useWorkflowPersistence } from "./useWorkflowPersistence";
import { clearAllSurveyDraftsForUser } from "../utils/surveyDraft";
import { SURVEY_API_FIELDS } from "../constants/fields";

const EMPTY_DEMOGRAPHICS = {
  username: "",
  email: "",
  gender_code: "",
  age: "",
  location: "",
  language_code: "",
  prior_experience: "",
};

function wrapControllerError(error, fallbackCode, fallbackMessage) {
  const message = getDisplayErrorMessage(error, fallbackCode) || fallbackMessage || getErrorMessage(fallbackCode);
  const wrappedError = new Error(message);
  wrappedError.code = error?.code || fallbackCode;
  wrappedError.category = error?.category || String(wrappedError.code || "SYS").split("_")[0] || "SYS";
  wrappedError.field = error?.field;
  wrappedError.fields = error?.fields;
  wrappedError.status = Number(error?.status) || 0;
  wrappedError.details = error?.details;
  wrappedError.requestId = error?.requestId;
  wrappedError.severity = error?.severity;
  wrappedError.action = error?.action;
  wrappedError.retryable = error?.retryable;
  throw wrappedError;
}

function normalizeSurvey(value) {
  if (!value || typeof value !== "object") return null;
  const imageId = String(value[SURVEY_API_FIELDS.imageId] || value.image_id || value.imageId || "").trim();
  const imageUrl = String(
    value[SURVEY_API_FIELDS.url] || value[SURVEY_API_FIELDS.imageUrl] || value.image_url || value.imageUrl || ""
  ).trim();
  if (!imageId || !imageUrl) return null;
  return {
    ...value,
    [SURVEY_API_FIELDS.imageId]: imageId,
    [SURVEY_API_FIELDS.url]: imageUrl,
  };
}

function hasUsableSurvey(survey) {
  return Boolean(
    survey?.[SURVEY_API_FIELDS.imageId]
    && String(survey?.[SURVEY_API_FIELDS.url] || survey?.url || survey?.image_url || survey?.imageUrl || "").trim()
  );
}

export function useAppController() {
  const isOnline = useOnlineStatus();
  const { toasts, addToast, dismissToast } = useToastState();
  const { isActiveTabOwner, claimActiveTabLock } = useActiveTabOwnership();
  const submitAbortRef = useRef(null);
  const createParticipantPromiseRef = useRef(null);

  const {
    publicId,
    setPublicId,
    preAuthId,
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
    demographics,
    setDemographics,
    clearUserStorage,
  } = useWorkflowCoreState({ addToast });

  const storageScope = String(publicId || preAuthId || "").trim();

  const surveyFlow = useSurveyFlow({
    publicId,
    sessionId,
    addToast,
    initial: {
      survey: readCoreValue(runtimeConfig.storageKeys.survey, null, scopeId),
      surveyCompleted: readCoreValue(runtimeConfig.storageKeys.surveyCompleted, 0, scopeId),
      surveyFeedbackReady: readCoreValue(runtimeConfig.storageKeys.surveyFeedbackReady, false, scopeId),
      lastSubmissionSucceeded: readCoreValue(runtimeConfig.storageKeys.lastSubmissionSucceeded, false, scopeId),
      shownImages: readCoreValue(runtimeConfig.storageKeys.shownImages, [], scopeId),
    },
  });

  const {
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
    imageError,
    isFetchingImage,
    showConfetti,
    fetchImage,
    prefetchNextImage,
    handleSubmit: submitSurvey,
    cancelInFlightRequests,
  } = surveyFlow;

  useWorkflowPersistence({
    publicId,
    preAuthId,
    setPublicId,
    scopeId,
    sessionId,
    setSessionId,
    stage,
    consentGiven,
    userDetailsSubmitted,
    emailVerified,
    sessionHydrated,
    setSessionHydrated,
    demographics,
    isOnline,
    survey,
    surveyCompleted,
    surveyFeedbackReady,
    lastSubmissionSucceeded,
    shownImages,
  });

  const { systemReady, systemError, systemChecking, retryHealthCheck } = useSystemHealth({
    isActiveTabOwner,
  });

  const effectiveStage = useMemo(() => deriveMaxAllowedStage({
    currentStage: stage,
    consentGiven,
    hasParticipant: Boolean(publicId),
    userDetailsSubmitted,
    demographicsComplete: isDemographicsComplete(demographics),
    emailVerified,
    hasSurveyInProgress: hasUsableSurvey(survey),
    surveyCompleted,
    surveyFeedbackReady,
    lastSubmissionSucceeded,
  }), [
    consentGiven,
    demographics,
    emailVerified,
    lastSubmissionSucceeded,
    publicId,
    stage,
    survey,
    surveyCompleted,
    surveyFeedbackReady,
    userDetailsSubmitted,
  ]);

  useEffect(() => {
    if (!sessionHydrated || stage === effectiveStage) return;
    setStage(effectiveStage);
  }, [effectiveStage, sessionHydrated, setStage, stage]);

  useEffect(() => () => {
    cancelInFlightRequests?.();
    if (submitAbortRef.current) {
      submitAbortRef.current.abort();
    }
  }, [cancelInFlightRequests]);

  useEffect(() => {
    if (!sessionHydrated || !systemReady || surveyFeedbackReady || effectiveStage !== APP_FLOW.stages.survey) return;
    if (hasUsableSurvey(survey) || !publicId) return;
    const storedSurvey = normalizeSurvey(readCoreValue(runtimeConfig.storageKeys.survey, null, publicId));
    if (storedSurvey) {
      setSurvey((prev) => (hasUsableSurvey(prev) ? prev : storedSurvey));
      return;
    }
    void fetchImage({ clearCurrent: false });
  }, [effectiveStage, fetchImage, publicId, sessionHydrated, setSurvey, survey, surveyFeedbackReady, systemReady]);

  const createParticipant = useCallback(async () => {
    if (userDetailsSubmitted && publicId) {
      return { public_id: publicId, session_id: sessionId || "" };
    }
    if (createParticipantPromiseRef.current) {
      return createParticipantPromiseRef.current;
    }

    const participantPromise = endpoints.createParticipant({
      username: demographics.username,
      email: demographics.email,
      gender_code: demographics.gender_code,
      age: parseInt(demographics.age, 10),
      location: demographics.location,
      language_code: demographics.language_code,
      prior_experience: demographics.prior_experience,
    }).then((participant) => {
      const nextPublicId = String(participant?.public_id || "").trim();
      const nextSessionId = String(participant?.session_id || "").trim();
      if (nextPublicId) {
        writeCoreValue(runtimeConfig.storageKeys.demographics, demographics, nextPublicId, {
          ttlMs: runtimeConfig.piiStateTtlMs,
        });
        writeCoreValue(runtimeConfig.storageKeys.userDetailsSubmitted, true, nextPublicId);
        writeCoreValue(runtimeConfig.storageKeys.consentGiven, consentGiven, nextPublicId);
        writeCoreValue(runtimeConfig.storageKeys.emailVerified, false, nextPublicId);
        writeCoreValue(runtimeConfig.storageKeys.stage, APP_FLOW.stages.userDetails, nextPublicId);
        if (nextSessionId) {
          writeCoreValue(runtimeConfig.storageKeys.sessionId, nextSessionId, nextPublicId);
        }
        setPublicId(nextPublicId);
      }
      if (nextSessionId) setSessionId(nextSessionId);
      setUserDetailsSubmitted(true);
      return participant;
    });

    createParticipantPromiseRef.current = participantPromise;
    try {
      return await participantPromise;
    } catch (error) {
      wrapControllerError(error, "SYS_002_0022");
    } finally {
      if (createParticipantPromiseRef.current === participantPromise) {
        createParticipantPromiseRef.current = null;
      }
    }
  }, [
    consentGiven,
    demographics,
    publicId,
    sessionId,
    setPublicId,
    setSessionId,
    setUserDetailsSubmitted,
    userDetailsSubmitted,
  ]);

  const recordConsent = useCallback(async (publicIdOverride = null) => {
    if (submitAbortRef.current) {
      submitAbortRef.current.abort();
    }
    const controller = new AbortController();
    submitAbortRef.current = controller;
    try {
      const consentPublicId = publicIdOverride || publicId;
      if (!consentPublicId) {
        const error = new Error(getErrorMessage("NF_001_0001"));
        error.code = "NF_001_0001";
        throw error;
      }
      return await endpoints.recordConsent(consentPublicId, { signal: controller.signal });
    } catch (error) {
      if (error?.code === "REQ_ABORTED" || controller.signal.aborted) throw error;
      wrapControllerError(error, "SYS_002_0002");
    } finally {
      if (submitAbortRef.current === controller) {
        submitAbortRef.current = null;
      }
    }
  }, [publicId]);

  const handleConsentGiven = useCallback(async () => {
    setConsentGiven(true);
    if (validateStageTransition(APP_FLOW.stages.consent, APP_FLOW.stages.userDetails)) {
      setStage(APP_FLOW.stages.userDetails);
    }
    addToast(uiText("consent.saved"), "success");
  }, [addToast, setConsentGiven, setStage]);

  const handleUserDetailsSubmit = useCallback(async () => {
    try {
      const participant = await createParticipant();
      if (consentGiven) {
        await recordConsent(participant?.public_id || publicId);
      }
      setEmailVerified(false);
      addToast(uiText("user.detailsSaved"), "success");
      return participant;
    } catch (error) {
      addToast(error.message, "error");
      throw error;
    }
  }, [addToast, consentGiven, createParticipant, publicId, recordConsent, setEmailVerified]);

  const handleEmailVerified = useCallback(() => {
    setEmailVerified(true);
    if (validateStageTransition(APP_FLOW.stages.userDetails, APP_FLOW.stages.survey)) {
      setStage(APP_FLOW.stages.survey);
    }
  }, [setEmailVerified, setStage]);

  const resetWorkflowToConsent = useCallback((scopeOverride = null) => {
    clearUserStorage(scopeOverride || publicId);
    setPublicId("");
    setSessionId("");
    setConsentGiven(false);
    setUserDetailsSubmitted(false);
    setEmailVerified(false);
    setDemographics(EMPTY_DEMOGRAPHICS);
    setSurvey(null);
    setSurveyCompleted(0);
    setSurveyFeedbackReady(false);
    setLastSubmissionSucceeded(false);
    setShownImages([]);
    setStage(APP_FLOW.stages.consent);
  }, [
    clearUserStorage,
    publicId,
    setConsentGiven,
    setDemographics,
    setEmailVerified,
    setLastSubmissionSucceeded,
    setPublicId,
    setSessionId,
    setShownImages,
    setStage,
    setSurvey,
    setSurveyCompleted,
    setSurveyFeedbackReady,
    setUserDetailsSubmitted,
  ]);

  const handleAccountFlagged = useCallback((scopeOverride = null) => {
    resetWorkflowToConsent(scopeOverride);
  }, [resetWorkflowToConsent]);

  const handleSubmit = useCallback(async (formData) => {
    const result = await submitSurvey(formData);
    const backendStage = normalizeAppStage(result?.workflow_status?.stage);

    if (backendStage === APP_FLOW.stages.postSurvey) {
      setStage(APP_FLOW.stages.postSurvey);
      return result;
    }

    const nextCompleted = Number(surveyCompleted || 0) + 1;
    const requiredSubmissions = Math.max(1, Number(runtimeConfig.requiredSurveySubmissions || 2));
    if (nextCompleted >= requiredSubmissions) {
      setStage(APP_FLOW.stages.postSurvey);
      return result;
    }

    if (backendStage && validateStageTransition(stage, backendStage)) {
      setStage(backendStage);
    }

    clearAllSurveyDraftsForUser(publicId);
    setSurvey(null);
    setSurveyFeedbackReady(false);
    setLastSubmissionSucceeded(false);
    await fetchImage({ clearCurrent: true, throwOnError: true });
    return result;
  }, [
    fetchImage,
    publicId,
    setLastSubmissionSucceeded,
    setStage,
    setSurvey,
    setSurveyFeedbackReady,
    stage,
    submitSurvey,
    surveyCompleted,
  ]);

  const handleAppError = useCallback(() => {
    addToast(getErrorMessage("SYS_002_0017"), "error");
  }, [addToast]);

  return {
    isOnline,
    isActiveTabOwner,
    stage: effectiveStage,
    publicId,
    preAuthId,
    storageScope,
    sessionHydrated,
    sessionId,
    demographics,
    setDemographics,
    setStage,
    consentGiven,
    userDetailsSubmitted,
    emailVerified,
    toasts,
    addToast,
    systemReady,
    systemError,
    systemChecking,
    retryHealthCheck,
    survey,
    surveyCompleted,
    surveyFeedbackReady,
    setSurveyFeedbackReady,
    imageError,
    isFetchingImage,
    showConfetti,
    fetchImage,
    prefetchNextImage,
    handleSubmit,
    claimActiveTabLock,
    dismissToast,
    handleConsentGiven,
    handleUserDetailsSubmit,
    handleEmailVerified,
    handleAccountFlagged,
    resetWorkflowToConsent,
    handleAppError,
    clearUserStorage,
  };
}
