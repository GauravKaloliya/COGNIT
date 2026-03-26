import { useCallback, useEffect, useRef } from "react";
import { endpoints } from "../utils/api.js";
import { getErrorMessage } from "../utils/errorRegistry.js";
import { getDisplayErrorMessage } from "../utils/appError.js";
import { useOnlineStatus } from "./useOnlineStatus";
import { useSystemHealth } from "./useSystemHealth";
import { useSurveyFlow } from "./useSurveyFlow";
import { runtimeConfig } from "../config/runtime";
import { uiText } from "../utils/uiText";
import { APP_FLOW, normalizeAppStage } from "../config/appFlow";
import { readCoreValue, validateStageTransition } from "../utils/appControllerState";
import { useToastState } from "./useToastState";
import { useActiveTabOwnership } from "./useActiveTabOwnership";
import { useWorkflowCoreState } from "./useWorkflowCoreState";
import { useWorkflowPersistence } from "./useWorkflowPersistence";
import { clearAllSurveyDraftsForUser } from "../utils/surveyDraft";

function rethrowWithMetadata(error, fallbackCode, fallbackMessage) {
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

export function useAppController() {
  const isOnline = useOnlineStatus();
  const { toasts, addToast, dismissToast } = useToastState();
  const { isActiveTabOwner, claimActiveTabLock } = useActiveTabOwnership();
  const submitFlowAbortRef = useRef(null);

  const workflow = useWorkflowCoreState({ addToast });
  const {
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
  } = workflow;

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
  });

  const systemHealth = useSystemHealth({
    isActiveTabOwner,
  });

  const { systemReady, systemError, systemChecking, retryHealthCheck } = systemHealth;

  useEffect(() => () => {
    cancelInFlightRequests?.();
    if (submitFlowAbortRef.current) submitFlowAbortRef.current.abort();
  }, [cancelInFlightRequests]);

  useEffect(() => {
    if (stage !== APP_FLOW.stages.survey || !systemReady || surveyFeedbackReady) return;
    if (!sessionHydrated) return;
    const restoredImageUrl = survey?.url || survey?.image_url || survey?.imageUrl || "";
    if (!survey || !survey.image_id || !String(restoredImageUrl).trim()) {
      if (!publicId) return;
      fetchImage({ clearCurrent: false });
    }
  }, [fetchImage, publicId, sessionHydrated, stage, survey, surveyFeedbackReady, systemReady]);

  const createParticipant = useCallback(async () => {
    if (submitFlowAbortRef.current) {
      submitFlowAbortRef.current.abort();
    }
    const controller = new AbortController();
    submitFlowAbortRef.current = controller;
    try {
      const participant = await endpoints.createParticipant({
        username: demographics.username,
        email: demographics.email,
        gender_code: demographics.gender_code,
        age: parseInt(demographics.age),
        location: demographics.location,
        language_code: demographics.language_code,
        prior_experience: demographics.prior_experience,
      }, { signal: controller.signal });
      if (participant?.public_id) setPublicId(participant.public_id);
      if (participant?.session_id) setSessionId(participant.session_id);
      setUserDetailsSubmitted(true);
      return participant;
    } catch (error) {
      if (error?.code === "REQ_ABORTED" || controller.signal.aborted) throw error;
      rethrowWithMetadata(error, "SYS_002_0022");
    } finally {
      if (submitFlowAbortRef.current === controller) {
        submitFlowAbortRef.current = null;
      }
    }
  }, [demographics, setPublicId, setSessionId, setUserDetailsSubmitted]);

  const recordConsent = useCallback(async (publicIdOverride = null) => {
    if (submitFlowAbortRef.current) {
      submitFlowAbortRef.current.abort();
    }
    const controller = new AbortController();
    submitFlowAbortRef.current = controller;
    try {
      const consentPublicId = publicIdOverride || publicId;
      if (!consentPublicId) {
        const missingPublicIdError = new Error(getErrorMessage("NF_001_0001"));
        missingPublicIdError.code = "NF_001_0001";
        missingPublicIdError.category = "NF";
        missingPublicIdError.status = 404;
        missingPublicIdError.retryable = false;
        missingPublicIdError.action = "redirect";
        throw missingPublicIdError;
      }
      return await endpoints.recordConsent(consentPublicId, { signal: controller.signal });
    } catch (error) {
      if (error?.code === "REQ_ABORTED" || controller.signal.aborted) throw error;
      rethrowWithMetadata(error, "SYS_002_0002");
    } finally {
      if (submitFlowAbortRef.current === controller) {
        submitFlowAbortRef.current = null;
      }
    }
  }, [publicId]);

  const handleUserDetailsSubmit = useCallback(async () => {
    try {
      const participant = await createParticipant();
      const consentPublicId = participant?.public_id || publicId;
      if (consentGiven) await recordConsent(consentPublicId);
      setEmailVerified(false);
      addToast(uiText("user.detailsSaved"), "success");
      return participant;
    } catch (err) {
      addToast(err.message, "error");
      throw err;
    }
  }, [addToast, consentGiven, createParticipant, publicId, recordConsent, setEmailVerified]);

  const handleConsentGiven = useCallback(async () => {
    setConsentGiven(true);
    if (validateStageTransition(APP_FLOW.stages.consent, APP_FLOW.stages.userDetails)) {
      setStage(APP_FLOW.stages.userDetails);
    }
    addToast(uiText("consent.saved"), "success");
  }, [addToast, setConsentGiven, setStage]);

  const handleEmailVerified = useCallback(() => {
    setEmailVerified(true);
    if (validateStageTransition(APP_FLOW.stages.userDetails, APP_FLOW.stages.survey)) {
      setStage(APP_FLOW.stages.survey);
    }
  }, [setEmailVerified, setStage]);

  const resetWorkflowToConsent = useCallback((scopeOverride = null) => {
    const effectiveScope = scopeOverride || publicId;
    clearUserStorage(effectiveScope);
    setPublicId("");
    setSessionId("");
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
    const backendStage = result?.workflow_status?.stage;
    if (backendStage) {
      const normalizedStage = normalizeAppStage(backendStage);
      if (validateStageTransition(stage, normalizedStage)) {
        setStage(normalizedStage);
      }
      if (normalizedStage === APP_FLOW.stages.postSurvey) {
        return result;
      }
    }
    const requiredSubmissions = Math.max(1, Number(runtimeConfig.requiredSurveySubmissions || 2));
    const nextCompleted = Number(surveyCompleted || 0) + 1;
    if (nextCompleted >= requiredSubmissions) {
      if (validateStageTransition(APP_FLOW.stages.survey, APP_FLOW.stages.postSurvey)) {
        setStage(APP_FLOW.stages.postSurvey);
      }
      return result;
    }

    clearAllSurveyDraftsForUser(publicId);
    setSurveyFeedbackReady(false);
    await fetchImage({ clearCurrent: true, throwOnError: true });
    return result;
  }, [fetchImage, publicId, setStage, setSurveyFeedbackReady, stage, submitSurvey, surveyCompleted]);

  const handleAppError = useCallback(() => addToast(getErrorMessage("SYS_002_0017"), "error"), [addToast]);

  return {
    isOnline,
    isActiveTabOwner,
    stage,
    publicId,
    sessionId,
    demographics,
    setDemographics,
    setStage,
    consentGiven,
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
