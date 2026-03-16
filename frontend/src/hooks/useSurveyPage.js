import { useCallback, useEffect, useRef, useState } from "react";
import { getApiUrl } from "../utils/apiBase";
import { getErrorMessage } from "../utils/errorRegistry.js";
import { runtimeConfig } from "../config/runtime";
import { clearPendingFlag, getPendingFlag, readExpiringValue, removeStoredKey, setPendingFlag, writeExpiringValue } from "../utils/storage";
import { uiText } from "../utils/uiText";
import { useNavigationBlocker } from "./useNavigationBlocker";
import { useOnlineStatus } from "./useOnlineStatus";

const MIN_WORDS = runtimeConfig.minWords;
const PRIORITY_WORD_TARGET = runtimeConfig.priorityDescWordTarget;
const MIN_DESCRIPTION_LENGTH = runtimeConfig.minDescriptionLength;
const MAX_DESCRIPTION_LENGTH = runtimeConfig.maxDescriptionLength;
const MIN_FEEDBACK_LENGTH = runtimeConfig.minFeedbackLength;
const MAX_FEEDBACK_LENGTH = runtimeConfig.maxFeedbackLength;
const PRIORITY_FEEDBACK_TARGET = runtimeConfig.priorityFeedbackTarget;
const UI_TOTAL_STEPS = runtimeConfig.surveyUiTotalSteps;
const COPY_PASTE_DISABLED = runtimeConfig.disableCopyPaste;
const SURVEY_DRAFT_SCHEMA_VERSION = runtimeConfig.surveyDraftSchemaVersion;
const SURVEY_DRAFT_TTL_MS = runtimeConfig.surveyDraftTtlMs;
const SURVEY_PENDING_SUBMIT_KEY = runtimeConfig.storageKeys.surveyPendingSubmit;

export const DESCRIPTION_NOTES = [
  "Strong start. Add one more concrete visual detail.",
  "Nice momentum. Expand with color, position, and context.",
  "Good flow. Mention object relationships to boost clarity.",
  "Great effort. Add scene depth and small visible cues.",
  "You are building quality. Add sequence or action details.",
  "High-value response. Add what stands out most and why.",
  "Excellent pace. Add contrast, count, or spatial references.",
  "Almost priority-ready. Add richer context and precision.",
  "Very close to priority tier. Add one strong final paragraph.",
  "Priority target reached. Keep this detail level for top quality.",
];
export const FEEDBACK_NOTES = [
  "Start with one clear thought about the task.",
  "Good start. Add what felt easy or difficult.",
  "Add a practical suggestion to improve the prompt.",
  "Great. Mention whether image quality affected your response.",
  "Helpful feedback. Add one specific improvement idea.",
  "Strong direction. Explain what increased your confidence.",
  "Useful signal. Add an example to make feedback actionable.",
  "Almost priority-ready. Add one concise final insight.",
  "Very close. Add what would make this task smoother.",
  "Priority feedback reached. Clear, detailed, and actionable.",
];

export const sanitizeAlphaNumericSpace = (value) =>
  value.replace(/[\t\r\n]+/g, " ").replace(/[^a-zA-Z0-9 ]+/g, "");

const getDraftKey = (publicId, imageId) => {
  const prefix = runtimeConfig.storageKeys.surveyDraftPrefix;
  return imageId ? `${prefix}_${publicId || "anon"}_${imageId}` : null;
};
const getActiveDraftKey = (publicId) => {
  const prefix = runtimeConfig.storageKeys.surveyDraftActivePrefix;
  return `${prefix}_${publicId || "anon"}`;
};

const readSurveyDraft = (key) => {
  if (!key) return null;
  return readExpiringValue(key, null, {
    schemaVersion: SURVEY_DRAFT_SCHEMA_VERSION,
    ttlMs: SURVEY_DRAFT_TTL_MS,
  });
};

const writeSurveyDraft = (key, data) => {
  if (!key) return;
  writeExpiringValue(key, data, {
    schemaVersion: SURVEY_DRAFT_SCHEMA_VERSION,
    ttlMs: SURVEY_DRAFT_TTL_MS,
  });
};

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
  const [elapsed, setElapsed] = useState(0);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [retryDisabled, setRetryDisabled] = useState(false);
  const [timerActive, setTimerActive] = useState(false);
  const [submitLocked, setSubmitLocked] = useState(false);
  const [engagementData, setEngagementData] = useState({
    tabSwitchCount: 0,
    pageCloseAttempts: 0,
    networkDisconnects: 0,
  });

  const surveyStartTime = useRef(Date.now());
  const timerIntervalRef = useRef(null);
  const submitUnlockTimeoutRef = useRef(null);
  const descriptionRef = useRef(null);
  const commentsRef = useRef(null);
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
  const draftKey = getDraftKey(publicId, survey?.image_id);
  const activeDraftKey = getActiveDraftKey(publicId);
  const resolvedImageUrl = survey?.url || survey?.image_url || survey?.imageUrl || "";
  const imageSrc = resolvedImageUrl
    ? (resolvedImageUrl.startsWith("http") ? resolvedImageUrl : getApiUrl(resolvedImageUrl))
    : "";
  const cacheBustedSrc = imageSrc
    ? `${imageSrc}${imageSrc.includes("?") ? "&" : "?"}v=${encodeURIComponent(survey?.image_id || "")}`
    : "";
  const hasUsableSurveyImage = Boolean(survey?.image_id && imageSrc);

  const unlockSubmit = useCallback((delayMs = runtimeConfig.submitUnlockDelayMs) => {
    if (submitUnlockTimeoutRef.current) {
      clearTimeout(submitUnlockTimeoutRef.current);
    }
    submitUnlockTimeoutRef.current = setTimeout(() => {
      setSubmitLocked(false);
      submitUnlockTimeoutRef.current = null;
    }, delayMs);
  }, []);

  useEffect(() => {
    const handleOnline = () => {};
    const handleVisibilityChange = () => {
      if (document.hidden) {
        setEngagementData((prev) => ({ ...prev, tabSwitchCount: prev.tabSwitchCount + 1 }));
      }
    };
    const handleBeforeUnload = (e) => {
      setEngagementData((prev) => ({ ...prev, pageCloseAttempts: prev.pageCloseAttempts + 1 }));
      delete e.returnValue;
    };
    const handleOffline = () => {
      setEngagementData((prev) => ({ ...prev, networkDisconnects: prev.networkDisconnects + 1 }));
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const preventCopyPaste = useCallback((e) => {
    if (!COPY_PASTE_DISABLED) return;
    e.preventDefault();
    return false;
  }, []);

  const preventClipboardShortcuts = useCallback((e) => {
    if (!COPY_PASTE_DISABLED) return;
    if ((e.ctrlKey || e.metaKey) && ["c", "x", "v", "insert"].includes(e.key.toLowerCase())) {
      e.preventDefault();
    }
    if (e.shiftKey && e.key === "Insert") {
      e.preventDefault();
    }
  }, []);

  useEffect(() => {
    if (!COPY_PASTE_DISABLED) return;
    const descTextarea = descriptionRef.current;
    const commentsTextarea = commentsRef.current;
    if (descTextarea) {
      descTextarea.addEventListener("copy", preventCopyPaste);
      descTextarea.addEventListener("cut", preventCopyPaste);
      descTextarea.addEventListener("paste", preventCopyPaste);
      descTextarea.addEventListener("contextmenu", preventCopyPaste);
    }
    if (commentsTextarea) {
      commentsTextarea.addEventListener("copy", preventCopyPaste);
      commentsTextarea.addEventListener("cut", preventCopyPaste);
      commentsTextarea.addEventListener("paste", preventCopyPaste);
      commentsTextarea.addEventListener("contextmenu", preventCopyPaste);
    }
    return () => {
      if (descTextarea) {
        descTextarea.removeEventListener("copy", preventCopyPaste);
        descTextarea.removeEventListener("cut", preventCopyPaste);
        descTextarea.removeEventListener("paste", preventCopyPaste);
        descTextarea.removeEventListener("contextmenu", preventCopyPaste);
      }
      if (commentsTextarea) {
        commentsTextarea.removeEventListener("copy", preventCopyPaste);
        commentsTextarea.removeEventListener("cut", preventCopyPaste);
        commentsTextarea.removeEventListener("paste", preventCopyPaste);
        commentsTextarea.removeEventListener("contextmenu", preventCopyPaste);
      }
    };
  }, [preventCopyPaste]);

  useEffect(() => () => {
    if (submitUnlockTimeoutRef.current) {
      clearTimeout(submitUnlockTimeoutRef.current);
    }
  }, []);

  const handleRetryImage = useCallback((onRetry, isFetchingImage) => {
    if (retryDisabled || isFetchingImage) return;
    setRetryDisabled(true);
    setImageError(false);
    setImageLoaded(false);
    setTimerActive(false);
    onRetry({ clearCurrent: true });
  }, [retryDisabled]);

  useEffect(() => {
    if (imageError || fetchError) {
      setRetryDisabled(false);
    }
  }, [fetchError, imageError]);

  useEffect(() => {
    setElapsed(0);
    setImageLoaded(false);
    setImageError(false);
    setIsZoomed(false);
    setSubmitError("");
    setShowValidationErrors(false);
    setTimerActive(false);
    setDescription("");
    setRating(0);
    setComments("");
    setEngagementData({ tabSwitchCount: 0, pageCloseAttempts: 0, networkDisconnects: 0 });
    surveyStartTime.current = Date.now();

    if (survey?.image_id) {
      try {
        const saved = readSurveyDraft(getDraftKey(publicId, survey.image_id)) || readSurveyDraft(activeDraftKey);
        if (saved) {
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
        }
      } catch {
        // Ignore malformed draft payload and continue with fresh inputs.
      }
    }

    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }

    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    };
  }, [activeDraftKey, publicId, survey?.image_id]);

  useEffect(() => {
    if (!isOnline) return;
    if (!draftKey || !survey?.image_id) return;
    const payload = {
      imageId: survey.image_id,
      description,
      rating,
      comments,
      elapsed,
      startedAt: surveyStartTime.current,
      engagementData,
    };
    writeSurveyDraft(draftKey, payload);
    writeSurveyDraft(activeDraftKey, payload);
  }, [activeDraftKey, comments, description, draftKey, elapsed, engagementData, isOnline, rating, survey?.image_id]);

  useEffect(() => {
    if (timerActive) {
      timerIntervalRef.current = setInterval(() => {
        setElapsed((prev) => prev + 1);
      }, runtimeConfig.surveyTimerTickMs);
    } else if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    };
  }, [timerActive]);

  const getSubmitTooltip = useCallback(() => {
    if (!imageReady) return getErrorMessage("SYS_002_0018");
    if (submitting || submitLocked) return uiText("survey.submitBusy");
    if (wordCount < MIN_WORDS) {
      return getErrorMessage("VAL_002_0004", "en", { min_words: MIN_WORDS, actual: wordCount });
    }
    if (description.length < MIN_DESCRIPTION_LENGTH) return getErrorMessage("VAL_002_0002");
    if (description.length > MAX_DESCRIPTION_LENGTH) return getErrorMessage("VAL_002_0003");
    if (rating === 0) return getErrorMessage("VAL_002_0008");
    const commentsLength = comments.trim().length;
    if (commentsLength < MIN_FEEDBACK_LENGTH) return getErrorMessage("VAL_002_0006");
    if (commentsLength > MAX_FEEDBACK_LENGTH) return getErrorMessage("VAL_002_0007");
    return uiText("survey.submit");
  }, [comments, description, imageReady, rating, submitLocked, submitting, wordCount]);

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
      setSubmitError(getSubmitTooltip());
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
      if (draftKey) {
        removeStoredKey(draftKey);
      }
      removeStoredKey(activeDraftKey);
      setDescription("");
      setRating(0);
      setComments("");
      setEngagementData({ tabSwitchCount: 0, pageCloseAttempts: 0, networkDisconnects: 0 });
    } catch (error) {
      if (error?.code) {
        setSubmitError(getErrorMessage(error.code));
      } else {
        setSubmitError(getErrorMessage("SYS_002_0006"));
      }
    } finally {
      setSubmitting(false);
      unlockSubmit(runtimeConfig.submitUnlockCompleteDelayMs);
    }
  }, [
    activeDraftKey,
    canSubmit,
    comments,
    description,
    draftKey,
    engagementData,
    getSubmitTooltip,
    isOnline,
    onSubmit,
    rating,
    submitLocked,
    submitting,
    survey,
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
  }, []);

  const handleImageError = useCallback(() => {
    setImageError(true);
    setImageLoaded(false);
    setTimerActive(false);
  }, []);

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
    message: "Submission in progress. Please wait before leaving this page.",
    onBlocked: setSubmitError,
  });

  return {
    constants: {
      minWords: MIN_WORDS,
      priorityWordTarget: PRIORITY_WORD_TARGET,
      minDescriptionLength: MIN_DESCRIPTION_LENGTH,
      maxDescriptionLength: MAX_DESCRIPTION_LENGTH,
      minFeedbackLength: MIN_FEEDBACK_LENGTH,
      maxFeedbackLength: MAX_FEEDBACK_LENGTH,
      priorityFeedbackTarget: PRIORITY_FEEDBACK_TARGET,
      uiTotalSteps: UI_TOTAL_STEPS,
      copyPasteDisabled: COPY_PASTE_DISABLED,
    },
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
    retryDisabled,
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
    descriptionRef,
    commentsRef,
    imageSrc,
    cacheBustedSrc,
    hasUsableSurveyImage,
    handleRetryImage,
    handleSubmit,
    handleImageLoad,
    handleImageError,
    getSubmitTooltip,
    preventCopyPaste,
    preventClipboardShortcuts,
  };
}
