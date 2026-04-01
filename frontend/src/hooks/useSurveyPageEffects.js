import { useEffect } from "react";
import { runtimeConfig } from "../config/runtime";
import { endpoints } from "../utils/api";
import { clearPendingFlag, getPendingFlag, setPendingFlag } from "../utils/storage";
import { clearScheduledInterval, clearScheduledTimeout, scheduleInterval, scheduleTimeout } from "../utils/timing";
import { preloadTurnstileScript, prefetchTurnstileToken } from "../utils/turnstile";

const SURVEY_PENDING_SUBMIT_KEY = runtimeConfig.storageKeys.surveyPendingSubmit;
const RESERVATION_HEARTBEAT_MS = 120 * runtimeConfig.msPerSecond;
const RESERVATION_ACTIVITY_WINDOW_MS = 5 * 60 * runtimeConfig.msPerSecond;

export function useSurveyPageEffects({
  surveyImageId,
  resetFormState,
  previousSurveyImageIdRef,
  submitUnlockTimeoutRef,
  imageLoadTimeoutRef,
  imageRecoveryTimeoutRef,
  accountFlaggedTimeoutRef,
  retryDisabled,
  retryCountdown,
  setRetryDisabled,
  setRetryCountdown,
  publicId,
  flushDraft,
  buildCurrentDraftState,
  imageSrc,
  imageReady,
  imageLoading,
  imageError,
  imageRecoveryTerminal,
  fetchError,
  isFetchingImage,
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
  confidenceRating,
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
  isFullscreen,
  setIsZoomed,
  setIsFullscreen,
  setDifficultyRating,
  reportSurveyImageFailure,
  beginImageRecovery,
  recoverSurveyImage,
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
    if (imageRecoveryTimeoutRef.current) clearScheduledTimeout(imageRecoveryTimeoutRef.current);
    if (accountFlaggedTimeoutRef.current) clearScheduledTimeout(accountFlaggedTimeoutRef.current);
  }, [accountFlaggedTimeoutRef, imageLoadTimeoutRef, imageRecoveryTimeoutRef, submitUnlockTimeoutRef]);

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
    if (!isOnline || imageRecoveryTerminal || typeof recoverSurveyImage !== "function" || isFetchingImage || retryDisabled) {
      return;
    }
    const shouldRecoverFailedImage = Boolean(imageError && surveyImageId);
    const shouldRecoverMissingImage = Boolean(fetchError && (!surveyImageId || !imageSrc));
    if (!shouldRecoverFailedImage && !shouldRecoverMissingImage) {
      return;
    }
    const timeoutId = scheduleTimeout(() => {
      recoverSurveyImage({ automatic: true });
    }, 250);
    return () => clearScheduledTimeout(timeoutId);
  }, [
    fetchError,
    imageError,
    imageRecoveryTerminal,
    imageSrc,
    isFetchingImage,
    isOnline,
    recoverSurveyImage,
    retryDisabled,
    surveyImageId,
  ]);

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
    if (!imageSrc || !surveyImageId || imageReady || imageError || fetchError || isFetchingImage || !imageLoading) {
      return undefined;
    }
    imageLoadTimeoutRef.current = scheduleTimeout(() => {
      beginImageRecovery("timeout", {
        timeoutMs: 10000,
        complete: Boolean(imageElementRef.current?.complete),
        naturalWidth: Number(imageElementRef.current?.naturalWidth || 0),
      });
    }, 10000);
    return () => {
      if (imageLoadTimeoutRef.current) {
        clearScheduledTimeout(imageLoadTimeoutRef.current);
        imageLoadTimeoutRef.current = null;
      }
    };
  }, [
    beginImageRecovery,
    fetchError,
    imageElementRef,
    imageError,
    imageLoadTimeoutRef,
    imageLoading,
    imageReady,
    imageSrc,
    isFetchingImage,
    surveyImageId,
  ]);

  useEffect(() => {
    if (!imageSrc || !surveyImageId || imageReady || imageError || !imageLoading) return;
    const imageEl = imageElementRef.current;
    if (!imageEl || !imageEl.complete) return;
    if (Number(imageEl.naturalWidth || 0) > 0) {
      handleImageLoad();
      return;
    }
    handleImageError({
      reasonHint: "complete_without_natural_width",
      complete: true,
      naturalWidth: Number(imageEl.naturalWidth || 0),
    });
  }, [handleImageError, handleImageLoad, imageElementRef, imageError, imageLoading, imageReady, imageSrc, surveyImageId]);

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
      && confidenceRating === 0
    ) {
      return;
    }
    turnstilePrefetchTriggeredRef.current = true;
    prefetchTurnstileToken("submission_submit").catch(() => {
      turnstilePrefetchTriggeredRef.current = false;
    });
  }, [
    comments,
    confidenceRating,
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
    if (!publicId || !surveyImageId || !imageReady || !isOnline || submitting) {
      return undefined;
    }

    let cancelled = false;
    let renewInFlight = false;
    let lastActivityAt = Date.now();

    const markActivity = () => {
      lastActivityAt = Date.now();
    };

    const maybeRenewReservation = async () => {
      if (cancelled || renewInFlight) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      if (Date.now() - lastActivityAt > RESERVATION_ACTIVITY_WINDOW_MS) return;

      renewInFlight = true;
      try {
        await endpoints.renewImageReservation(publicId, surveyImageId);
      } catch {
        // Best-effort heartbeat; the session recovery flow still handles misses.
      } finally {
        renewInFlight = false;
      }
    };

    const activityEvents = ["pointerdown", "keydown", "scroll", "focus", "input"];
    activityEvents.forEach((eventName) => {
      window.addEventListener(eventName, markActivity, { passive: true });
    });
    document.addEventListener("visibilitychange", markActivity);

    const intervalId = scheduleInterval(() => {
      void maybeRenewReservation();
    }, RESERVATION_HEARTBEAT_MS);

    return () => {
      cancelled = true;
      clearScheduledInterval(intervalId);
      activityEvents.forEach((eventName) => {
        window.removeEventListener(eventName, markActivity);
      });
      document.removeEventListener("visibilitychange", markActivity);
    };
  }, [imageReady, isOnline, publicId, submitting, surveyImageId]);

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
      if (event.key === "Escape" && isFullscreen) {
        setIsFullscreen(false);
        return;
      }
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
  }, [imageReady, isFullscreen, isZoomed, setDifficultyRating, setIsFullscreen, setIsZoomed]);

  useEffect(() => {
    if (!fetchError || !surveyImageId) return;
    reportSurveyImageFailure("fetch-failed", {
      fetchError,
      surfacedToUser: true,
    });
  }, [fetchError, reportSurveyImageFailure, surveyImageId]);
}

export function queuePendingSurveySubmit() {
  setPendingFlag(SURVEY_PENDING_SUBMIT_KEY);
}
