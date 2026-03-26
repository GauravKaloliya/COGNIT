import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getErrorMessage } from "../utils/errorRegistry.js";
import { getDisplayErrorMessage } from "../utils/appError.js";
import { runtimeConfig } from "../config/runtime";
import { clearPendingFlag, getPendingFlag, setPendingFlag } from "../utils/storage";
import { uiText } from "../utils/uiText";
import { useNavigationBlocker } from "./useNavigationBlocker";
import { useOnlineStatus } from "./useOnlineStatus";
import { useSurveyDraftPersistence } from "./useSurveyDraftPersistence";
import { useSurveyEngagement } from "./useSurveyEngagement";
import {
  buildSurveyImageState,
  countAlphaNumericChars,
  countAlphaNumericWords,
  getSubmitTooltip,
} from "../utils/surveyPageHelpers";
import { clearScheduledInterval, clearScheduledTimeout, scheduleInterval, scheduleTimeout } from "../utils/timing";
import { preloadTurnstileScript, prefetchTurnstileToken } from "../utils/turnstile";
import { REQUEST_CODES } from "../constants/request";

export { sanitizeAlphaNumericSpace } from "../utils/surveyPageHelpers";

const MIN_WORDS = runtimeConfig.minWords;
const MIN_DESCRIPTION_LENGTH = runtimeConfig.minDescriptionLength;
const MAX_DESCRIPTION_LENGTH = runtimeConfig.maxDescriptionLength;
const MIN_FEEDBACK_LENGTH = runtimeConfig.minFeedbackLength;
const MAX_FEEDBACK_LENGTH = runtimeConfig.maxFeedbackLength;
const MIN_RATING = runtimeConfig.minRating;
const MAX_RATING = runtimeConfig.maxRating;
const UI_TOTAL_STEPS = runtimeConfig.surveyUiTotalSteps;
const COPY_PASTE_DISABLED = runtimeConfig.disableCopyPaste;
const SURVEY_PENDING_SUBMIT_KEY = runtimeConfig.storageKeys.surveyPendingSubmit;
const PAUSE_THRESHOLD_SECONDS = 1.5;
const EMPTY_TYPING_DYNAMICS = {
  firstInputAtSeconds: null,
  lastInputAtSeconds: null,
  editCount: 0,
  backspaceCount: 0,
  keystrokeCount: 0,
  keystrokeIntervalSumSeconds: 0,
  keystrokeIntervalSumSquares: 0,
  pauseCount: 0,
  pauseDurationSumSeconds: 0,
};

function getSurveyImageId(survey) {
  return String(survey?.image_id || survey?.imageId || "").trim();
}

export function useSurveyPage({
  survey,
  publicId,
  surveyCompleted = 0,
  onSubmit,
  onAccountFlagged = null,
  fetchError = null,
  onRetry = null,
  onWarmNextSurvey = null,
  isFetchingImage = false,
}) {
  const isOnline = useOnlineStatus();
  const [description, setDescription] = useState("");
  const [difficultyRating, setDifficultyRating] = useState(0);
  const [confidenceScore, setConfidenceScore] = useState(0);
  const [comments, setComments] = useState("");
  const [isZoomed, setIsZoomed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [showValidationErrors, setShowValidationErrors] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [retryDisabled, setRetryDisabled] = useState(false);
  const [retryCountdown, setRetryCountdown] = useState(0);
  const [submitLocked, setSubmitLocked] = useState(false);
  const [optimisticMessage, setOptimisticMessage] = useState("");
  const [formDisabled, setFormDisabled] = useState(false);
  const [typingDynamics, setTypingDynamics] = useState(EMPTY_TYPING_DYNAMICS);

  const imageElementRef = useRef(null);
  const previousSurveyImageIdRef = useRef("");
  const submitUnlockTimeoutRef = useRef(null);
  const imageLoadTimeoutRef = useRef(null);
  const accountFlaggedTimeoutRef = useRef(null);
  const prefetchTriggeredRef = useRef(false);
  const turnstilePrefetchTriggeredRef = useRef(false);
  const lastSubmitErrorWasValidationRef = useRef(false);

  const {
    engagementData,
    setEngagementData,
    elapsed,
    setElapsed,
    setTimerActive,
    descriptionRef,
    commentsRef,
    surveyStartTime,
    preventCopyPaste,
    preventClipboardShortcuts,
    resetEngagement,
  } = useSurveyEngagement({ copyPasteDisabled: COPY_PASTE_DISABLED });

  const surveyImageId = getSurveyImageId(survey);
  const { imageSrc, hasUsableSurveyImage } = useMemo(() => buildSurveyImageState(survey), [survey]);

  const wordCount = useMemo(() => countAlphaNumericWords(description), [description]);
  const charCount = useMemo(() => countAlphaNumericChars(description), [description]);
  const commentsCharCount = useMemo(() => countAlphaNumericChars(comments), [comments]);
  const imageReady = imageLoaded && !imageError;
  const canSubmit = wordCount >= MIN_WORDS
    && charCount >= MIN_DESCRIPTION_LENGTH
    && charCount <= MAX_DESCRIPTION_LENGTH
    && commentsCharCount >= MIN_FEEDBACK_LENGTH
    && commentsCharCount <= MAX_FEEDBACK_LENGTH
    && difficultyRating > 0
    && confidenceScore > 0
    && imageReady
    && !submitting;
  const inputsDisabled = formDisabled || submitting;
  const minimumMet = wordCount >= MIN_WORDS
    && commentsCharCount >= MIN_FEEDBACK_LENGTH
    && difficultyRating > 0
    && confidenceScore > 0;
  const currentStep = Math.max(1, surveyCompleted + 1);

  const resetFormState = useCallback(() => {
    setDescription("");
    setDifficultyRating(0);
    setConfidenceScore(0);
    setComments("");
    setImageLoaded(false);
    setImageError(false);
    setIsZoomed(false);
    setSubmitError("");
    setShowValidationErrors(false);
    setSubmitLocked(false);
    setOptimisticMessage("");
    setFormDisabled(false);
    setTypingDynamics(EMPTY_TYPING_DYNAMICS);
    resetEngagement();
    prefetchTriggeredRef.current = false;
    turnstilePrefetchTriggeredRef.current = false;
    lastSubmitErrorWasValidationRef.current = false;
  }, [resetEngagement]);

  const unlockSubmit = useCallback((delayMs = runtimeConfig.submitUnlockDelayMs) => {
    if (submitUnlockTimeoutRef.current) {
      clearScheduledTimeout(submitUnlockTimeoutRef.current);
    }
    submitUnlockTimeoutRef.current = scheduleTimeout(() => {
      setSubmitLocked(false);
      submitUnlockTimeoutRef.current = null;
    }, delayMs);
  }, []);

  const updateTypingMetrics = useCallback((previousValue, nextValue) => {
    if (previousValue === nextValue) return;
    const now = Date.now() / runtimeConfig.msPerSecond;
    const previousChars = countAlphaNumericChars(previousValue);
    const nextChars = countAlphaNumericChars(nextValue);
    setTypingDynamics((metrics) => ({
      firstInputAtSeconds: metrics.firstInputAtSeconds ?? (nextChars > 0 ? now : null),
      lastInputAtSeconds: now,
      editCount: metrics.editCount + 1,
      backspaceCount: metrics.backspaceCount + Math.max(0, previousChars - nextChars),
      keystrokeCount: metrics.keystrokeCount + (metrics.lastInputAtSeconds ? 1 : 0),
      keystrokeIntervalSumSeconds: metrics.keystrokeIntervalSumSeconds + (metrics.lastInputAtSeconds ? Math.max(0, now - metrics.lastInputAtSeconds) : 0),
      keystrokeIntervalSumSquares: metrics.keystrokeIntervalSumSquares + (metrics.lastInputAtSeconds ? ((Math.max(0, now - metrics.lastInputAtSeconds)) ** 2) : 0),
      pauseCount: metrics.pauseCount + (metrics.lastInputAtSeconds && (now - metrics.lastInputAtSeconds) >= PAUSE_THRESHOLD_SECONDS ? 1 : 0),
      pauseDurationSumSeconds: metrics.pauseDurationSumSeconds + (metrics.lastInputAtSeconds && (now - metrics.lastInputAtSeconds) >= PAUSE_THRESHOLD_SECONDS ? (now - metrics.lastInputAtSeconds) : 0),
    }));
  }, []);

  const updateDescription = useCallback((value) => {
    setDescription((prev) => {
      updateTypingMetrics(prev, value);
      return value;
    });
  }, [updateTypingMetrics]);

  const updateComments = useCallback((value) => {
    setComments((prev) => {
      updateTypingMetrics(prev, value);
      return value;
    });
  }, [updateTypingMetrics]);

  const restoreDraft = useCallback((saved) => {
    setDescription(typeof saved.description === "string" ? saved.description : "");
    setDifficultyRating(
      Number.isInteger(saved.difficultyRating) && saved.difficultyRating >= MIN_RATING && saved.difficultyRating <= MAX_RATING
        ? saved.difficultyRating
        : 0
    );
    setConfidenceScore(
      Number.isInteger(saved.confidenceScore) && saved.confidenceScore >= MIN_RATING && saved.confidenceScore <= MAX_RATING
        ? saved.confidenceScore
        : 0
    );
    setComments(typeof saved.comments === "string" ? saved.comments : "");
    setElapsed(Number.isFinite(saved.elapsed) ? Math.max(0, saved.elapsed) : 0);
    setEngagementData({
      tabSwitchCount: Number.isFinite(saved.engagementData?.tabSwitchCount) ? Math.max(0, saved.engagementData.tabSwitchCount) : 0,
      pageCloseAttempts: Number.isFinite(saved.engagementData?.pageCloseAttempts) ? Math.max(0, saved.engagementData.pageCloseAttempts) : 0,
      networkDisconnects: Number.isFinite(saved.engagementData?.networkDisconnects) ? Math.max(0, saved.engagementData.networkDisconnects) : 0,
    });
    setTypingDynamics({
      firstInputAtSeconds: Number.isFinite(saved.typingDynamics?.firstInputAtSeconds)
        ? saved.typingDynamics.firstInputAtSeconds
        : (Number.isFinite(saved.typingDynamics?.firstInputAtMs) ? saved.typingDynamics.firstInputAtMs / runtimeConfig.msPerSecond : null),
      lastInputAtSeconds: Number.isFinite(saved.typingDynamics?.lastInputAtSeconds)
        ? saved.typingDynamics.lastInputAtSeconds
        : (Number.isFinite(saved.typingDynamics?.lastInputAtMs) ? saved.typingDynamics.lastInputAtMs / runtimeConfig.msPerSecond : null),
      editCount: Number.isFinite(saved.typingDynamics?.editCount) ? Math.max(0, saved.typingDynamics.editCount) : 0,
      backspaceCount: Number.isFinite(saved.typingDynamics?.backspaceCount) ? Math.max(0, saved.typingDynamics.backspaceCount) : 0,
      keystrokeCount: Number.isFinite(saved.typingDynamics?.keystrokeCount) ? Math.max(0, saved.typingDynamics.keystrokeCount) : 0,
      keystrokeIntervalSumSeconds: Number.isFinite(saved.typingDynamics?.keystrokeIntervalSumSeconds)
        ? Math.max(0, saved.typingDynamics.keystrokeIntervalSumSeconds)
        : (Number.isFinite(saved.typingDynamics?.keystrokeIntervalSumMs) ? Math.max(0, saved.typingDynamics.keystrokeIntervalSumMs / runtimeConfig.msPerSecond) : 0),
      keystrokeIntervalSumSquares: Number.isFinite(saved.typingDynamics?.keystrokeIntervalSumSquares)
        ? Math.max(0, saved.typingDynamics.keystrokeIntervalSumSquares)
        : (Number.isFinite(saved.typingDynamics?.keystrokeIntervalSumSquaresMs)
          ? Math.max(0, saved.typingDynamics.keystrokeIntervalSumSquaresMs / (runtimeConfig.msPerSecond ** 2))
          : 0),
      pauseCount: Number.isFinite(saved.typingDynamics?.pauseCount) ? Math.max(0, saved.typingDynamics.pauseCount) : 0,
      pauseDurationSumSeconds: Number.isFinite(saved.typingDynamics?.pauseDurationSumSeconds)
        ? Math.max(0, saved.typingDynamics.pauseDurationSumSeconds)
        : (Number.isFinite(saved.typingDynamics?.pauseDurationSumMs) ? Math.max(0, saved.typingDynamics.pauseDurationSumMs / runtimeConfig.msPerSecond) : 0),
    });
    if (Number.isFinite(saved.startedAtSeconds)) {
      surveyStartTime.current = saved.startedAtSeconds * runtimeConfig.msPerSecond;
    } else if (Number.isFinite(saved.startedAt)) {
      surveyStartTime.current = saved.startedAt;
    } else if (Number.isFinite(saved.elapsed)) {
      surveyStartTime.current = Date.now() - Math.max(0, saved.elapsed) * runtimeConfig.msPerSecond;
    }
  }, [setElapsed, setEngagementData, surveyStartTime]);

  const {
    saveError,
    clearDrafts,
  } = useSurveyDraftPersistence({
    publicId,
    surveyImageId,
    isOnline,
    draftState: {
      imageId: surveyImageId,
      description,
      difficultyRating,
      confidenceScore,
      comments,
      elapsed,
      startedAtSeconds: surveyStartTime.current / runtimeConfig.msPerSecond,
      engagementData,
      typingDynamics,
    },
    onRestore: restoreDraft,
  });

  const getSubmitTooltipText = useCallback(() => getSubmitTooltip({
    imageReady,
    submitting,
    submitLocked,
    wordCount,
    minWords: MIN_WORDS,
    descriptionCharCount: charCount,
    minDescriptionLength: MIN_DESCRIPTION_LENGTH,
    maxDescriptionLength: MAX_DESCRIPTION_LENGTH,
    difficultyRating,
    confidenceScore,
    comments,
    minFeedbackLength: MIN_FEEDBACK_LENGTH,
    maxFeedbackLength: MAX_FEEDBACK_LENGTH,
    getErrorMessage,
    uiText,
  }), [
    charCount,
    comments,
    confidenceScore,
    difficultyRating,
    imageReady,
    submitLocked,
    submitting,
    wordCount,
  ]);

  const setValidationError = useCallback(() => {
    lastSubmitErrorWasValidationRef.current = true;
    setSubmitError(getSubmitTooltipText());
  }, [getSubmitTooltipText]);

  const handleRetryImage = useCallback(() => {
    if (formDisabled || retryDisabled || isFetchingImage || typeof onRetry !== "function") return;
    setRetryDisabled(true);
    setRetryCountdown(runtimeConfig.serviceRetrySeconds);
    setImageError(false);
    setImageLoaded(false);
    setTimerActive(false);
    onRetry({ clearCurrent: false });
  }, [formDisabled, isFetchingImage, onRetry, retryDisabled, setTimerActive]);

  const handleImageLoad = useCallback(() => {
    if (imageLoadTimeoutRef.current) {
      clearScheduledTimeout(imageLoadTimeoutRef.current);
      imageLoadTimeoutRef.current = null;
    }
    setImageLoaded(true);
    setImageError(false);
    setTimerActive(true);
  }, [setTimerActive]);

  const handleImageError = useCallback(() => {
    if (imageLoadTimeoutRef.current) {
      clearScheduledTimeout(imageLoadTimeoutRef.current);
      imageLoadTimeoutRef.current = null;
    }
    setImageError(true);
    setImageLoaded(false);
    setTimerActive(false);
  }, [setTimerActive]);

  const touchField = useCallback(() => {}, []);

  useEffect(() => {
    const previousSurveyImageId = previousSurveyImageIdRef.current;
    previousSurveyImageIdRef.current = surveyImageId;
    if (!surveyImageId) return;
    if (!previousSurveyImageId) return;
    if (previousSurveyImageId === surveyImageId) return;
    resetFormState();
  }, [resetFormState, surveyImageId]);

  useEffect(() => () => {
    if (submitUnlockTimeoutRef.current) {
      clearScheduledTimeout(submitUnlockTimeoutRef.current);
    }
    if (imageLoadTimeoutRef.current) {
      clearScheduledTimeout(imageLoadTimeoutRef.current);
    }
    if (accountFlaggedTimeoutRef.current) {
      clearScheduledTimeout(accountFlaggedTimeoutRef.current);
    }
  }, []);

  useEffect(() => {
    if (!retryDisabled || runtimeConfig.serviceRetrySeconds <= 0) {
      setRetryCountdown(0);
      return undefined;
    }
    const intervalId = scheduleInterval(() => {
      setRetryCountdown((prev) => Math.max(0, prev - 1));
    }, runtimeConfig.msPerSecond);
    return () => clearScheduledInterval(intervalId);
  }, [retryDisabled]);

  useEffect(() => {
    if (retryDisabled && retryCountdown === 0) {
      setRetryDisabled(false);
    }
  }, [retryCountdown, retryDisabled]);

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
  }, [fetchError, imageError, imageLoaded, imageSrc, isFetchingImage, setTimerActive, surveyImageId]);

  useEffect(() => {
    if (!imageSrc || !surveyImageId || imageLoaded || imageError) return;
    const imageEl = imageElementRef.current;
    if (!imageEl || !imageEl.complete) return;
    if (Number(imageEl.naturalWidth || 0) > 0) {
      handleImageLoad();
      return;
    }
    handleImageError();
  }, [handleImageError, handleImageLoad, imageError, imageLoaded, imageSrc, surveyImageId]);

  useEffect(() => {
    if (!isOnline || submitting || typeof onWarmNextSurvey !== "function" || !surveyImageId || prefetchTriggeredRef.current) {
      return;
    }
    if (description.trim().length < 32 && comments.trim().length < 16 && !minimumMet) return;
    prefetchTriggeredRef.current = true;
    void onWarmNextSurvey();
  }, [comments, description, isOnline, minimumMet, onWarmNextSurvey, submitting, surveyImageId]);

  useEffect(() => {
    if (!isOnline) return;
    preloadTurnstileScript().catch(() => {
      // Non-blocking warmup only.
    });
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
  }, [comments, confidenceScore, description, difficultyRating, isOnline, submitting]);

  useEffect(() => {
    if (!lastSubmitErrorWasValidationRef.current) return;
    if (!showValidationErrors) {
      setSubmitError("");
      lastSubmitErrorWasValidationRef.current = false;
      return;
    }
    if (canSubmit) {
      setSubmitError("");
      lastSubmitErrorWasValidationRef.current = false;
      return;
    }
    setSubmitError(getSubmitTooltipText());
  }, [canSubmit, getSubmitTooltipText, showValidationErrors]);

  const handleSubmit = useCallback(async () => {
    if (submitting || submitLocked) return;

    if (!isOnline) {
      setSubmitError(uiText("survey.offlineSubmit"));
      setPendingFlag(SURVEY_PENDING_SUBMIT_KEY);
      return;
    }

    setSubmitLocked(true);
    setShowValidationErrors(true);

    if (!canSubmit) {
      setValidationError();
      unlockSubmit(runtimeConfig.submitUnlockInvalidDelayMs);
      return;
    }

    if (!surveyImageId) {
      setSubmitError(getErrorMessage("UI_001_0002"));
      unlockSubmit(runtimeConfig.submitUnlockInvalidDelayMs);
      return;
    }

    setSubmitting(true);
    setTimerActive(false);
    setSubmitError("");
    startTransition(() => {
      setOptimisticMessage(uiText("common.submitting"));
    });

    const submitAtSeconds = Date.now() / runtimeConfig.msPerSecond;
    const hasWrittenContent = charCount > 0 || commentsCharCount > 0;
    const surveyStartSeconds = surveyStartTime.current / runtimeConfig.msPerSecond;
    const firstInputAtSeconds = Number(typingDynamics.firstInputAtSeconds || 0) || (hasWrittenContent ? surveyStartSeconds : 0);
    const timeBeforeTypingSeconds = firstInputAtSeconds > 0 ? Math.max(0, firstInputAtSeconds - surveyStartSeconds) : 0;
    const writingDurationSeconds = firstInputAtSeconds > 0 ? Math.max(0, submitAtSeconds - firstInputAtSeconds) : 0;
    const effectiveEditCount = hasWrittenContent ? Math.max(typingDynamics.editCount, 1) : 0;
    const avgKeystrokeIntervalSeconds = typingDynamics.keystrokeCount > 0
      ? typingDynamics.keystrokeIntervalSumSeconds / typingDynamics.keystrokeCount
      : 0;
    const keystrokeVariance = typingDynamics.keystrokeCount > 0 && avgKeystrokeIntervalSeconds !== null
      ? Math.max(
        0,
        (typingDynamics.keystrokeIntervalSumSquares / typingDynamics.keystrokeCount)
          - (avgKeystrokeIntervalSeconds ** 2)
      )
      : 0;
    const avgPauseDurationSeconds = typingDynamics.pauseCount > 0
      ? typingDynamics.pauseDurationSumSeconds / typingDynamics.pauseCount
      : 0;
    const payload = {
      description,
      rating: difficultyRating,
      comments,
      timeSpentSeconds: Math.max(0, submitAtSeconds - surveyStartSeconds),
      engagementData,
      confidenceScore,
      difficultySelfReport: difficultyRating,
      timeBeforeTypingSeconds,
      editCount: effectiveEditCount,
      backspaceCount: typingDynamics.backspaceCount,
      firstViewDurationSeconds: timeBeforeTypingSeconds,
      writingDurationSeconds,
      avgKeystrokeIntervalSeconds,
      keystrokeVariance,
      pauseCount: typingDynamics.pauseCount,
      avgPauseDurationSeconds,
    };

    try {
      await onSubmit(payload);
      clearDrafts();
      setEngagementData({ tabSwitchCount: 0, pageCloseAttempts: 0, networkDisconnects: 0 });
      setTypingDynamics(EMPTY_TYPING_DYNAMICS);
      setDescription("");
      setDifficultyRating(0);
      setConfidenceScore(0);
      setComments("");
      startTransition(() => {
        setOptimisticMessage("");
      });
    } catch (error) {
      if (error?.code === REQUEST_CODES.accountFlagged) {
        setFormDisabled(true);
        setSubmitLocked(true);
        setTimerActive(false);
        setSubmitError(getDisplayErrorMessage(error, "SYS_002_0006"));
        startTransition(() => {
          setOptimisticMessage("");
        });
        if (accountFlaggedTimeoutRef.current) {
          clearScheduledTimeout(accountFlaggedTimeoutRef.current);
        }
        accountFlaggedTimeoutRef.current = scheduleTimeout(() => {
          onAccountFlagged?.(publicId);
          accountFlaggedTimeoutRef.current = null;
        }, runtimeConfig.accountFlaggedRedirectDelayMs);
        return;
      }
      setSubmitError(getDisplayErrorMessage(error, "SYS_002_0006"));
      if (imageReady) {
        setTimerActive(true);
      }
      startTransition(() => {
        setOptimisticMessage("");
      });
    } finally {
      setSubmitting(false);
      if (!formDisabled) {
        unlockSubmit(runtimeConfig.submitUnlockCompleteDelayMs);
      }
    }
  }, [
    canSubmit,
    charCount,
    clearDrafts,
    comments,
    commentsCharCount,
    confidenceScore,
    description,
    difficultyRating,
    engagementData,
    formDisabled,
    imageReady,
    isOnline,
    onAccountFlagged,
    onSubmit,
    publicId,
    setEngagementData,
    submitLocked,
    setTimerActive,
    submitting,
    surveyImageId,
    surveyStartTime,
    typingDynamics,
    unlockSubmit,
    setValidationError,
  ]);

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
        setDifficultyRating((prev) => Math.min(MAX_RATING, Math.max(MIN_RATING, prev + 1)));
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
        event.preventDefault();
        setDifficultyRating((prev) => Math.max(MIN_RATING, prev > 0 ? prev - 1 : MIN_RATING));
      }
    };
    window.addEventListener("keydown", onRatingAndZoomKeys);
    return () => window.removeEventListener("keydown", onRatingAndZoomKeys);
  }, [imageReady, isZoomed]);

  useNavigationBlocker({
    enabled: submitting || submitLocked,
    message: uiText("survey.navigationBlocked"),
    onBlocked: (message) => setSubmitError(message),
  });

  const constants = useMemo(() => ({
    minWords: MIN_WORDS,
    minDescriptionLength: MIN_DESCRIPTION_LENGTH,
    maxDescriptionLength: MAX_DESCRIPTION_LENGTH,
    minFeedbackLength: MIN_FEEDBACK_LENGTH,
    maxFeedbackLength: MAX_FEEDBACK_LENGTH,
    minRating: MIN_RATING,
    maxRating: MAX_RATING,
    uiTotalSteps: UI_TOTAL_STEPS,
    copyPasteDisabled: COPY_PASTE_DISABLED,
  }), []);

  return {
    constants,
    description,
    setDescription: updateDescription,
    rating: difficultyRating,
    setRating: setDifficultyRating,
    difficultyRating,
    setDifficultyRating,
    confidenceScore,
    setConfidenceScore,
    comments,
    setComments: updateComments,
    isZoomed,
    setIsZoomed,
    submitting,
    submitError,
    showValidationErrors,
    elapsed,
    imageLoaded,
    imageError,
    retryExhausted: Boolean(imageError || (!hasUsableSurveyImage && fetchError)),
    imagePanelErrorMessage: imageError ? uiText("survey.imageRestoreFailed") : uiText("survey.feedLoadFailed"),
    imageReady,
    retryDisabled,
    retryCountdown,
    wordCount,
    charCount,
    commentsCharCount,
    canSubmit,
    currentStep,
    minimumMet,
    submitLocked,
    formDisabled,
    inputsDisabled,
    descriptionRef,
    commentsRef,
    imageElementRef,
    imageSrc,
    hasUsableSurveyImage,
    handleRetryImage,
    handleSubmit,
    handleImageLoad,
    handleImageError,
    getSubmitTooltip: getSubmitTooltipText,
    preventCopyPaste,
    preventClipboardShortcuts,
    saveError,
    optimisticMessage,
    touchField,
  };
}
