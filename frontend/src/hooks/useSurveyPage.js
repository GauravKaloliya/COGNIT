import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getErrorMessage } from "../utils/errorRegistry.js";
import { getDisplayErrorMessage } from "../utils/appError.js";
import { runtimeConfig } from "../config/runtime";
import { clearPendingFlag, getPendingFlag, setPendingFlag } from "../utils/storage";
import { uiText } from "../utils/uiText";
import { useNavigationBlocker } from "./useNavigationBlocker";
import { useOnlineStatus } from "./useOnlineStatus";
import { useSurveyDraftPersistence } from "./useSurveyDraftPersistence";
import { useSurveyEngagement } from "./useSurveyEngagement";
import { buildSurveyImageState, getSubmitTooltip } from "../utils/surveyPageHelpers";
import { clearScheduledInterval, clearScheduledTimeout, scheduleInterval, scheduleTimeout } from "../utils/timing";

export { sanitizeAlphaNumericSpace } from "../utils/surveyPageHelpers";

const MIN_WORDS = runtimeConfig.minWords;
const PRIORITY_WORD_TARGET = runtimeConfig.priorityDescWordTarget;
const MIN_DESCRIPTION_LENGTH = runtimeConfig.minDescriptionLength;
const MAX_DESCRIPTION_LENGTH = runtimeConfig.maxDescriptionLength;
const MIN_FEEDBACK_LENGTH = runtimeConfig.minFeedbackLength;
const MAX_FEEDBACK_LENGTH = runtimeConfig.maxFeedbackLength;
const PRIORITY_FEEDBACK_TARGET = runtimeConfig.priorityFeedbackTarget;
const UI_TOTAL_STEPS = runtimeConfig.surveyUiTotalSteps;
const COPY_PASTE_DISABLED = runtimeConfig.disableCopyPaste;
const SURVEY_PENDING_SUBMIT_KEY = runtimeConfig.storageKeys.surveyPendingSubmit;

export const DESCRIPTION_NOTES = uiText("survey.descriptionNotes").split("|");
export const FEEDBACK_NOTES = uiText("survey.feedbackNotes").split("|");

export function useSurveyPage({
  survey,
  publicId,
  surveyCompleted = 0,
  onSubmit,
  fetchError = null,
}) {
  const isOnline = useOnlineStatus();
  const [description, setDescription] = useState("");
  const [rating, setRating] = useState(0);
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
  const submitUnlockTimeoutRef = useRef(null);
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
  const wordCount = description.trim() ? description.trim().split(/\s+/).length : 0;
  const charCount = description.length;
  const feedbackCount = comments.trim().length;
  const descriptionValid = description.length >= MIN_DESCRIPTION_LENGTH && description.length <= MAX_DESCRIPTION_LENGTH;
  const commentsValid = comments.trim().length >= MIN_FEEDBACK_LENGTH && comments.trim().length <= MAX_FEEDBACK_LENGTH;
  const imageReady = imageLoaded && !imageError;
  const canSubmit = wordCount >= MIN_WORDS && rating !== 0 && commentsValid && descriptionValid && !submitting && imageReady;
  const wordProgress = Math.min(100, Math.round((wordCount / PRIORITY_WORD_TARGET) * 100));
  const feedbackProgress = Math.min(100, Math.round((feedbackCount / PRIORITY_FEEDBACK_TARGET) * 100));
  const wordShortfall = Math.max(0, PRIORITY_WORD_TARGET - wordCount);
  const feedbackShortfall = Math.max(0, PRIORITY_FEEDBACK_TARGET - feedbackCount);
  const descriptionPriorityReady = wordCount >= PRIORITY_WORD_TARGET;
  const feedbackPriorityReady = feedbackCount >= PRIORITY_FEEDBACK_TARGET;
  const descriptionNoteIndex = Math.min(9, Math.floor(wordProgress / 10));
  const feedbackNoteIndex = Math.min(9, Math.floor(feedbackProgress / 10));
  const currentStep = Math.max(1, surveyCompleted + 1);
  const minimumMet = wordCount >= MIN_WORDS && comments.trim().length >= MIN_FEEDBACK_LENGTH && rating > 0;
  const priorityMet = descriptionPriorityReady && feedbackPriorityReady;
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
  }, []);

  const handleRetryImage = useCallback((onRetry, isFetchingImage) => {
    if (retryDisabled || isFetchingImage) return;
    setRetryDisabled(true);
    setRetryCountdown(runtimeConfig.serviceRetrySeconds);
    setImageError(false);
    setImageLoaded(false);
    setTimerActive(false);
    onRetry({ clearCurrent: true });
  }, [retryDisabled, setRetryCountdown, setTimerActive]);

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
    if (imageError || fetchError) {
      setRetryDisabled(false);
    }
  }, [fetchError, imageError]);

  useEffect(() => {
    if (retryDisabled && retryCountdown === 0) {
      setRetryDisabled(false);
    }
  }, [retryCountdown, retryDisabled]);

  const restoreDraft = useCallback((saved) => {
    setDescription(typeof saved.description === "string" ? saved.description : "");
    setRating(Number.isInteger(saved.rating) ? saved.rating : 0);
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
  }, [setComments, setDescription, setElapsed, setEngagementData, setRating, surveyStartTime]);

  const {
    draftRestored,
    lastSavedAt,
    isSaving,
    saveError,
    clearDrafts,
  } = useSurveyDraftPersistence({
    publicId,
    surveyImageId: survey?.image_id,
    isOnline,
    draftState: {
      imageId: survey?.image_id,
      description,
      rating,
      comments,
      elapsed,
      startedAt: surveyStartTime.current,
      engagementData,
    },
    onRestore: restoreDraft,
  });

  useEffect(() => {
    setImageLoaded(false);
    setImageError(false);
    setIsZoomed(false);
    setSubmitError("");
    setShowValidationErrors(false);
    setDescription("");
    setRating(0);
    setComments("");
    resetEngagement();
  }, [resetEngagement, setDescription, setRating, setComments, survey?.image_id]);

  useEffect(() => {
    if (!submitError) return;

    if (!showValidationErrors) {
      setSubmitError("");
      return;
    }

    if (canSubmit) {
      setSubmitError("");
    }
  }, [canSubmit, showValidationErrors, submitError]);

  const getSubmitTooltipText = useCallback(() => getSubmitTooltip({
    imageReady,
    submitting,
    submitLocked,
    wordCount,
    minWords: MIN_WORDS,
    description,
    minDescriptionLength: MIN_DESCRIPTION_LENGTH,
    maxDescriptionLength: MAX_DESCRIPTION_LENGTH,
    rating,
    comments,
    minFeedbackLength: MIN_FEEDBACK_LENGTH,
    maxFeedbackLength: MAX_FEEDBACK_LENGTH,
    getErrorMessage,
    uiText,
  }), [comments, description, imageReady, rating, submitLocked, submitting, wordCount]);

  useEffect(() => {
    if (!showValidationErrors || submitting) return;
    if (!submitError) return;

    setSubmitError(getSubmitTooltipText());
  }, [
    comments,
    description,
    getSubmitTooltipText,
    rating,
    showValidationErrors,
    submitError,
    submitting,
  ]);

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
      setSubmitError(getSubmitTooltipText());
      unlockSubmit(runtimeConfig.submitUnlockInvalidDelayMs);
      return;
    }

    if (!survey || !survey.image_id) {
      setSubmitError(getErrorMessage("SYS_002_0004"));
      unlockSubmit(runtimeConfig.submitUnlockInvalidDelayMs);
      return;
    }

    setSubmitting(true);
    setSubmitError("");
    const timeSpentSeconds = Math.round((Date.now() - surveyStartTime.current) / runtimeConfig.msPerSecond);

    try {
      await onSubmit({
        description,
        rating,
        comments,
        timeSpentSeconds,
        engagementData,
      });
      clearDrafts();
      setDescription("");
      setRating(0);
      setComments("");
      setEngagementData({ tabSwitchCount: 0, pageCloseAttempts: 0, networkDisconnects: 0 });
    } catch (error) {
      setSubmitError(getDisplayErrorMessage(error, "SYS_002_0006"));
    } finally {
      setSubmitting(false);
      unlockSubmit(runtimeConfig.submitUnlockCompleteDelayMs);
    }
  }, [
    canSubmit,
    clearDrafts,
    comments,
    description,
    engagementData,
    getSubmitTooltipText,
    isOnline,
    onSubmit,
    rating,
    setEngagementData,
    submitLocked,
    submitting,
    survey,
    surveyStartTime,
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
    setImageLoaded(true);
    setImageError(false);
    setTimerActive(true);
  }, [setTimerActive]);

  const handleImageError = useCallback(() => {
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
        setRating((prev) => Math.min(10, Math.max(1, prev + 1)));
      } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
        e.preventDefault();
        setRating((prev) => Math.max(1, prev > 0 ? prev - 1 : 1));
      }
    };
    window.addEventListener("keydown", onRatingAndZoomKeys);
    return () => window.removeEventListener("keydown", onRatingAndZoomKeys);
  }, [imageReady, isZoomed]);

  useNavigationBlocker({
    enabled: submitting || submitLocked,
    message: uiText("survey.navigationBlocked"),
    onBlocked: setSubmitError,
  });

  const constants = useMemo(() => ({
    minWords: MIN_WORDS,
    priorityWordTarget: PRIORITY_WORD_TARGET,
    minDescriptionLength: MIN_DESCRIPTION_LENGTH,
    maxDescriptionLength: MAX_DESCRIPTION_LENGTH,
    minFeedbackLength: MIN_FEEDBACK_LENGTH,
    maxFeedbackLength: MAX_FEEDBACK_LENGTH,
    priorityFeedbackTarget: PRIORITY_FEEDBACK_TARGET,
    uiTotalSteps: UI_TOTAL_STEPS,
    copyPasteDisabled: COPY_PASTE_DISABLED,
  }), []);

  return {
    constants,
    description,
    setDescription,
    rating,
    setRating,
    comments,
    setComments,
    isZoomed,
    setIsZoomed,
    submitting,
    submitError,
    showValidationErrors,
    elapsed,
    imageLoaded,
    imageError,
    imageReady,
    retryDisabled,
    retryCountdown,
    wordCount,
    charCount,
    feedbackCount,
    canSubmit,
    wordProgress,
    feedbackProgress,
    wordShortfall,
    feedbackShortfall,
    descriptionPriorityReady,
    feedbackPriorityReady,
    descriptionNoteIndex,
    feedbackNoteIndex,
    currentStep,
    minimumMet,
    priorityMet,
    isOnline,
    submitLocked,
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
    lastSavedAt,
    isSaving,
    saveError,
  };
}
