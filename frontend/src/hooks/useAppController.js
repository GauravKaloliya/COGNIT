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
import {
  readCoreValue,
  writeCoreValue,
  validateStageTransition,
} from "../utils/appControllerState";
import { useToastState } from "./useToastState";
import { useActiveTabOwnership } from "./useActiveTabOwnership";
import { useWorkflowCoreState } from "./useWorkflowCoreState";
import { useWorkflowPersistence } from "./useWorkflowPersistence";
import { clearAllSurveyDraftsForUser } from "../utils/surveyDraft";
import { WORKFLOW_EVENT_TYPES } from "../utils/workflowStateMachine";
import { resetTelemetrySession } from "../utils/clientTelemetry";

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

function hasUsableSurvey(survey) {
  return Boolean(
    survey?.image_id
    || survey?.imageId
    || (
      survey?.url
      && String(survey?.url || survey?.image_url || survey?.imageUrl || "").trim()
    )
  );
}

export function useAppController() {
  const isOnline = useOnlineStatus();
  const { toasts, addToast, dismissToast } = useToastState();
  const { isActiveTabOwner, claimActiveTabLock } = useActiveTabOwnership();
  const submitAbortRef = useRef(null);
  const createParticipantPromiseRef = useRef(null);
  const sessionCloseSignalSentRef = useRef("");

  const {
    workflowState,
    dispatchWorkflow,
    updateWorkflowState,
    resetWorkflowState,
    publicId,
    preAuthId,
    scopeId,
    sessionId,
    stage,
    consentGiven,
    userDetailsSubmitted,
    emailVerified,
    sessionHydrated,
    setSessionHydrated,
    demographics,
    clearUserStorage,
  } = useWorkflowCoreState({ addToast });

  const storageScope = String(publicId || preAuthId || "").trim();

  const { systemReady, systemError, systemChecking, retryHealthCheck } = useSystemHealth({
    isActiveTabOwner,
  });

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
    stage,
    systemReady,
    sessionHydrated,
  });

  const {
    survey,
    surveyCompleted,
    surveyFeedbackReady,
    lastSubmissionSucceeded,
    imageError,
    isFetchingImage,
    isTransitioningToNext,
    showConfetti,
    surveyActions,
    fetchImage,
    prefetchNextImage,
    handleSubmit: submitSurvey,
    cancelInFlightRequests,
  } = surveyFlow;

  const handleClosedSessionReset = useCallback((scopeOverride = null) => {
    const targetScope = scopeOverride || publicId;
    clearUserStorage(targetScope);
    resetTelemetrySession(APP_FLOW.stages.consent);
    resetWorkflowState({
      publicId: "",
      sessionId: "",
      consentGiven: false,
      userDetailsSubmitted: false,
      emailVerified: false,
      demographics: EMPTY_DEMOGRAPHICS,
      stage: APP_FLOW.stages.consent,
    });
    surveyActions.resetSession();
    addToast(uiText("app.sessionResetToast"), "info");
  }, [
    addToast,
    clearUserStorage,
    publicId,
    resetWorkflowState,
    surveyActions,
  ]);

  useWorkflowPersistence({
    workflowState,
    preAuthId,
    updateWorkflowState,
    onSessionClosed: handleClosedSessionReset,
    scopeId,
    sessionHydrated,
    setSessionHydrated,
    isOnline,
    surveyState: surveyFlow.surveyState,
  });

  useEffect(() => {
    if (!sessionHydrated) return;
    dispatchWorkflow({
      type: WORKFLOW_EVENT_TYPES.RECONCILE_STAGE,
      surveyContext: {
        hasSurveyInProgress: hasUsableSurvey(survey),
        surveyCompleted,
        surveyFeedbackReady,
        lastSubmissionSucceeded,
      },
    });
  }, [
    dispatchWorkflow,
    lastSubmissionSucceeded,
    sessionHydrated,
    survey,
    surveyCompleted,
    surveyFeedbackReady,
  ]);

  useEffect(() => () => {
    cancelInFlightRequests?.();
    if (submitAbortRef.current) {
      submitAbortRef.current.abort();
    }
  }, [cancelInFlightRequests]);

  useEffect(() => {
    sessionCloseSignalSentRef.current = "";
  }, [publicId, sessionId]);

  useEffect(() => {
    if (!publicId || !sessionId) return undefined;
    if (stage === APP_FLOW.stages.postSurvey || stage === APP_FLOW.stages.consent) return undefined;

    const sessionPayload = { public_id: publicId, session_id: sessionId };
    const signalHidden = () => {
      const dedupeKey = `${publicId}:${sessionId}:${stage}:hidden`;
      if (sessionCloseSignalSentRef.current === dedupeKey) return;
      sessionCloseSignalSentRef.current = dedupeKey;
      endpoints.signalParticipantSessionPresence({
        ...sessionPayload,
        presence_state: "hidden",
      });
    };
    const signalActive = () => {
      const dedupeKey = `${publicId}:${sessionId}:${stage}:active`;
      if (sessionCloseSignalSentRef.current === dedupeKey) return;
      sessionCloseSignalSentRef.current = dedupeKey;
      void endpoints.updateParticipantSessionPresence({
        ...sessionPayload,
        presence_state: "active",
      }).catch(() => {});
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        signalHidden();
        return;
      }
      signalActive();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", signalActive);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", signalActive);
    };
  }, [publicId, sessionId, stage]);

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
      resetTelemetrySession(APP_FLOW.stages.userDetails);
      if (nextPublicId) {
        writeCoreValue(runtimeConfig.storageKeys.demographics, demographics, nextPublicId, {
          ttlMs: runtimeConfig.piiStateTtlMs,
        });
        writeCoreValue(runtimeConfig.storageKeys.userDetailsSubmitted, true, nextPublicId);
        writeCoreValue(runtimeConfig.storageKeys.consentGiven, consentGiven, nextPublicId);
        writeCoreValue(runtimeConfig.storageKeys.emailVerified, false, nextPublicId);
        writeCoreValue(runtimeConfig.storageKeys.stage, APP_FLOW.stages.userDetails, nextPublicId);
      }
      dispatchWorkflow({
        type: WORKFLOW_EVENT_TYPES.PARTICIPANT_CREATED,
        publicId: nextPublicId,
        sessionId: "",
      });
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
    dispatchWorkflow,
    publicId,
    sessionId,
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
      const result = await endpoints.recordConsent(consentPublicId, { signal: controller.signal });
      const nextSessionId = String(result?.session_id || "").trim();
      if (consentPublicId && nextSessionId) {
        writeCoreValue(runtimeConfig.storageKeys.sessionId, nextSessionId, consentPublicId);
        updateWorkflowState({ sessionId: nextSessionId });
      }
      return result;
    } catch (error) {
      if (error?.code === "REQ_ABORTED" || controller.signal.aborted) throw error;
      wrapControllerError(error, "SYS_002_0002");
    } finally {
      if (submitAbortRef.current === controller) {
        submitAbortRef.current = null;
      }
    }
  }, [publicId, updateWorkflowState]);

  const handleConsentGiven = useCallback(async () => {
    dispatchWorkflow({ type: WORKFLOW_EVENT_TYPES.CONSENT_ACCEPTED });
    addToast(uiText("consent.saved"), "success");
  }, [addToast, dispatchWorkflow]);

  const handleUserDetailsSubmit = useCallback(async () => {
    try {
      const participant = await createParticipant();
      if (consentGiven) {
        await recordConsent(participant?.public_id || publicId);
      }
      updateWorkflowState({ emailVerified: false });
      addToast(uiText("user.detailsSaved"), "success");
      return participant;
    } catch (error) {
      addToast(error.message, "error");
      throw error;
    }
  }, [addToast, consentGiven, createParticipant, publicId, recordConsent, updateWorkflowState]);

  const handleEmailVerified = useCallback(() => {
    dispatchWorkflow({ type: WORKFLOW_EVENT_TYPES.EMAIL_VERIFIED });
  }, [dispatchWorkflow]);

  const resetWorkflowToConsent = useCallback((scopeOverride = null, options = {}) => {
    clearUserStorage(scopeOverride || publicId, options);
    resetTelemetrySession(APP_FLOW.stages.consent);
    resetWorkflowState({
      publicId: "",
      sessionId: "",
      consentGiven: false,
      userDetailsSubmitted: false,
      emailVerified: false,
      demographics: EMPTY_DEMOGRAPHICS,
      stage: APP_FLOW.stages.consent,
    });
    surveyActions.resetSession();
  }, [
    clearUserStorage,
    publicId,
    resetWorkflowState,
    surveyActions,
  ]);

  const handleAccountFlagged = useCallback((scopeOverride = null) => {
    resetWorkflowToConsent(scopeOverride);
  }, [resetWorkflowToConsent]);

  const handleSubmit = useCallback(async (formData) => {
    try {
      const result = await submitSurvey(formData);
      const backendStage = normalizeAppStage(result?.workflow_status?.stage);
      const nextCompleted = Number(surveyCompleted || 0) + 1;
      const requiredSubmissions = Math.max(1, Number(runtimeConfig.requiredSurveySubmissions || 2));
      const reachedPostSurvey = backendStage === APP_FLOW.stages.postSurvey || nextCompleted >= requiredSubmissions;

      if (reachedPostSurvey || result?.session_closed || result?.clear_client_state) {
        clearUserStorage(publicId, {
          preserveDarkMode: true,
          dropPreAuthScope: true,
          preserveRootValues: {
            [runtimeConfig.storageKeys.publicId]: publicId,
          },
          preserveScopedValues: {
            [runtimeConfig.storageKeys.stage]: APP_FLOW.stages.postSurvey,
            [runtimeConfig.storageKeys.consentGiven]: true,
            [runtimeConfig.storageKeys.userDetailsSubmitted]: true,
            [runtimeConfig.storageKeys.emailVerified]: true,
            [runtimeConfig.storageKeys.demographics]: demographics,
            [runtimeConfig.storageKeys.sessionId]: sessionId,
            [runtimeConfig.storageKeys.surveyCompleted]: nextCompleted,
            [runtimeConfig.storageKeys.surveyFeedbackReady]: reachedPostSurvey,
            [runtimeConfig.storageKeys.lastSubmissionSucceeded]: reachedPostSurvey,
          },
        });
        if (!reachedPostSurvey) {
          surveyActions.resetSession();
        }
      }

      if (reachedPostSurvey) {
        dispatchWorkflow({ type: WORKFLOW_EVENT_TYPES.ADVANCE_TO_POST_SURVEY });
        return result;
      }

      if (backendStage && validateStageTransition(stage, backendStage)) {
        dispatchWorkflow({
          type: WORKFLOW_EVENT_TYPES.PATCH,
          patch: { stage: backendStage },
        });
      }

      clearAllSurveyDraftsForUser(publicId);
      surveyActions.prepareNextSurvey();
      await fetchImage({ clearCurrent: true, throwOnError: true });
      return result;
    } catch (error) {
      if (error?.details?.session_closed || error?.details?.clear_client_state) {
        handleClosedSessionReset(publicId);
      }
      throw error;
    }
  }, [
    clearUserStorage,
    demographics,
    fetchImage,
    handleClosedSessionReset,
    publicId,
    sessionId,
    stage,
    submitSurvey,
    surveyCompleted,
    dispatchWorkflow,
    surveyActions,
  ]);

  const handleAppError = useCallback(() => {
    addToast(getErrorMessage("SYS_002_0017"), "error");
  }, [addToast]);

  const setDemographics = useCallback((nextValue) => {
    updateWorkflowState((prev) => ({
      demographics: typeof nextValue === "function"
        ? nextValue(prev.demographics || EMPTY_DEMOGRAPHICS)
        : nextValue,
    }));
  }, [updateWorkflowState]);

  const setStage = useCallback((nextStage) => {
    updateWorkflowState({ stage: nextStage });
  }, [updateWorkflowState]);

  const setSurveyFeedbackReady = useCallback((nextValue) => {
    surveyActions.hydrateSurvey({
      surveyFeedbackReady: typeof nextValue === "function"
        ? nextValue(Boolean(surveyFeedbackReady))
        : nextValue,
    });
  }, [surveyActions, surveyFeedbackReady]);

  return {
    appState: {
      isOnline,
      isActiveTabOwner,
      stage,
      publicId,
      preAuthId,
      storageScope,
      sessionHydrated,
      sessionId,
      consentGiven,
      userDetailsSubmitted,
      emailVerified,
    },
    workflowState: {
      demographics,
    },
    surveyState: {
      survey,
      surveyCompleted,
      surveyFeedbackReady,
      imageError,
      isFetchingImage,
      isTransitioningToNext,
      showConfetti,
    },
    systemState: {
      systemReady,
      systemError,
      systemChecking,
    },
    toastState: {
      toasts,
    },
    actions: {
      setDemographics,
      setStage,
      setSurveyFeedbackReady,
      fetchImage,
      prefetchNextImage,
      handleSubmit,
      claimActiveTabLock,
      dismissToast,
      addToast,
      retryHealthCheck,
      handleConsentGiven,
      handleUserDetailsSubmit,
      handleEmailVerified,
      handleAccountFlagged,
      resetWorkflowToConsent,
      handleAppError,
      clearUserStorage,
    },
  };
}
