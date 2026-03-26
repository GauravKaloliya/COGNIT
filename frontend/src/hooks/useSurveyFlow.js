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
import { forEachStorageArea, makeScopedKey, removeStoredKey } from "../utils/storage";
import { getTelemetrySnapshot } from "../utils/clientTelemetry";
import { readCoreValue } from "../utils/appControllerState";

const normalizeSurveyPayload = (value) => {
  if (!value || typeof value !== "object") return null;
  const imageId = value[SURVEY_API_FIELDS.imageId] || value.imageId || null;
  const imageUrl = value[SURVEY_API_FIELDS.url] || value[SURVEY_API_FIELDS.imageUrl] || value.imageUrl || "";
  return {
    ...value,
    [SURVEY_API_FIELDS.imageId]: imageId,
    [SURVEY_API_FIELDS.url]: imageUrl,
  };
};

export function useSurveyFlow({ publicId, sessionId, addToast, initial }) {
  const [survey, setSurvey] = useState(normalizeSurveyPayload(initial?.survey));
  const [surveyCompleted, setSurveyCompleted] = useState(initial?.surveyCompleted || 0);
  const [surveyFeedbackReady, setSurveyFeedbackReady] = useState(initial?.surveyFeedbackReady || false);
  const [lastSubmissionSucceeded, setLastSubmissionSucceeded] = useState(
    initial?.lastSubmissionSucceeded || false
  );
  const [shownImages, setShownImages] = useState(initial?.shownImages || []);
  const [imageError, setImageError] = useState(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const [isFetchingImage, setIsFetchingImage] = useState(false);
  const inFlightRef = useRef(false);
  const imageAbortRef = useRef(null);
  const prefetchAbortRef = useRef(null);
  const prefetchedSurveyRef = useRef(null);
  const submitAbortRef = useRef(null);

  useEffect(() => {
    const restoredSurvey = normalizeSurveyPayload(initial?.survey);
    if (restoredSurvey?.[SURVEY_API_FIELDS.imageId]) {
      setImageError(null);
      setSurvey((prev) => {
        if (prev?.[SURVEY_API_FIELDS.imageId] === restoredSurvey[SURVEY_API_FIELDS.imageId]) {
          return prev;
        }
        if (prev?.[SURVEY_API_FIELDS.imageId] && prev?.[SURVEY_API_FIELDS.url]) {
          return prev;
        }
        return restoredSurvey;
      });
    }
    if (Number.isFinite(initial?.surveyCompleted)) {
      setSurveyCompleted((prev) => (prev > 0 ? prev : initial.surveyCompleted));
    }
    if (initial?.surveyFeedbackReady === true) {
      setSurveyFeedbackReady(true);
    }
    if (initial?.lastSubmissionSucceeded === true) {
      setLastSubmissionSucceeded(true);
    }
    if (Array.isArray(initial?.shownImages) && initial.shownImages.length > 0) {
      setShownImages((prev) => (prev.length > 0 ? prev : initial.shownImages));
    }
  }, [
    initial?.lastSubmissionSucceeded,
    initial?.shownImages,
    initial?.survey,
    initial?.surveyCompleted,
    initial?.surveyFeedbackReady,
    publicId,
  ]);

  useEffect(() => {
    const hasUsableSurvey = Boolean(
      survey?.[SURVEY_API_FIELDS.imageId]
      && typeof survey?.[SURVEY_API_FIELDS.url] === "string"
      && survey[SURVEY_API_FIELDS.url].trim()
    );
    if (!hasUsableSurvey) return;
    if (imageError == null) return;
    setImageError(null);
  }, [imageError, survey]);

  // Additional hard-refresh guard: if we have a scoped publicId but in-memory
  // survey is empty, restore directly from storage (covers hydration races).
  useEffect(() => {
    if (!publicId) return;
    if (survey?.[SURVEY_API_FIELDS.imageId] && String(survey?.[SURVEY_API_FIELDS.url] || "").trim()) {
      return;
    }
    const storedSurvey = normalizeSurveyPayload(
      readCoreValue(runtimeConfig.storageKeys.survey, null, publicId)
    );
    if (!storedSurvey?.[SURVEY_API_FIELDS.imageId] || !String(storedSurvey?.[SURVEY_API_FIELDS.url] || "").trim()) {
      return;
    }
    setSurvey(storedSurvey);
    setImageError(null);
    setShownImages((prev) => (
      prev.includes(storedSurvey[SURVEY_API_FIELDS.imageId])
        ? prev
        : [...prev, storedSurvey[SURVEY_API_FIELDS.imageId]]
    ));
  }, [publicId, survey]);

  const fetchImage = useCallback(async ({ clearCurrent = false, throwOnError = false } = {}) => {
    const existingSurvey = survey;
    const existingHasUsableSurvey = Boolean(
      existingSurvey?.[SURVEY_API_FIELDS.imageId]
      && typeof existingSurvey?.[SURVEY_API_FIELDS.url] === "string"
      && existingSurvey[SURVEY_API_FIELDS.url].trim()
    );
    // Keep refresh/session-resumed survey stable: do not request a new image
    // unless caller explicitly asks to clear current survey.
    if (!clearCurrent && existingHasUsableSurvey) {
      setImageError(null);
      return existingSurvey;
    }
    if (!clearCurrent) {
      // Hard refresh guard: if in-memory survey is empty due hydration timing,
      // restore from storage before calling backend for a new image.
      const storedSurvey = normalizeSurveyPayload(
        readCoreValue(runtimeConfig.storageKeys.survey, null, publicId)
      );
      if (storedSurvey?.[SURVEY_API_FIELDS.imageId] && String(storedSurvey?.[SURVEY_API_FIELDS.url] || "").trim()) {
        setSurvey((prev) => {
          if (prev?.[SURVEY_API_FIELDS.imageId] && String(prev?.[SURVEY_API_FIELDS.url] || "").trim()) {
            return prev;
          }
          return storedSurvey;
        });
        // Important: storage restore on refresh should always clear transient
        // feed-load errors from earlier fetch attempts.
        setImageError(null);
        setShownImages((prev) => (
          prev.includes(storedSurvey[SURVEY_API_FIELDS.imageId])
            ? prev
            : [...prev, storedSurvey[SURVEY_API_FIELDS.imageId]]
        ));
        return storedSurvey;
      }
    }
    if (clearCurrent && prefetchedSurveyRef.current) {
      const prefetched = prefetchedSurveyRef.current;
      prefetchedSurveyRef.current = null;
      setShownImages((prev) => (
        prev.includes(prefetched[SURVEY_API_FIELDS.imageId])
          ? prev
          : [...prev, prefetched[SURVEY_API_FIELDS.imageId]]
      ));
      setSurvey(prefetched);
      setImageError(null);
      setSurveyFeedbackReady(false);
      setLastSubmissionSucceeded(false);
      return prefetched;
    }

    if (inFlightRef.current) {
      return null;
    }
    if (imageAbortRef.current) {
      imageAbortRef.current.abort();
    }
    const controller = new AbortController();
    imageAbortRef.current = controller;
    inFlightRef.current = true;
    setIsFetchingImage(true);
    setSurveyFeedbackReady(false);
    setLastSubmissionSucceeded(false);
    setImageError(null);
    if (clearCurrent) {
      setSurvey(null);
    }

    const effectivePublicId = requirePublicId(publicId, () => {
      // Refresh hydration can briefly lag behind the survey route boot.
      // Do not convert that transient state into a fatal image error.
    });
    if (!effectivePublicId) {
      setIsFetchingImage(false);
      inFlightRef.current = false;
      if (imageAbortRef.current === controller) {
        imageAbortRef.current = null;
      }
      return null;
    }

    try {
      const data = await endpoints.getRandomImage(shownImages, effectivePublicId, { signal: controller.signal });
      const normalizedData = normalizeSurveyPayload(data);
      if (!normalizedData?.[SURVEY_API_FIELDS.imageId]) {
        throw new Error(getErrorMessage("SYS_002_0016"));
      }
      setShownImages((prev) => [...prev, normalizedData[SURVEY_API_FIELDS.imageId]]);
      setSurvey(normalizedData);
      return normalizedData;
    } catch (error) {
      if (error?.code === "REQ_ABORTED" || controller.signal.aborted) {
        return null;
      }
      // On refresh/storage races, keep already-restored survey stable instead
      // of blanking page due a transient fetch failure.
      if (!clearCurrent && existingHasUsableSurvey) {
        setImageError(null);
        setSurvey((prev) => (prev?.[SURVEY_API_FIELDS.imageId] ? prev : existingSurvey));
      } else {
        setImageError("image_unavailable");
        setSurvey(null);
      }
      if (throwOnError) {
        throw error;
      }
      return null;
    } finally {
      if (imageAbortRef.current === controller) {
        imageAbortRef.current = null;
      }
      inFlightRef.current = false;
      setIsFetchingImage(false);
    }
  }, [publicId, shownImages, survey]);

  const prefetchNextImage = useCallback(async () => {
    if (!publicId) return null;
    if (inFlightRef.current) return null;
    if (prefetchedSurveyRef.current?.[SURVEY_API_FIELDS.imageId]) return prefetchedSurveyRef.current;
    if (prefetchAbortRef.current) {
      prefetchAbortRef.current.abort();
    }
    const controller = new AbortController();
    prefetchAbortRef.current = controller;
    try {
      const excluded = [
        ...shownImages,
        survey?.[SURVEY_API_FIELDS.imageId],
      ].filter(Boolean);
      const data = await endpoints.getRandomImage(excluded, publicId, { signal: controller.signal });
      const normalizedData = normalizeSurveyPayload(data);
      if (!normalizedData?.[SURVEY_API_FIELDS.imageId] || !normalizedData?.[SURVEY_API_FIELDS.url]) return null;
      prefetchedSurveyRef.current = normalizedData;
      try {
        if (typeof window !== "undefined") {
          const img = new Image();
          img.src = normalizedData[SURVEY_API_FIELDS.url];
        }
      } catch {
        // Ignore browser preloading failures.
      }
      return normalizedData;
    } catch {
      return null;
    } finally {
      if (prefetchAbortRef.current === controller) {
        prefetchAbortRef.current = null;
      }
    }
  }, [publicId, shownImages, survey]);

  const handleSubmit = useCallback(async (formData) => {
    const engagementData = formData.engagementData || {};
    const effectivePublicId = requirePublicId(publicId, () => {
      addToast(getErrorMessage("NF_001_0001"), "warning");
    });
    if (!effectivePublicId) throw new Error(getErrorMessage("NF_001_0001"));
    if (!publicId) {
      const errorMessage = getErrorMessage("NF_001_0001");
      addToast(errorMessage, TOAST_VARIANTS.warning);
      throw new Error(errorMessage);
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
        [SURVEY_API_FIELDS.sessionId]: sessionId || undefined,
        [SURVEY_API_FIELDS.imageId]: survey[SURVEY_API_FIELDS.imageId],
        description: formData.description,
        rating: formData.rating,
        feedback: formData.comments,
        [SURVEY_API_FIELDS.timeSpentSeconds]: formData.timeSpentSeconds,
        [SURVEY_API_FIELDS.isSurvey]: survey?.[SURVEY_API_FIELDS.isSurvey] === true,
        [SURVEY_API_FIELDS.isAttentionCheck]: survey?.[SURVEY_API_FIELDS.isAttentionCheck] === true,
        [SURVEY_API_FIELDS.surveyIndex]: surveyCompleted + 1,
        [SURVEY_API_FIELDS.tabSwitchCount]: engagementData.tabSwitchCount || 0,
        [SURVEY_API_FIELDS.pageCloseAttempts]: engagementData.pageCloseAttempts || 0,
        [SURVEY_API_FIELDS.networkDisconnects]: engagementData.networkDisconnects || 0,
        [SURVEY_API_FIELDS.surveyTimeSpentMs]: telemetry?.survey_time_spent_ms || 0,
        [SURVEY_API_FIELDS.surveyPageViews]: telemetry?.survey_page_views || 0,
        [SURVEY_API_FIELDS.surveyTabSwitches]: telemetry?.survey_tab_switches || 0,
        [SURVEY_API_FIELDS.surveyPageCloseAttempts]: telemetry?.survey_page_close_attempts || 0,
        [SURVEY_API_FIELDS.surveyNetworkDisconnects]: telemetry?.survey_network_disconnects || 0,
        [SURVEY_API_FIELDS.surveyMaxScrollDepthPct]: telemetry?.survey_max_scroll_depth_pct || 0,
        [SURVEY_API_FIELDS.surveyClicks]: telemetry?.survey_clicks || 0,
        [SURVEY_API_FIELDS.surveyKeypresses]: telemetry?.survey_keypresses || 0,
        [SURVEY_API_FIELDS.confidenceScore]: formData.confidenceScore,
        [SURVEY_API_FIELDS.difficultySelfReport]: formData.difficultySelfReport,
        [SURVEY_API_FIELDS.timeBeforeTypingMs]: formData.timeBeforeTypingMs || 0,
        [SURVEY_API_FIELDS.editCount]: formData.editCount || 0,
        [SURVEY_API_FIELDS.backspaceCount]: formData.backspaceCount || 0,
        [SURVEY_API_FIELDS.firstViewDurationMs]: formData.firstViewDurationMs || 0,
        [SURVEY_API_FIELDS.writingDurationMs]: formData.writingDurationMs || 0,
        [SURVEY_API_FIELDS.avgKeystrokeIntervalMs]: formData.avgKeystrokeIntervalMs ?? null,
        [SURVEY_API_FIELDS.keystrokeVariance]: formData.keystrokeVariance ?? null,
        [SURVEY_API_FIELDS.pauseCount]: formData.pauseCount || 0,
        [SURVEY_API_FIELDS.avgPauseDurationMs]: formData.avgPauseDurationMs ?? null,
      }, { signal: controller.signal });

      addToast(uiText("survey.saved"), TOAST_VARIANTS.success);

      setShowConfetti(true);
      scheduleTimeout(() => setShowConfetti(false), runtimeConfig.confettiDurationMs);

      const nextCompleted = surveyCompleted + 1;
      setSurveyCompleted(nextCompleted);
      setLastSubmissionSucceeded(true);
      setSurveyFeedbackReady(true);

      // OTP state is only needed for gating email verification; once the user is successfully submitting surveys,
      // clear it to avoid stale "OTP in progress" state on future refreshes.
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
      const errorMessage = getDisplayErrorMessage(error, "SYS_002_0006");
      const wrappedError = new Error(errorMessage);
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
    if (imageAbortRef.current) {
      imageAbortRef.current.abort();
      imageAbortRef.current = null;
    }
    if (prefetchAbortRef.current) {
      prefetchAbortRef.current.abort();
      prefetchAbortRef.current = null;
    }
    if (submitAbortRef.current) {
      submitAbortRef.current.abort();
      submitAbortRef.current = null;
    }
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
