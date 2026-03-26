import { useCallback, useEffect, useRef, useState } from "react";
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
import { getTelemetrySnapshot } from "../utils/clientTelemetry";
import { readCoreValue } from "../utils/appControllerState";

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

function readStoredSurvey(publicId) {
  if (!publicId) return null;
  return normalizeSurvey(readCoreValue(runtimeConfig.storageKeys.survey, null, publicId));
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

function areSurveysEqual(left, right) {
  const normalizedLeft = normalizeSurvey(left);
  const normalizedRight = normalizeSurvey(right);
  if (!normalizedLeft && !normalizedRight) return true;
  if (!normalizedLeft || !normalizedRight) return false;
  return (
    normalizedLeft[SURVEY_API_FIELDS.imageId] === normalizedRight[SURVEY_API_FIELDS.imageId]
    && normalizedLeft[SURVEY_API_FIELDS.url] === normalizedRight[SURVEY_API_FIELDS.url]
  );
}

export function useSurveyFlow({ publicId, sessionId, addToast, initial }) {
  const [survey, setSurvey] = useState(() => normalizeSurvey(initial?.survey));
  const [surveyCompleted, setSurveyCompleted] = useState(() => Math.max(0, Number(initial?.surveyCompleted) || 0));
  const [surveyFeedbackReady, setSurveyFeedbackReady] = useState(initial?.surveyFeedbackReady === true);
  const [lastSubmissionSucceeded, setLastSubmissionSucceeded] = useState(initial?.lastSubmissionSucceeded === true);
  const [shownImages, setShownImages] = useState(() => (Array.isArray(initial?.shownImages) ? initial.shownImages : []));
  const [imageError, setImageError] = useState(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const [isFetchingImage, setIsFetchingImage] = useState(false);

  const prefetchedSurveyRef = useRef(null);
  const imageAbortRef = useRef(null);
  const prefetchAbortRef = useRef(null);
  const submitAbortRef = useRef(null);
  const initialRef = useRef(initial);
  initialRef.current = initial;

  useEffect(() => {
    const restoredSurvey = normalizeSurvey(initialRef.current?.survey) || readStoredSurvey(publicId);
    if (restoredSurvey) {
      setSurvey((prev) => (areSurveysEqual(prev, restoredSurvey) ? prev : restoredSurvey));
      setImageError(null);
      setShownImages((prev) => (
        prev.includes(restoredSurvey[SURVEY_API_FIELDS.imageId])
          ? prev
          : [...prev, restoredSurvey[SURVEY_API_FIELDS.imageId]]
      ));
    }
    if (Number.isFinite(initialRef.current?.surveyCompleted)) {
      setSurveyCompleted((prev) => Math.max(prev, Number(initialRef.current.surveyCompleted) || 0));
    }
    if (initialRef.current?.surveyFeedbackReady === true) {
      setSurveyFeedbackReady(true);
    }
    if (initialRef.current?.lastSubmissionSucceeded === true) {
      setLastSubmissionSucceeded(true);
    }
    if (Array.isArray(initialRef.current?.shownImages) && initialRef.current.shownImages.length > 0) {
      setShownImages((prev) => (prev.length > 0 ? prev : initialRef.current.shownImages));
    }
  }, [publicId]);

  const fetchImage = useCallback(async ({ clearCurrent = false, throwOnError = false } = {}) => {
    const currentSurvey = normalizeSurvey(survey);
    if (!clearCurrent && currentSurvey) {
      setImageError(null);
      return currentSurvey;
    }

    const storedSurvey = !clearCurrent ? readStoredSurvey(publicId) : null;
    if (storedSurvey) {
      setSurvey(storedSurvey);
      setImageError(null);
      setShownImages((prev) => (
        prev.includes(storedSurvey[SURVEY_API_FIELDS.imageId])
          ? prev
          : [...prev, storedSurvey[SURVEY_API_FIELDS.imageId]]
      ));
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
    setIsFetchingImage(true);
    setSurveyFeedbackReady(false);
    setLastSubmissionSucceeded(false);
    setImageError(null);
    if (clearCurrent) {
      setSurvey(null);
    }

    try {
      const response = await endpoints.getRandomImage(shownImages, effectivePublicId, { signal: controller.signal });
      const nextSurvey = normalizeSurvey(response);
      if (!nextSurvey) {
        throw new Error(getErrorMessage("SYS_002_0016"));
      }
      setSurvey(nextSurvey);
      setShownImages((prev) => [...prev, nextSurvey[SURVEY_API_FIELDS.imageId]]);
      return nextSurvey;
    } catch (error) {
      if (error?.code === REQUEST_CODES.aborted || controller.signal.aborted) {
        return null;
      }
      if (currentSurvey && !clearCurrent) {
        setSurvey(currentSurvey);
        setImageError(null);
      } else {
        setSurvey(null);
        setImageError("image_unavailable");
      }
      if (throwOnError) {
        throw error;
      }
      return null;
    } finally {
      if (imageAbortRef.current === controller) {
        imageAbortRef.current = null;
      }
      setIsFetchingImage(false);
    }
  }, [publicId, sessionId, shownImages, survey]);

  const prefetchNextImage = useCallback(async () => {
    const activeContext = resolveActiveParticipantContext(publicId, sessionId);
    if (!activeContext.publicId || prefetchedSurveyRef.current) return prefetchedSurveyRef.current;
    if (prefetchAbortRef.current) {
      prefetchAbortRef.current.abort();
    }
    const controller = new AbortController();
    prefetchAbortRef.current = controller;
    try {
      const excluded = [...shownImages, survey?.[SURVEY_API_FIELDS.imageId]].filter(Boolean);
      const response = await endpoints.getRandomImage(excluded, activeContext.publicId, { signal: controller.signal });
      const nextSurvey = normalizeSurvey(response);
      if (!nextSurvey) return null;
      prefetchedSurveyRef.current = nextSurvey;
      try {
        const image = new Image();
        image.src = nextSurvey[SURVEY_API_FIELDS.url];
      } catch {
        // Ignore preloading failures.
      }
      return nextSurvey;
    } catch {
      return null;
    } finally {
      if (prefetchAbortRef.current === controller) {
        prefetchAbortRef.current = null;
      }
    }
  }, [publicId, sessionId, shownImages, survey]);

  const handleSubmit = useCallback(async (formData) => {
    const activeContext = resolveActiveParticipantContext(publicId, sessionId);
    const effectivePublicId = requirePublicId(activeContext.publicId, () => {
      addToast(getErrorMessage("NF_001_0001"), TOAST_VARIANTS.warning);
    });
    if (!effectivePublicId || !survey?.[SURVEY_API_FIELDS.imageId]) {
      throw new Error(getErrorMessage("NF_001_0001"));
    }

    if (submitAbortRef.current) {
      submitAbortRef.current.abort();
    }
    const controller = new AbortController();
    submitAbortRef.current = controller;

    try {
      const telemetry = getTelemetrySnapshot("survey");
      const response = await endpoints.submitDescription({
        [SURVEY_API_FIELDS.publicId]: effectivePublicId,
        [SURVEY_API_FIELDS.sessionId]: activeContext.sessionId || undefined,
        [SURVEY_API_FIELDS.imageId]: survey[SURVEY_API_FIELDS.imageId],
        description: formData.description,
        rating: formData.rating,
        feedback: formData.comments,
        [SURVEY_API_FIELDS.timeSpentSeconds]: formData.timeSpentSeconds,
        [SURVEY_API_FIELDS.isSurvey]: survey?.[SURVEY_API_FIELDS.isSurvey] === true,
        [SURVEY_API_FIELDS.isAttentionCheck]: survey?.[SURVEY_API_FIELDS.isAttentionCheck] === true,
        [SURVEY_API_FIELDS.surveyIndex]: surveyCompleted + 1,
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
        [SURVEY_API_FIELDS.confidenceScore]: formData.confidenceScore,
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
      setShowConfetti(true);
      scheduleTimeout(() => setShowConfetti(false), runtimeConfig.confettiDurationMs);
      setSurveyCompleted((prev) => prev + 1);
      setLastSubmissionSucceeded(true);
      setSurveyFeedbackReady(true);

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
      setLastSubmissionSucceeded(false);
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
  }, [addToast, publicId, sessionId, survey, surveyCompleted]);

  const cancelInFlightRequests = useCallback(() => {
    [imageAbortRef, prefetchAbortRef, submitAbortRef].forEach((ref) => {
      if (ref.current) {
        ref.current.abort();
        ref.current = null;
      }
    });
  }, []);

  return {
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
    setImageError,
    isFetchingImage,
    showConfetti,
    fetchImage,
    prefetchNextImage,
    handleSubmit,
    cancelInFlightRequests,
  };
}
