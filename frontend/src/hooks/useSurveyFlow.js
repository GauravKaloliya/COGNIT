import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { endpoints } from "../utils/api";
import { getErrorMessage } from "../utils/errorRegistry";
import { getDisplayErrorMessage } from "../utils/appError";
import { runtimeConfig } from "../config/runtime";
import { uiText } from "../utils/uiText";
import { requirePublicId } from "../utils/publicId";
import { SURVEY_API_FIELDS } from "../constants/fields";
import { TOAST_VARIANTS } from "../constants/ui";
import { REQUEST_CODES } from "../constants/request";
import { scheduleTimeout } from "../utils/timing";
import { forEachStorageArea, getStoredValue, makeScopedKey, removeStoredKey } from "../utils/storage";
import { consumeSurveyTelemetrySnapshot } from "../utils/clientTelemetry";
import { readCoreValue, writeCoreValue } from "../utils/appControllerState";
import { APP_FLOW } from "../config/appFlow";
import {
  createSurveyState,
  normalizeSurvey,
  surveyStateReducer,
  SURVEY_LOAD_STATES,
  SURVEY_EVENT_TYPES,
} from "../utils/surveyStateMachine";

function readStoredSurvey(publicId) {
  if (!publicId) return null;
  return normalizeSurvey(readCoreValue(runtimeConfig.storageKeys.survey, null, publicId));
}

function readStoredSurveyLoadState(publicId) {
  if (!publicId) return SURVEY_LOAD_STATES.idle;
  const stored = String(readCoreValue(runtimeConfig.storageKeys.surveyLoadState, "", publicId) || "").trim();
  return Object.values(SURVEY_LOAD_STATES).includes(stored) ? stored : SURVEY_LOAD_STATES.idle;
}

function persistSurveySnapshot(publicId, snapshot = {}) {
  const scope = String(publicId || "").trim();
  if (!scope) return;
  if (Object.prototype.hasOwnProperty.call(snapshot, "survey")) {
    writeCoreValue(runtimeConfig.storageKeys.survey, normalizeSurvey(snapshot.survey), scope);
  }
  if (Object.prototype.hasOwnProperty.call(snapshot, "loadState")) {
    writeCoreValue(runtimeConfig.storageKeys.surveyLoadState, snapshot.loadState, scope);
  }
  if (Object.prototype.hasOwnProperty.call(snapshot, "shownImages")) {
    writeCoreValue(runtimeConfig.storageKeys.shownImages, snapshot.shownImages, scope);
  }
}

function resolveActiveParticipantContext(publicId, sessionId) {
  const storedPublicId = String(getStoredValue(runtimeConfig.storageKeys.publicId, "", { area: "local" }) || "").trim();
  const effectivePublicId = storedPublicId || String(publicId || "").trim();
  const effectiveSessionId = effectivePublicId
    ? String(readCoreValue(runtimeConfig.storageKeys.sessionId, "", effectivePublicId) || sessionId || "").trim()
    : String(sessionId || "").trim();
  return {
    publicId: effectivePublicId,
    sessionId: effectiveSessionId,
  };
}

export function useSurveyFlow({
  publicId,
  sessionId,
  addToast,
  initial,
  stage,
  systemReady,
  sessionHydrated,
}) {
  const [surveyState, dispatchSurvey] = useReducer(
    surveyStateReducer,
    initial,
    createSurveyState
  );
  const [restoreAttempted, setRestoreAttempted] = useState(false);

  const prefetchedSurveyRef = useRef(null);
  const imageAbortRef = useRef(null);
  const prefetchAbortRef = useRef(null);
  const submitAbortRef = useRef(null);
  const initialRef = useRef(initial);
  initialRef.current = initial;

  useEffect(() => {
    if (!publicId) {
      setRestoreAttempted(false);
      return;
    }
    const restoredSurvey = normalizeSurvey(initialRef.current?.survey) || readStoredSurvey(publicId);
    dispatchSurvey({
      type: SURVEY_EVENT_TYPES.HYDRATE,
      survey: restoredSurvey,
      loadState: initialRef.current?.loadState || readStoredSurveyLoadState(publicId),
      surveyCompleted: initialRef.current?.surveyCompleted,
      surveyFeedbackReady: initialRef.current?.surveyFeedbackReady,
      lastSubmissionSucceeded: initialRef.current?.lastSubmissionSucceeded,
      shownImages: initialRef.current?.shownImages,
    });
    setRestoreAttempted(true);
  }, [publicId]);

  const fetchImage = useCallback(async ({ clearCurrent = false, throwOnError = false } = {}) => {
    const currentSurvey = normalizeSurvey(surveyState.survey);
    if (!clearCurrent && currentSurvey) {
      dispatchSurvey({ type: SURVEY_EVENT_TYPES.FETCH_FAILED, imageError: null, keepSurvey: true });
      return currentSurvey;
    }

    const storedSurvey = !clearCurrent ? readStoredSurvey(publicId) : null;
    if (storedSurvey) {
      dispatchSurvey({
        type: SURVEY_EVENT_TYPES.HYDRATE,
        survey: storedSurvey,
        loadState: SURVEY_LOAD_STATES.ready,
      });
      return storedSurvey;
    }

    if (clearCurrent) {
      prefetchedSurveyRef.current = null;
    }

    const activeContext = resolveActiveParticipantContext(publicId, sessionId);
    const effectivePublicId = requirePublicId(activeContext.publicId, () => {});
    if (!effectivePublicId) return null;

    if (imageAbortRef.current) {
      imageAbortRef.current.abort();
    }
    const controller = new AbortController();
    imageAbortRef.current = controller;
    persistSurveySnapshot(publicId, {
      survey: clearCurrent ? null : currentSurvey,
      loadState: clearCurrent ? SURVEY_LOAD_STATES.awaitingNextImage : SURVEY_LOAD_STATES.bootstrapping,
      shownImages: surveyState.shownImages,
    });
    dispatchSurvey({ type: SURVEY_EVENT_TYPES.FETCH_STARTED, clearCurrent });

    try {
      const response = await endpoints.getRandomImage(surveyState.shownImages, effectivePublicId, { signal: controller.signal });
      const nextSurvey = normalizeSurvey(response);
      if (!nextSurvey) {
        throw new Error(getErrorMessage("SYS_002_0016"));
      }
      const nextShownImages = surveyState.shownImages.includes(nextSurvey[SURVEY_API_FIELDS.imageId])
        ? surveyState.shownImages
        : [...surveyState.shownImages, nextSurvey[SURVEY_API_FIELDS.imageId]];
      persistSurveySnapshot(publicId, {
        survey: nextSurvey,
        loadState: SURVEY_LOAD_STATES.ready,
        shownImages: nextShownImages,
      });
      dispatchSurvey({ type: SURVEY_EVENT_TYPES.FETCH_SUCCEEDED, survey: nextSurvey });
      return nextSurvey;
    } catch (error) {
      if (error?.code === REQUEST_CODES.aborted || controller.signal.aborted) {
        return null;
      }
      dispatchSurvey({
        type: SURVEY_EVENT_TYPES.FETCH_FAILED,
        keepSurvey: Boolean(currentSurvey && !clearCurrent),
        imageError: currentSurvey && !clearCurrent ? null : "image_unavailable",
      });
      persistSurveySnapshot(publicId, {
        survey: currentSurvey && !clearCurrent ? currentSurvey : null,
        loadState: SURVEY_LOAD_STATES.error,
        shownImages: surveyState.shownImages,
      });
      if (throwOnError) {
        throw error;
      }
      return null;
    } finally {
      if (imageAbortRef.current === controller) {
        imageAbortRef.current = null;
      }
    }
  }, [publicId, sessionId, surveyState.shownImages, surveyState.survey]);

  useEffect(() => {
    if (!sessionHydrated || !systemReady || stage !== APP_FLOW.stages.survey) return;
    if (!publicId || surveyState.surveyFeedbackReady) return;
    if (!restoreAttempted) return;
    if (surveyState.isFetchingImage || surveyState.isTransitioningToNext) return;
    if (surveyState.loadState === SURVEY_LOAD_STATES.error && !normalizeSurvey(surveyState.survey)) return;
    if (normalizeSurvey(surveyState.survey)) return;

    const storedSurvey = readStoredSurvey(publicId);
    if (storedSurvey) {
      dispatchSurvey({
        type: SURVEY_EVENT_TYPES.HYDRATE,
        survey: storedSurvey,
        loadState: SURVEY_LOAD_STATES.ready,
      });
      return;
    }

    const storedLoadState = readStoredSurveyLoadState(publicId);
    if (storedLoadState === SURVEY_LOAD_STATES.error) {
      dispatchSurvey({
        type: SURVEY_EVENT_TYPES.HYDRATE,
        survey: null,
        loadState: SURVEY_LOAD_STATES.error,
        replaceSurvey: true,
      });
      return;
    }

    void fetchImage({ clearCurrent: false });
  }, [
    fetchImage,
    publicId,
    restoreAttempted,
    sessionHydrated,
    stage,
    surveyState.imageError,
    surveyState.isFetchingImage,
    surveyState.loadState,
    surveyState.isTransitioningToNext,
    surveyState.survey,
    surveyState.surveyFeedbackReady,
    systemReady,
  ]);

  const prefetchNextImage = useCallback(async () => {
    return null;
  }, []);

  const handleSubmit = useCallback(async (formData) => {
    const activeContext = resolveActiveParticipantContext(publicId, sessionId);
    const effectivePublicId = requirePublicId(activeContext.publicId, () => {
      addToast(getErrorMessage("NF_001_0001"), TOAST_VARIANTS.warning);
    });
    if (!effectivePublicId || !surveyState.survey?.[SURVEY_API_FIELDS.imageId]) {
      throw new Error(getErrorMessage("NF_001_0001"));
    }

    if (submitAbortRef.current) {
      submitAbortRef.current.abort();
    }
    const controller = new AbortController();
    submitAbortRef.current = controller;

    try {
      const telemetry = consumeSurveyTelemetrySnapshot("survey");
      const response = await endpoints.submitDescription({
        [SURVEY_API_FIELDS.publicId]: effectivePublicId,
        [SURVEY_API_FIELDS.sessionId]: activeContext.sessionId || undefined,
        [SURVEY_API_FIELDS.imageId]: surveyState.survey[SURVEY_API_FIELDS.imageId],
        description: formData.description,
        feedback: formData.comments,
        [SURVEY_API_FIELDS.timeSpentSeconds]: formData.timeSpentSeconds,
        [SURVEY_API_FIELDS.isSurvey]: surveyState.survey?.[SURVEY_API_FIELDS.isSurvey] === true,
        [SURVEY_API_FIELDS.isAttentionCheck]: surveyState.survey?.[SURVEY_API_FIELDS.isAttentionCheck] === true,
        [SURVEY_API_FIELDS.surveyIndex]: surveyState.surveyCompleted + 1,
        [SURVEY_API_FIELDS.tabSwitchCount]: formData.engagementData?.tabSwitchCount || 0,
        [SURVEY_API_FIELDS.pageCloseAttempts]: formData.engagementData?.pageCloseAttempts || 0,
        [SURVEY_API_FIELDS.networkDisconnects]: formData.engagementData?.networkDisconnects || 0,
        [SURVEY_API_FIELDS.surveyTimeSpentSeconds]: telemetry?.survey_time_spent_seconds || 0,
        [SURVEY_API_FIELDS.surveyPageViews]: telemetry?.survey_page_views || 0,
        [SURVEY_API_FIELDS.surveyTabSwitches]: telemetry?.survey_tab_switches || 0,
        [SURVEY_API_FIELDS.surveyPageCloseAttempts]: telemetry?.survey_page_close_attempts || 0,
        [SURVEY_API_FIELDS.surveyNetworkDisconnects]: telemetry?.survey_network_disconnects || 0,
        [SURVEY_API_FIELDS.surveyMaxScrollDepthPct]: telemetry?.survey_max_scroll_depth_pct || 0,
        [SURVEY_API_FIELDS.surveyClicks]: telemetry?.survey_clicks || 0,
        [SURVEY_API_FIELDS.surveyKeypresses]: telemetry?.survey_keypresses || 0,
        [SURVEY_API_FIELDS.confidenceRating]: formData.confidenceRating,
        [SURVEY_API_FIELDS.difficultySelfReport]: formData.difficultySelfReport,
        [SURVEY_API_FIELDS.timeBeforeTypingSeconds]: formData.timeBeforeTypingSeconds || 0,
        [SURVEY_API_FIELDS.editCount]: formData.editCount || 0,
        [SURVEY_API_FIELDS.backspaceCount]: formData.backspaceCount || 0,
        [SURVEY_API_FIELDS.firstViewDurationSeconds]: formData.firstViewDurationSeconds || 0,
        [SURVEY_API_FIELDS.writingDurationSeconds]: formData.writingDurationSeconds || 0,
        [SURVEY_API_FIELDS.avgKeystrokeIntervalSeconds]: formData.avgKeystrokeIntervalSeconds ?? null,
        [SURVEY_API_FIELDS.keystrokeVariance]: formData.keystrokeVariance ?? null,
        [SURVEY_API_FIELDS.pauseCount]: formData.pauseCount || 0,
        [SURVEY_API_FIELDS.avgPauseDurationSeconds]: formData.avgPauseDurationSeconds ?? null,
      }, { signal: controller.signal });

      addToast(uiText("survey.saved"), TOAST_VARIANTS.success);
      dispatchSurvey({ type: SURVEY_EVENT_TYPES.SUBMIT_SUCCEEDED });
      scheduleTimeout(() => dispatchSurvey({ type: SURVEY_EVENT_TYPES.HIDE_CONFETTI }), runtimeConfig.confettiDurationMs);

      const scope = String(publicId || "").trim();
      forEachStorageArea((area) => {
        removeStoredKey(runtimeConfig.storageKeys.emailOtpState, area);
        if (scope) {
          removeStoredKey(makeScopedKey(runtimeConfig.storageKeys.emailOtpState, scope), area);
        }
      });

      return response;
    } catch (error) {
      if (error?.code === REQUEST_CODES.aborted || controller.signal.aborted) {
        return;
      }
      dispatchSurvey({ type: SURVEY_EVENT_TYPES.SUBMIT_FAILED });
      const wrappedError = new Error(getDisplayErrorMessage(error, "SYS_002_0006"));
      wrappedError.code = error?.code;
      wrappedError.category = error?.category;
      wrappedError.field = error?.field;
      wrappedError.fields = error?.fields;
      wrappedError.status = error?.status;
      wrappedError.details = error?.details;
      wrappedError.requestId = error?.requestId;
      throw wrappedError;
    } finally {
      if (submitAbortRef.current === controller) {
        submitAbortRef.current = null;
      }
    }
  }, [addToast, publicId, sessionId, surveyState.survey, surveyState.surveyCompleted]);

  const cancelInFlightRequests = useCallback(() => {
    [imageAbortRef, prefetchAbortRef, submitAbortRef].forEach((ref) => {
      if (ref.current) {
        ref.current.abort();
        ref.current = null;
      }
    });
  }, []);

  return {
    surveyState,
    survey: surveyState.survey,
    surveyLoadState: surveyState.loadState,
    surveyCompleted: surveyState.surveyCompleted,
    surveyFeedbackReady: surveyState.surveyFeedbackReady,
    lastSubmissionSucceeded: surveyState.lastSubmissionSucceeded,
    shownImages: surveyState.shownImages,
    imageError: surveyState.imageError,
    isFetchingImage: surveyState.isFetchingImage,
    isTransitioningToNext: surveyState.isTransitioningToNext,
    showConfetti: surveyState.showConfetti,
    surveyActions: {
      resetSession: (nextState = null) => dispatchSurvey({ type: SURVEY_EVENT_TYPES.RESET, nextState }),
      prepareNextSurvey: () => {
        persistSurveySnapshot(publicId, {
          survey: null,
          loadState: SURVEY_LOAD_STATES.awaitingNextImage,
          shownImages: surveyState.shownImages,
        });
        dispatchSurvey({ type: SURVEY_EVENT_TYPES.PREPARE_NEXT_SURVEY });
      },
      hydrateSurvey: (snapshot) => dispatchSurvey({ type: SURVEY_EVENT_TYPES.HYDRATE, ...(snapshot || {}) }),
    },
    fetchImage,
    prefetchNextImage,
    handleSubmit,
    cancelInFlightRequests,
  };
}
