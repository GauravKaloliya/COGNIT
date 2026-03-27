import { useEffect } from "react";
import { runtimeConfig } from "../config/runtime";
import { clearPendingFlag, getPendingFlag, setPendingFlag } from "../utils/storage";
import { clearScheduledInterval, clearScheduledTimeout, scheduleInterval, scheduleTimeout } from "../utils/timing";
import { preloadTurnstileScript, prefetchTurnstileToken } from "../utils/turnstile";

const SURVEY_PENDING_SUBMIT_KEY = runtimeConfig.storageKeys.surveyPendingSubmit;

export function useSurveyPageEffects({
  surveyImageId,
  resetFormState,
  previousSurveyImageIdRef,
  submitUnlockTimeoutRef,
  imageLoadTimeoutRef,
  accountFlaggedTimeoutRef,
  retryDisabled,
  retryCountdown,
  setRetryDisabled,
  setRetryCountdown,
  publicId,
  flushDraft,
  buildCurrentDraftState,
  imageSrc,
  imageLoaded,
  imageError,
  fetchError,
  isFetchingImage,
  setImageError,
  setImageLoaded,
  setTimerActive,
  imageElementRef,
  handleImageLoad,
  handleImageError,
  isOnline,
  submitting,
  onWarmNextSurvey,
  minimumMet,
  description,
  comments,
  difficultyRating,
  confidenceScore,
  prefetchTriggeredRef,
  turnstilePrefetchTriggeredRef,
  lastSubmitErrorWasValidationRef,
  showValidationErrors,
  canSubmit,
  setSubmitError,
  getSubmitTooltipText,
  handleSubmit,
  submitLocked,
  isZoomed,
  setIsZoomed,
  setDifficultyRating,
  imageReady,
}) {
  useEffect(() => {
    const previousSurveyImageId = previousSurveyImageIdRef.current;
    if (!surveyImageId) return;
    previousSurveyImageIdRef.current = surveyImageId;
    if (!previousSurveyImageId || previousSurveyImageId === surveyImageId) return;
    resetFormState();
  }, [previousSurveyImageIdRef, resetFormState, surveyImageId]);

  useEffect(() => () => {
    if (submitUnlockTimeoutRef.current) clearScheduledTimeout(submitUnlockTimeoutRef.current);
    if (imageLoadTimeoutRef.current) clearScheduledTimeout(imageLoadTimeoutRef.current);
    if (accountFlaggedTimeoutRef.current) clearScheduledTimeout(accountFlaggedTimeoutRef.current);
  }, [accountFlaggedTimeoutRef, imageLoadTimeoutRef, submitUnlockTimeoutRef]);

  useEffect(() => {
    if (!retryDisabled || runtimeConfig.serviceRetrySeconds <= 0) {
      setRetryCountdown(0);
      return undefined;
    }
    const intervalId = scheduleInterval(() => {
      setRetryCountdown((prev) => Math.max(0, prev - 1));
    }, runtimeConfig.msPerSecond);
    return () => clearScheduledInterval(intervalId);
  }, [retryDisabled, setRetryCountdown]);

  useEffect(() => {
    if (retryDisabled && retryCountdown === 0) {
      setRetryDisabled(false);
    }
  }, [retryCountdown, retryDisabled, setRetryDisabled]);

  useEffect(() => {
    if (!publicId || !surveyImageId) return undefined;

    const flushLatestDraft = () => {
      flushDraft(buildCurrentDraftState());
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flushLatestDraft();
      }
    };

    window.addEventListener("beforeunload", flushLatestDraft);
    window.addEventListener("pagehide", flushLatestDraft);
    window.addEventListener("offline", flushLatestDraft);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.removeEventListener("beforeunload", flushLatestDraft);
      window.removeEventListener("pagehide", flushLatestDraft);
      window.removeEventListener("offline", flushLatestDraft);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [buildCurrentDraftState, flushDraft, publicId, surveyImageId]);

  useEffect(() => {
    if (imageLoadTimeoutRef.current) {
      clearScheduledTimeout(imageLoadTimeoutRef.current);
      imageLoadTimeoutRef.current = null;
    }
    if (!imageSrc || !surveyImageId || imageLoaded || imageError || fetchError || isFetchingImage) {
      return undefined;
    }
    imageLoadTimeoutRef.current = scheduleTimeout(() => {
      setImageError(true);
      setImageLoaded(false);
      setTimerActive(false);
    }, 10000);
    return () => {
      if (imageLoadTimeoutRef.current) {
        clearScheduledTimeout(imageLoadTimeoutRef.current);
        imageLoadTimeoutRef.current = null;
      }
    };
  }, [
    fetchError,
    imageError,
    imageLoadTimeoutRef,
    imageLoaded,
    imageSrc,
    isFetchingImage,
    setImageError,
    setImageLoaded,
    setTimerActive,
    surveyImageId,
  ]);

  useEffect(() => {
    if (!imageSrc || !surveyImageId || imageLoaded || imageError) return;
    const imageEl = imageElementRef.current;
    if (!imageEl || !imageEl.complete) return;
    if (Number(imageEl.naturalWidth || 0) > 0) {
      handleImageLoad();
      return;
    }
    handleImageError();
  }, [handleImageError, handleImageLoad, imageElementRef, imageError, imageLoaded, imageSrc, surveyImageId]);

  useEffect(() => {
    if (!isOnline || submitting || typeof onWarmNextSurvey !== "function" || !surveyImageId || prefetchTriggeredRef.current) {
      return;
    }
    if (description.trim().length < 32 && comments.trim().length < 16 && !minimumMet) return;
    prefetchTriggeredRef.current = true;
    void onWarmNextSurvey();
  }, [comments, description, isOnline, minimumMet, onWarmNextSurvey, prefetchTriggeredRef, submitting, surveyImageId]);

  useEffect(() => {
    if (!isOnline) return;
    preloadTurnstileScript().catch(() => {});
  }, [isOnline]);

  useEffect(() => {
    if (!isOnline || submitting || turnstilePrefetchTriggeredRef.current) return;
    if (
      description.trim().length < 24
      && comments.trim().length < 12
      && difficultyRating === 0
      && confidenceScore === 0
    ) {
      return;
    }
    turnstilePrefetchTriggeredRef.current = true;
    prefetchTurnstileToken("submission_submit").catch(() => {
      turnstilePrefetchTriggeredRef.current = false;
    });
  }, [
    comments,
    confidenceScore,
    description,
    difficultyRating,
    isOnline,
    submitting,
    turnstilePrefetchTriggeredRef,
  ]);

  useEffect(() => {
    if (!lastSubmitErrorWasValidationRef.current) return;
    if (!showValidationErrors || canSubmit) {
      setSubmitError("");
      lastSubmitErrorWasValidationRef.current = false;
      return;
    }
    setSubmitError(getSubmitTooltipText());
  }, [canSubmit, getSubmitTooltipText, lastSubmitErrorWasValidationRef, setSubmitError, showValidationErrors]);

  useEffect(() => {
    if (!isOnline || submitting || submitLocked || !canSubmit) return;
    if (!getPendingFlag(SURVEY_PENDING_SUBMIT_KEY)) return;
    clearPendingFlag(SURVEY_PENDING_SUBMIT_KEY);
    void handleSubmit();
  }, [canSubmit, handleSubmit, isOnline, submitLocked, submitting]);

  useEffect(() => {
    const onKeyboardSubmit = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        void handleSubmit();
      }
    };
    window.addEventListener("keydown", onKeyboardSubmit);
    return () => window.removeEventListener("keydown", onKeyboardSubmit);
  }, [handleSubmit]);

  useEffect(() => {
    const onRatingAndZoomKeys = (event) => {
      const activeTag = String(document.activeElement?.tagName || "").toLowerCase();
      if (event.key === "Escape" && isZoomed) {
        setIsZoomed(false);
        return;
      }
      if (!imageReady || activeTag === "textarea" || activeTag === "input") return;
      if (event.key === "ArrowRight" || event.key === "ArrowUp") {
        event.preventDefault();
        setDifficultyRating((prev) => Math.min(runtimeConfig.maxRating, Math.max(runtimeConfig.minRating, prev + 1)));
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
        event.preventDefault();
        setDifficultyRating((prev) => Math.max(runtimeConfig.minRating, prev > 0 ? prev - 1 : runtimeConfig.minRating));
      }
    };
    window.addEventListener("keydown", onRatingAndZoomKeys);
    return () => window.removeEventListener("keydown", onRatingAndZoomKeys);
  }, [imageReady, isZoomed, setDifficultyRating, setIsZoomed]);
}

export function queuePendingSurveySubmit() {
  setPendingFlag(SURVEY_PENDING_SUBMIT_KEY);
}
