import { startTransition, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { getErrorMessage } from "../utils/errorRegistry.js";
import { getDisplayErrorMessage } from "../utils/appError.js";
import { runtimeConfig } from "../config/runtime";
import { clearPendingFlag, getPendingFlag, setPendingFlag } from "../utils/storage";
import { uiText } from "../utils/uiText";
import { useNavigationBlocker } from "./useNavigationBlocker";
import { useOnlineStatus } from "./useOnlineStatus";
import { useSurveyDraftPersistence } from "./useSurveyDraftPersistence";
import { useSurveyEngagement } from "./useSurveyEngagement";
import { buildSurveyImageState, countAlphaNumericChars, countAlphaNumericWords, getSubmitTooltip } from "../utils/surveyPageHelpers";
import { clearScheduledInterval, clearScheduledTimeout, scheduleInterval, scheduleTimeout } from "../utils/timing";
import { useStableSelector } from "./useStableSelector";
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
const SURVEY_FIELDS = {
  description: "description",
  difficulty: "difficulty",
  confidence: "confidence",
  comments: "comments",
};
const SURVEY_META_ACTIONS = {
  dirty: "dirty",
  touched: "touched",
  touchedBatch: "touched-batch",
};

function surveyFieldMetaReducer(state, action) {
  switch (action.type) {
    case SURVEY_META_ACTIONS.dirty: {
      if (state.dirty[action.field]) return state;
      return {
        ...state,
        dirty: { ...state.dirty, [action.field]: true },
      };
    }
    case SURVEY_META_ACTIONS.touched: {
      if (state.touched[action.field]) return state;
      return {
        ...state,
        touched: { ...state.touched, [action.field]: true },
      };
    }
    case SURVEY_META_ACTIONS.touchedBatch: {
      const touched = { ...state.touched };
      action.fields.forEach((field) => {
        touched[field] = true;
      });
      return {
        ...state,
        touched,
      };
    }
    default:
      return state;
  }
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
  const [submitErrorSource, setSubmitErrorSource] = useState("none");
  const [showValidationErrors, setShowValidationErrors] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [retryDisabled, setRetryDisabled] = useState(false);
  const [retryCountdown, setRetryCountdown] = useState(0);
  const [submitLocked, setSubmitLocked] = useState(false);
  const [optimisticMessage, setOptimisticMessage] = useState("");
  const [formDisabled, setFormDisabled] = useState(false);
  const [typingDynamics, setTypingDynamics] = useState({
    firstInputAtMs: null,
    editCount: 0,
    backspaceCount: 0,
  });
  const [fieldMeta, dispatchFieldMeta] = useReducer(surveyFieldMetaReducer, {
    dirty: {},
    touched: {},
  });
  const submitUnlockTimeoutRef = useRef(null);
  const imageLoadTimeoutRef = useRef(null);
  const accountFlaggedTimeoutRef = useRef(null);
  const prefetchTriggeredRef = useRef(false);
  const turnstilePrefetchTriggeredRef = useRef(false);
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
  const surveyDerived = useStableSelector(() => {
    const commentsCharCountValue = countAlphaNumericChars(comments);
    const wordCountValue = countAlphaNumericWords(description);
    const charCountValue = countAlphaNumericChars(description);
    const descriptionValidValue = charCountValue >= MIN_DESCRIPTION_LENGTH && charCountValue <= MAX_DESCRIPTION_LENGTH;
    const commentsValidValue = commentsCharCountValue >= MIN_FEEDBACK_LENGTH && commentsCharCountValue <= MAX_FEEDBACK_LENGTH;
    const imageReadyValue = imageLoaded && !imageError;
    const canSubmitValue = wordCountValue >= MIN_WORDS
      && difficultyRating !== 0
      && confidenceScore !== 0
      && commentsValidValue
      && descriptionValidValue
      && !submitting
      && imageReadyValue;
    return {
      wordCount: wordCountValue,
      charCount: charCountValue,
      commentsCharCount: commentsCharCountValue,
      descriptionValid: descriptionValidValue,
      commentsValid: commentsValidValue,
      imageReady: imageReadyValue,
      canSubmit: canSubmitValue,
      currentStep: Math.max(1, surveyCompleted + 1),
      minimumMet: wordCountValue >= MIN_WORDS
        && commentsCharCountValue >= MIN_FEEDBACK_LENGTH
        && difficultyRating > 0
        && confidenceScore > 0,
    };
  }, [comments, confidenceScore, description, difficultyRating, imageError, imageLoaded, submitting, surveyCompleted]);
  const {
    wordCount,
    charCount,
    commentsCharCount,
    imageReady,
    canSubmit,
    currentStep,
    minimumMet,
  } = surveyDerived;
  const { imageSrc, hasUsableSurveyImage } = useMemo(
    () => buildSurveyImageState(survey),
    [survey]
  );

  const unlockSubmit = useCallback((delayMs = runtimeConfig.submitUnlockDelayMs) => {
    if (submitUnlockTimeoutRef.current) {
      clearTimeout(submitUnlockTimeoutRef.current);
    }
    submitUnlockTimeoutRef.current = scheduleTimeout(() => {
      setSubmitLocked(false);
      submitUnlockTimeoutRef.current = null;
    }, delayMs);
  }, []);

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

  const handleRetryImage = useCallback(() => {
    if (formDisabled || retryDisabled || isFetchingImage) return;
    if (typeof onRetry !== "function") return;
    setRetryDisabled(true);
    setRetryCountdown(runtimeConfig.serviceRetrySeconds);
    setImageError(false);
    setImageLoaded(false);
    setTimerActive(false);
    onRetry({ clearCurrent: true });
  }, [formDisabled, isFetchingImage, onRetry, retryDisabled, setRetryCountdown, setTimerActive]);

  useEffect(() => {
    if (!retryDisabled || runtimeConfig.serviceRetrySeconds <= 0) {
      setRetryCountdown(0);
      return undefined;
    }
    const interval = scheduleInterval(() => {
      setRetryCountdown((prev) => (prev > 0 ? prev - 1 : 0));
    }, runtimeConfig.msPerSecond);
    return () => clearScheduledInterval(interval);
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
    if (!imageSrc || !survey?.image_id || imageLoaded || imageError || fetchError || isFetchingImage) {
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
  }, [fetchError, imageError, imageLoaded, imageSrc, isFetchingImage, setTimerActive, survey?.image_id]);

  const restoreDraft = useCallback((saved) => {
    setDescription(typeof saved.description === "string" ? saved.description : "");
    setDifficultyRating(
      Number.isInteger(saved.difficultyRating)
      && saved.difficultyRating >= MIN_RATING
      && saved.difficultyRating <= MAX_RATING
        ? saved.difficultyRating
        : 0
    );
    setConfidenceScore(
      Number.isInteger(saved.confidenceScore)
      && saved.confidenceScore >= MIN_RATING
      && saved.confidenceScore <= MAX_RATING
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
    if (Number.isFinite(saved.startedAt)) {
      surveyStartTime.current = saved.startedAt;
    } else if (Number.isFinite(saved.elapsed)) {
      surveyStartTime.current = Date.now() - Math.max(0, saved.elapsed) * runtimeConfig.msPerSecond;
    }
  }, [setComments, setConfidenceScore, setDescription, setDifficultyRating, setElapsed, setEngagementData, surveyStartTime]);

  const updateDescription = useCallback((value) => {
    dispatchFieldMeta({ type: SURVEY_META_ACTIONS.dirty, field: SURVEY_FIELDS.description });
    setDescription((prev) => {
      if (prev !== value) {
        const prevChars = countAlphaNumericChars(prev);
        const nextChars = countAlphaNumericChars(value);
        setTypingDynamics((metrics) => ({
          firstInputAtMs: metrics.firstInputAtMs ?? Date.now(),
          editCount: metrics.editCount + 1,
          backspaceCount: metrics.backspaceCount + Math.max(0, prevChars - nextChars),
        }));
      }
      return value;
    });
  }, []);

  const updateDifficultyRating = useCallback((value) => {
    dispatchFieldMeta({ type: SURVEY_META_ACTIONS.dirty, field: SURVEY_FIELDS.difficulty });
    setDifficultyRating(value);
  }, []);

  const updateConfidenceScore = useCallback((value) => {
    dispatchFieldMeta({ type: SURVEY_META_ACTIONS.dirty, field: SURVEY_FIELDS.confidence });
    setConfidenceScore(value);
  }, []);

  const updateComments = useCallback((value) => {
    dispatchFieldMeta({ type: SURVEY_META_ACTIONS.dirty, field: SURVEY_FIELDS.comments });
    setComments((prev) => {
      if (prev !== value) {
        const prevChars = countAlphaNumericChars(prev);
        const nextChars = countAlphaNumericChars(value);
        setTypingDynamics((metrics) => ({
          firstInputAtMs: metrics.firstInputAtMs ?? Date.now(),
          editCount: metrics.editCount + 1,
          backspaceCount: metrics.backspaceCount + Math.max(0, prevChars - nextChars),
        }));
      }
      return value;
    });
  }, []);

  const touchField = useCallback((field) => {
    dispatchFieldMeta({ type: SURVEY_META_ACTIONS.touched, field });
  }, []);

  useEffect(() => {
    setImageLoaded(false);
    setImageError(false);
    setIsZoomed(false);
    setSubmitError("");
    setSubmitErrorSource("none");
    setOptimisticMessage("");
    setShowValidationErrors(false);
    setFormDisabled(false);
    setDescription("");
    setDifficultyRating(0);
    setConfidenceScore(0);
    setComments("");
    setTypingDynamics({ firstInputAtMs: null, editCount: 0, backspaceCount: 0 });
    resetEngagement();
    prefetchTriggeredRef.current = false;
  }, [resetEngagement, setComments, setConfidenceScore, setDescription, setDifficultyRating, survey?.image_id]);

  useEffect(() => {
    if (!isOnline || submitting || typeof onWarmNextSurvey !== "function") return;
    if (!survey?.image_id) return;
    if (prefetchTriggeredRef.current) return;
    const typingSignal = (description.trim().length >= 32) || (comments.trim().length >= 16) || minimumMet;
    if (!typingSignal) return;
    prefetchTriggeredRef.current = true;
    void onWarmNextSurvey();
  }, [comments, description, isOnline, minimumMet, onWarmNextSurvey, submitting, survey?.image_id]);

  useEffect(() => {
    if (!isOnline) return;
    preloadTurnstileScript().catch(() => {
      // Non-blocking warmup only.
    });
  }, [isOnline]);

  useEffect(() => {
    if (!isOnline || submitting) return;
    if (turnstilePrefetchTriggeredRef.current) return;
    const typingSignal = (description.trim().length >= 24)
      || (comments.trim().length >= 12)
      || difficultyRating > 0
      || confidenceScore > 0;
    if (!typingSignal) return;
    turnstilePrefetchTriggeredRef.current = true;
    prefetchTurnstileToken("submission_submit").catch(() => {
      turnstilePrefetchTriggeredRef.current = false;
    });
  }, [comments, confidenceScore, description, difficultyRating, isOnline, submitting]);

  useEffect(() => {
    turnstilePrefetchTriggeredRef.current = false;
  }, [survey?.image_id]);

  const {
    draftRestored,
    saveError,
    clearDrafts,
  } = useSurveyDraftPersistence({
    publicId,
    surveyImageId: survey?.image_id,
    isOnline,
    draftState: {
      imageId: survey?.image_id,
      description,
      difficultyRating,
      confidenceScore,
      comments,
      elapsed,
      startedAt: surveyStartTime.current,
      engagementData,
    },
    onRestore: restoreDraft,
  });

  useEffect(() => {
    if (submitErrorSource !== "validation") return;
    if (!submitError) return;

    if (!showValidationErrors) {
      setSubmitError("");
      setSubmitErrorSource("none");
      return;
    }

    if (canSubmit) {
      setSubmitError("");
      setSubmitErrorSource("none");
    }
  }, [canSubmit, showValidationErrors, submitError, submitErrorSource]);

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

  useEffect(() => {
    if (submitErrorSource !== "validation") return;
    if (!showValidationErrors || submitting) return;
    if (!submitError) return;

    setSubmitError(getSubmitTooltipText());
  }, [
    comments,
    getSubmitTooltipText,
    showValidationErrors,
    submitError,
    submitErrorSource,
    submitting,
  ]);

  const handleSubmit = useCallback(async () => {
    if (submitting || submitLocked) return;
    if (!isOnline) {
      setSubmitError(uiText("survey.offlineSubmit"));
      setSubmitErrorSource("server");
      setPendingFlag(SURVEY_PENDING_SUBMIT_KEY);
      return;
    }

    setSubmitLocked(true);
    setShowValidationErrors(true);
    dispatchFieldMeta({
      type: SURVEY_META_ACTIONS.touchedBatch,
      fields: [SURVEY_FIELDS.description, SURVEY_FIELDS.difficulty, SURVEY_FIELDS.confidence, SURVEY_FIELDS.comments],
    });
    if (!canSubmit) {
      setSubmitError(getSubmitTooltipText());
      setSubmitErrorSource("validation");
      unlockSubmit(runtimeConfig.submitUnlockInvalidDelayMs);
      return;
    }

    if (!survey || !survey.image_id) {
      setSubmitError(getErrorMessage("UI_001_0002"));
      setSubmitErrorSource("server");
      unlockSubmit(runtimeConfig.submitUnlockInvalidDelayMs);
      return;
    }

    setSubmitting(true);
    setSubmitError("");
    setSubmitErrorSource("none");
    startTransition(() => {
      setOptimisticMessage(uiText("common.submitting"));
    });
    const timeSpentSeconds = Math.round((Date.now() - surveyStartTime.current) / runtimeConfig.msPerSecond);
    const submitAtMs = Date.now();
    const firstInputAtMs = Number(typingDynamics.firstInputAtMs || 0);
    const timeBeforeTypingMs = firstInputAtMs > 0
      ? Math.max(0, firstInputAtMs - surveyStartTime.current)
      : 0;
    const writingDurationMs = firstInputAtMs > 0
      ? Math.max(0, submitAtMs - firstInputAtMs)
      : 0;
    let shouldKeepLocked = false;

    try {
      await onSubmit({
        description,
        rating: difficultyRating,
        comments,
        timeSpentSeconds,
        engagementData,
        confidenceScore,
        difficultySelfReport: difficultyRating,
        timeBeforeTypingMs,
        editCount: typingDynamics.editCount,
        backspaceCount: typingDynamics.backspaceCount,
        firstViewDurationMs: timeBeforeTypingMs,
        writingDurationMs,
        avgKeystrokeIntervalMs: null,
        keystrokeVariance: null,
        pauseCount: 0,
        avgPauseDurationMs: null,
      });
      clearDrafts();
      setDescription("");
      setDifficultyRating(0);
      setConfidenceScore(0);
      setComments("");
      setTypingDynamics({ firstInputAtMs: null, editCount: 0, backspaceCount: 0 });
      setEngagementData({ tabSwitchCount: 0, pageCloseAttempts: 0, networkDisconnects: 0 });
      startTransition(() => {
        setOptimisticMessage("");
      });
    } catch (error) {
      if (error?.code === REQUEST_CODES.accountFlagged) {
        shouldKeepLocked = true;
        setFormDisabled(true);
        setSubmitLocked(true);
        setSubmitError(getDisplayErrorMessage(error, "SYS_002_0006"));
        setSubmitErrorSource("server");
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
      setSubmitErrorSource("server");
      startTransition(() => {
        setOptimisticMessage("");
      });
    } finally {
      setSubmitting(false);
      if (!shouldKeepLocked) {
        unlockSubmit(runtimeConfig.submitUnlockCompleteDelayMs);
      }
    }
  }, [
    canSubmit,
    clearDrafts,
    comments,
    description,
    engagementData,
    getSubmitTooltipText,
    isOnline,
    onAccountFlagged,
    onSubmit,
    publicId,
    difficultyRating,
    confidenceScore,
    setEngagementData,
    submitLocked,
    submitting,
    survey,
    surveyStartTime,
    typingDynamics.backspaceCount,
    typingDynamics.editCount,
    typingDynamics.firstInputAtMs,
    unlockSubmit,
  ]);

  useEffect(() => {
    if (!isOnline || submitting || submitLocked) return;
    const pending = getPendingFlag(SURVEY_PENDING_SUBMIT_KEY);
    if (!pending || !canSubmit) return;
    clearPendingFlag(SURVEY_PENDING_SUBMIT_KEY);
    handleSubmit();
  }, [canSubmit, handleSubmit, isOnline, submitLocked, submitting]);

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

  useEffect(() => {
    const onKeyboardSubmit = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.key !== "Enter") return;
      e.preventDefault();
      handleSubmit();
    };
    window.addEventListener("keydown", onKeyboardSubmit);
    return () => window.removeEventListener("keydown", onKeyboardSubmit);
  }, [handleSubmit]);

  useEffect(() => {
    const onRatingAndZoomKeys = (e) => {
      const activeTag = String(document.activeElement?.tagName || "").toLowerCase();
      const typingTarget = activeTag === "textarea" || activeTag === "input";
      if (e.key === "Escape" && isZoomed) {
        setIsZoomed(false);
        return;
      }
      if (!imageReady || typingTarget) return;
      if (e.key === "ArrowRight" || e.key === "ArrowUp") {
        e.preventDefault();
        setDifficultyRating((prev) => Math.min(MAX_RATING, Math.max(MIN_RATING, prev + 1)));
      } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
        e.preventDefault();
        setDifficultyRating((prev) => Math.max(MIN_RATING, prev > 0 ? prev - 1 : MIN_RATING));
      }
    };
    window.addEventListener("keydown", onRatingAndZoomKeys);
    return () => window.removeEventListener("keydown", onRatingAndZoomKeys);
  }, [imageReady, isZoomed]);

  useNavigationBlocker({
    enabled: submitting || submitLocked,
    message: uiText("survey.navigationBlocked"),
    onBlocked: (message) => {
      setSubmitError(message);
      setSubmitErrorSource("server");
    },
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

  const retryExhausted = Boolean(imageError || fetchError);

  return {
    constants,
    description,
    setDescription: updateDescription,
    rating: difficultyRating,
    setRating: updateDifficultyRating,
    difficultyRating,
    setDifficultyRating: updateDifficultyRating,
    confidenceScore,
    setConfidenceScore: updateConfidenceScore,
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
    retryExhausted,
    imageReady,
    retryDisabled,
    retryCountdown,
    wordCount,
    charCount,
    commentsCharCount,
    canSubmit,
    currentStep,
    minimumMet,
    fieldMeta,
    isOnline,
    submitLocked,
    formDisabled,
    descriptionRef,
    commentsRef,
    imageSrc,
    hasUsableSurveyImage,
    handleRetryImage,
    handleSubmit,
    handleImageLoad,
    handleImageError,
    getSubmitTooltip: getSubmitTooltipText,
    preventCopyPaste,
    preventClipboardShortcuts,
    draftRestored,
    saveError,
    optimisticMessage,
    touchField,
  };
}
