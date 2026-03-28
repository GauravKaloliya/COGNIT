import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getErrorMessage } from "../utils/errorRegistry.js";
import { getDisplayErrorMessage } from "../utils/appError.js";
import { runtimeConfig } from "../config/runtime";
import { uiText } from "../utils/uiText";
import { useNavigationBlocker } from "./useNavigationBlocker";
import { useOnlineStatus } from "./useOnlineStatus";
import { useSurveyDraftPersistence } from "./useSurveyDraftPersistence";
import { useSurveyEngagement } from "./useSurveyEngagement";
import { queuePendingSurveySubmit, useSurveyPageEffects } from "./useSurveyPageEffects";
import {
  buildSurveyImageState,
  countAlphaNumericChars,
  countSurveyDescriptionChars,
  countSurveyDescriptionWords,
  getSubmitTooltip,
  sanitizeSurveyDescription,
} from "../utils/surveyPageHelpers";
import { clearScheduledTimeout, scheduleTimeout } from "../utils/timing";
import { REQUEST_CODES } from "../constants/request";

export { sanitizeAlphaNumericSpace, sanitizeSurveyDescription } from "../utils/surveyPageHelpers";

const MIN_WORDS = runtimeConfig.minWords;
const MIN_DESCRIPTION_LENGTH = runtimeConfig.minDescriptionLength;
const MAX_DESCRIPTION_LENGTH = runtimeConfig.maxDescriptionLength;
const MIN_FEEDBACK_LENGTH = runtimeConfig.minFeedbackLength;
const MAX_FEEDBACK_LENGTH = runtimeConfig.maxFeedbackLength;
const MIN_RATING = runtimeConfig.minRating;
const MAX_RATING = runtimeConfig.maxRating;
const UI_TOTAL_STEPS = runtimeConfig.surveyUiTotalSteps;
const COPY_PASTE_DISABLED = runtimeConfig.disableCopyPaste;
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
  const [confidenceRating, setConfidenceRating] = useState(0);
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
  const descriptionValueRef = useRef("");
  const commentsValueRef = useRef("");
  const difficultyRatingRef = useRef(0);
  const confidenceRatingRef = useRef(0);
  const typingDynamicsRef = useRef(EMPTY_TYPING_DYNAMICS);

  const {
    engagementState,
    engagementRefs,
    engagementActions,
    clipboardHandlers,
  } = useSurveyEngagement({ copyPasteDisabled: COPY_PASTE_DISABLED });
  const {
    engagementData,
    elapsed,
    descriptionRef,
    commentsRef,
    surveyStartTime,
  } = engagementState;
  const { engagementDataRef, elapsedRef } = engagementRefs;
  const { setEngagementData, setElapsed, setTimerActive, resetEngagement } = engagementActions;
  const { preventCopyPaste, preventClipboardShortcuts } = clipboardHandlers;

  const surveyImageId = getSurveyImageId(survey);
  const { imageSrc, hasUsableSurveyImage } = useMemo(() => buildSurveyImageState(survey), [survey]);

  const wordCount = useMemo(() => countSurveyDescriptionWords(description), [description]);
  const charCount = useMemo(() => countSurveyDescriptionChars(description), [description]);
  const commentsCharCount = useMemo(() => countAlphaNumericChars(comments), [comments]);
  const imageReady = imageLoaded && !imageError;
  const canSubmit = wordCount >= MIN_WORDS
    && charCount >= MIN_DESCRIPTION_LENGTH
    && charCount <= MAX_DESCRIPTION_LENGTH
    && commentsCharCount >= MIN_FEEDBACK_LENGTH
    && commentsCharCount <= MAX_FEEDBACK_LENGTH
    && difficultyRating > 0
    && confidenceRating > 0
    && imageReady
    && !submitting;
  const inputsDisabled = formDisabled || submitting;
  const minimumMet = wordCount >= MIN_WORDS
    && commentsCharCount >= MIN_FEEDBACK_LENGTH
    && difficultyRating > 0
    && confidenceRating > 0;
  const currentStep = Math.max(1, surveyCompleted + 1);

  const resetFormState = useCallback(() => {
    setDescription("");
    setDifficultyRating(0);
    setConfidenceRating(0);
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

  const updateTypingMetrics = useCallback((previousValue, nextValue, countChars) => {
    if (previousValue === nextValue) return;
    const now = Date.now() / runtimeConfig.msPerSecond;
    const charCounter = typeof countChars === "function" ? countChars : countAlphaNumericChars;
    const previousChars = charCounter(previousValue);
    const nextChars = charCounter(nextValue);
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
      updateTypingMetrics(prev, value, countSurveyDescriptionChars);
      return value;
    });
  }, [updateTypingMetrics]);

  const updateComments = useCallback((value) => {
    setComments((prev) => {
      updateTypingMetrics(prev, value, countAlphaNumericChars);
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
    const restoredConfidenceRating = saved.confidenceRating;
    setConfidenceRating(
      Number.isInteger(restoredConfidenceRating) && restoredConfidenceRating >= MIN_RATING && restoredConfidenceRating <= MAX_RATING
        ? restoredConfidenceRating
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

  const surveySession = useMemo(() => ({
    imageId: surveyImageId,
    description,
    difficultyRating,
    confidenceRating,
    comments,
    elapsed,
    startedAtSeconds: surveyStartTime.current / runtimeConfig.msPerSecond,
    engagementData,
    typingDynamics,
  }), [
    comments,
    confidenceRating,
    description,
    difficultyRating,
    elapsed,
    engagementData,
    surveyImageId,
    surveyStartTime,
    typingDynamics,
  ]);

  const {
    saveError,
    clearDrafts,
    flushDraft,
  } = useSurveyDraftPersistence({
    publicId,
    surveyImageId,
    isOnline,
    surveySession,
    onRestore: restoreDraft,
  });

  useEffect(() => {
    descriptionValueRef.current = description;
    commentsValueRef.current = comments;
    difficultyRatingRef.current = difficultyRating;
    confidenceRatingRef.current = confidenceRating;
    typingDynamicsRef.current = typingDynamics;
  }, [comments, confidenceRating, description, difficultyRating, typingDynamics]);

  const buildCurrentDraftState = useCallback(() => ({
    imageId: surveyImageId,
    description: descriptionValueRef.current,
    difficultyRating: difficultyRatingRef.current,
    confidenceRating: confidenceRatingRef.current,
    comments: commentsValueRef.current,
    elapsed: elapsedRef.current,
    startedAtSeconds: surveyStartTime.current / runtimeConfig.msPerSecond,
    engagementData: engagementDataRef.current,
    typingDynamics: typingDynamicsRef.current,
  }), [elapsedRef, engagementDataRef, surveyImageId, surveyStartTime]);

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
    confidenceRating,
    comments,
    minFeedbackLength: MIN_FEEDBACK_LENGTH,
    maxFeedbackLength: MAX_FEEDBACK_LENGTH,
    getErrorMessage,
    uiText,
  }), [
    charCount,
    comments,
    confidenceRating,
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

  const handleSubmit = useCallback(async () => {
    if (submitting || submitLocked) return;

    if (!isOnline) {
      setSubmitError(uiText("survey.offlineSubmit"));
      queuePendingSurveySubmit();
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
      comments,
      timeSpentSeconds: Math.max(0, submitAtSeconds - surveyStartSeconds),
      engagementData,
      confidenceRating,
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
      resetEngagement();
      setTypingDynamics(EMPTY_TYPING_DYNAMICS);
      setDescription("");
      setDifficultyRating(0);
      setConfidenceRating(0);
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
    confidenceRating,
    description,
    difficultyRating,
    engagementData,
    formDisabled,
    imageReady,
    isOnline,
    onAccountFlagged,
    onSubmit,
    publicId,
    submitLocked,
    setTimerActive,
    submitting,
    surveyImageId,
    surveyStartTime,
    typingDynamics,
    unlockSubmit,
    setValidationError,
    resetEngagement,
  ]);

  useSurveyPageEffects({
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
    setIsZoomed,
    setDifficultyRating,
    imageReady,
  });

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
    formState: {
      description,
      difficultyRating,
      confidenceRating,
      comments,
      wordCount,
      charCount,
      commentsCharCount,
      canSubmit,
      currentStep,
      minimumMet,
      showValidationErrors,
      submitError,
      submitting,
      submitLocked,
      formDisabled,
      inputsDisabled,
      elapsed,
      saveError,
      optimisticMessage,
    },
    mediaState: {
      isZoomed,
      imageLoaded,
      imageError,
      imageReady,
      retryDisabled,
      retryCountdown,
      retryExhausted: Boolean(imageError || (!hasUsableSurveyImage && fetchError)),
      imagePanelErrorMessage: imageError ? uiText("survey.imageRestoreFailed") : uiText("survey.feedLoadFailed"),
      imageSrc,
      hasUsableSurveyImage,
      imageElementRef,
    },
    fieldRefs: {
      descriptionRef,
      commentsRef,
    },
    handlers: {
      setDescription: updateDescription,
      setDifficultyRating,
      setConfidenceRating,
      setComments: updateComments,
      setIsZoomed,
      handleRetryImage,
      handleSubmit,
      handleImageLoad,
      handleImageError,
      getSubmitTooltip: getSubmitTooltipText,
      preventCopyPaste,
      preventClipboardShortcuts,
      touchField,
    },
  };
}
