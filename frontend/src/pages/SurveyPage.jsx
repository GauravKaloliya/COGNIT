import React, { useState, useEffect, useRef, useCallback } from "react";
import { getApiUrl } from "../utils/apiBase";
import { getErrorMessage } from "../utils/errorRegistry.js";
import { uiText } from "../utils/uiText.js";
import { runtimeConfig } from "../config/runtime";
import PageSkeleton from "../components/PageSkeleton.jsx";
import SectionSkeleton from "../components/SectionSkeleton.jsx";
import PanelState from "../components/PanelState.jsx";
import { useNavigationBlocker } from "../hooks/useNavigationBlocker";

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
const DESCRIPTION_NOTES = [
  "Strong start. Add one more concrete visual detail.",
  "Nice momentum. Expand with color, position, and context.",
  "Good flow. Mention object relationships to boost clarity.",
  "Great effort. Add scene depth and small visible cues.",
  "You are building quality. Add sequence or action details.",
  "High-value response. Add what stands out most and why.",
  "Excellent pace. Add contrast, count, or spatial references.",
  "Almost priority-ready. Add richer context and precision.",
  "Very close to priority tier. Add one strong final paragraph.",
  "Priority target reached. Keep this detail level for top quality."
];
const FEEDBACK_NOTES = [
  "Start with one clear thought about the task.",
  "Good start. Add what felt easy or difficult.",
  "Add a practical suggestion to improve the prompt.",
  "Great. Mention whether image quality affected your response.",
  "Helpful feedback. Add one specific improvement idea.",
  "Strong direction. Explain what increased your confidence.",
  "Useful signal. Add an example to make feedback actionable.",
  "Almost priority-ready. Add one concise final insight.",
  "Very close. Add what would make this task smoother.",
  "Priority feedback reached. Clear, detailed, and actionable."
];

const sanitizeAlphaNumericSpace = (value) =>
  value.replace(/[\t\r\n]+/g, ' ').replace(/[^a-zA-Z0-9 ]+/g, '');

const getDraftKey = (publicId, imageId) =>
  imageId ? `survey_draft_${publicId || "anon"}_${imageId}` : null;
const getActiveDraftKey = (publicId) => `survey_draft_active_${publicId || "anon"}`;

const readSurveyDraft = (key) => {
  if (!key) return null;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      parsed.__schema_version !== SURVEY_DRAFT_SCHEMA_VERSION ||
      typeof parsed.expires_at !== "number"
    ) {
      return null;
    }
    if (Date.now() > parsed.expires_at) {
      sessionStorage.removeItem(key);
      return null;
    }
    return parsed.data || null;
  } catch {
    return null;
  }
};

const writeSurveyDraft = (key, data) => {
  if (!key) return;
  try {
    const now = Date.now();
    sessionStorage.setItem(
      key,
      JSON.stringify({
        __schema_version: SURVEY_DRAFT_SCHEMA_VERSION,
        saved_at: now,
        expires_at: now + SURVEY_DRAFT_TTL_MS,
        data
      })
    );
  } catch {
    // Ignore storage failures.
  }
};

export default function SurveyPage({
  survey,
  publicId,
  surveyCompleted = 0,
  onSubmit,
  fetchError = null,
  onRetry,
  isFetchingImage = false,
}) {
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

  // Engagement tracking state
  const [engagementData, setEngagementData] = useState({
    tabSwitchCount: 0,
    pageCloseAttempts: 0,
    networkDisconnects: 0
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

  const unlockSubmit = useCallback((delayMs = runtimeConfig.submitUnlockDelayMs) => {
    if (submitUnlockTimeoutRef.current) {
      clearTimeout(submitUnlockTimeoutRef.current);
    }
    submitUnlockTimeoutRef.current = setTimeout(() => {
      setSubmitLocked(false);
      submitUnlockTimeoutRef.current = null;
    }, delayMs);
  }, []);

  // Local engagement counters for submission payload.
  // Global backend event tracking is handled in App.jsx for all pages.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        setEngagementData(prev => ({
          ...prev,
          tabSwitchCount: prev.tabSwitchCount + 1
        }));
      }
    };

    const handleBeforeUnload = (e) => {
      setEngagementData(prev => ({
        ...prev,
        pageCloseAttempts: prev.pageCloseAttempts + 1
      }));
      delete e['returnValue'];
    };

    const handleOnline = () => {};

    const handleOffline = () => {
      setEngagementData(prev => ({
        ...prev,
        networkDisconnects: prev.networkDisconnects + 1
      }));
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

  // Copy-paste prevention for survey page only (as requested)
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

  // Add copy-paste prevention to textareas for survey page only
  useEffect(() => {
    if (!COPY_PASTE_DISABLED) {
      return;
    }

    const descTextarea = descriptionRef.current;
    const commentsTextarea = commentsRef.current;

    if (descTextarea) {
      descTextarea.addEventListener('copy', preventCopyPaste);
      descTextarea.addEventListener('cut', preventCopyPaste);
      descTextarea.addEventListener('paste', preventCopyPaste);
      descTextarea.addEventListener('contextmenu', preventCopyPaste);
    }

    if (commentsTextarea) {
      commentsTextarea.addEventListener('copy', preventCopyPaste);
      commentsTextarea.addEventListener('cut', preventCopyPaste);
      commentsTextarea.addEventListener('paste', preventCopyPaste);
      commentsTextarea.addEventListener('contextmenu', preventCopyPaste);
    }

    return () => {
      if (descTextarea) {
        descTextarea.removeEventListener('copy', preventCopyPaste);
        descTextarea.removeEventListener('cut', preventCopyPaste);
        descTextarea.removeEventListener('paste', preventCopyPaste);
        descTextarea.removeEventListener('contextmenu', preventCopyPaste);
      }
      if (commentsTextarea) {
        commentsTextarea.removeEventListener('copy', preventCopyPaste);
        commentsTextarea.removeEventListener('cut', preventCopyPaste);
        commentsTextarea.removeEventListener('paste', preventCopyPaste);
        commentsTextarea.removeEventListener('contextmenu', preventCopyPaste);
      }
    };
  }, [preventCopyPaste]);

  useEffect(() => {
    return () => {
      if (submitUnlockTimeoutRef.current) {
        clearTimeout(submitUnlockTimeoutRef.current);
      }
    };
  }, []);

  const handleRetryImage = () => {
    if (retryDisabled || isFetchingImage) return;
    setRetryDisabled(true);
    setImageError(false);
    setImageLoaded(false);
    setTimerActive(false);
    onRetry({ clearCurrent: true });
  };

  useEffect(() => {
    if (imageError || fetchError) {
      setRetryDisabled(false);
    }
  }, [imageError, fetchError]);

  useEffect(() => {
    setElapsed(0);
    setImageLoaded(false);
    setImageError(false);
    setIsZoomed(false);
    setSubmitError("");
    setShowValidationErrors(false);
    setTimerActive(false);
    surveyStartTime.current = Date.now();
    setDescription("");
    setRating(0);
    setComments("");
    setEngagementData({
      tabSwitchCount: 0,
      pageCloseAttempts: 0,
      networkDisconnects: 0
    });
    surveyStartTime.current = Date.now();

    if (survey?.image_id) {
      try {
        const saved =
          readSurveyDraft(getDraftKey(publicId, survey.image_id)) ||
          readSurveyDraft(getActiveDraftKey(publicId));
        if (saved) {
          const draft = saved;
          setDescription(typeof draft.description === "string" ? draft.description : "");
          setRating(Number.isInteger(draft.rating) ? draft.rating : 0);
          setComments(typeof draft.comments === "string" ? draft.comments : "");
          setElapsed(Number.isFinite(draft.elapsed) ? Math.max(0, draft.elapsed) : 0);
          setEngagementData({
            tabSwitchCount: Number.isFinite(draft.engagementData?.tabSwitchCount) ? Math.max(0, draft.engagementData.tabSwitchCount) : 0,
            pageCloseAttempts: Number.isFinite(draft.engagementData?.pageCloseAttempts) ? Math.max(0, draft.engagementData.pageCloseAttempts) : 0,
            networkDisconnects: Number.isFinite(draft.engagementData?.networkDisconnects) ? Math.max(0, draft.engagementData.networkDisconnects) : 0
          });
          if (Number.isFinite(draft.startedAt)) {
            surveyStartTime.current = draft.startedAt;
          } else if (Number.isFinite(draft.elapsed)) {
            surveyStartTime.current = Date.now() - Math.max(0, draft.elapsed) * runtimeConfig.msPerSecond;
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
  }, [survey?.image_id, publicId]);

  useEffect(() => {
    if (!draftKey || !survey?.image_id) return;
    const payload = {
      imageId: survey.image_id,
      description,
      rating,
      comments,
      elapsed,
      startedAt: surveyStartTime.current,
      engagementData
    };
    writeSurveyDraft(draftKey, payload);
    writeSurveyDraft(activeDraftKey, payload);
  }, [
    draftKey,
    activeDraftKey,
    survey?.image_id,
    description,
    rating,
    comments,
    elapsed,
    engagementData
  ]);

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
    if (!imageReady) return getErrorMessage('SYS_002_0018');
    if (submitting || submitLocked) return "Submitting...";
    if (wordCount < MIN_WORDS) {
      return getErrorMessage('VAL_002_0004', 'en', { min_words: MIN_WORDS, actual: wordCount });
    }
    if (description.length < MIN_DESCRIPTION_LENGTH) return getErrorMessage('VAL_002_0002');
    if (description.length > MAX_DESCRIPTION_LENGTH) return getErrorMessage('VAL_002_0003');
    if (rating === 0) return getErrorMessage('VAL_002_0008');
    const commentsLength = comments.trim().length;
    if (commentsLength < MIN_FEEDBACK_LENGTH) return getErrorMessage('VAL_002_0006');
    if (commentsLength > MAX_FEEDBACK_LENGTH) return getErrorMessage('VAL_002_0007');
    return "Submit your response";
  }, [imageReady, submitting, submitLocked, wordCount, description, rating, comments]);

  const handleSubmit = useCallback(async () => {
    if (submitting || submitLocked) {
      return;
    }

    setSubmitLocked(true);
    setShowValidationErrors(true);
    if (!canSubmit) {
      setSubmitError(getSubmitTooltip());
      unlockSubmit(runtimeConfig.submitUnlockInvalidDelayMs);
      return;
    }

    // Additional validation before submit
    if (!survey || !survey.image_id) {
      setSubmitError(getErrorMessage('SYS_002_0004'));
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
        engagementData
      });

      if (draftKey) {
        sessionStorage.removeItem(draftKey);
      }
      sessionStorage.removeItem(activeDraftKey);

      // Reset form and engagement data after successful submission
      setDescription("");
      setRating(0);
      setComments("");
      setEngagementData({
        tabSwitchCount: 0,
        pageCloseAttempts: 0,
        networkDisconnects: 0
      });
    } catch (error) {
      if (error?.code) {
        setSubmitError(getErrorMessage(error.code));
      } else {
        setSubmitError(getErrorMessage('SYS_002_0006'));
      }
    } finally {
      setSubmitting(false);
      unlockSubmit(runtimeConfig.submitUnlockCompleteDelayMs);
    }
  }, [
    submitting,
    submitLocked,
    canSubmit,
    getSubmitTooltip,
    survey,
    onSubmit,
    description,
    rating,
    comments,
    engagementData,
    draftKey,
    activeDraftKey,
    unlockSubmit
  ]);

  const handleImageLoad = () => {
    setImageLoaded(true);
    setImageError(false);
    setTimerActive(true);
  };

  const handleImageError = () => {
    setImageError(true);
    setImageLoaded(false);
    setTimerActive(false);
  };

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

  const imageSrc = survey?.url
    ? (survey.url.startsWith('http') ? survey.url : getApiUrl(survey.url))
    : "";

  // Show loading state if we're waiting for survey data
  if (!survey || !survey.image_id) {
    return (
      <div className="panel status-panel">
        {isFetchingImage ? (
          <PageSkeleton
            title={uiText("survey.loadingImage")}
            subtitle="Preparing your survey canvas"
            variant="survey"
          />
        ) : fetchError ? (
          <PanelState
            variant="error"
            icon="!"
            title="Image load failed"
            message={fetchError}
            actionLabel={isFetchingImage ? uiText("survey.retrying") : uiText("survey.retry")}
            onAction={onRetry ? handleRetryImage : null}
            disabled={retryDisabled || isFetchingImage}
          />
        ) : (
          <PageSkeleton
            title={uiText("survey.loadingImage")}
            subtitle="Preparing your survey canvas"
            variant="survey"
          />
        )}
      </div>
    );
  }

  return (
    <div className="panel survey-page-panel">
      <div className="meta meta-step-top">
        <span className="step-chip">Survey {currentStep} of {Math.min(UI_TOTAL_STEPS, currentStep)}</span>
      </div>
      <div className={`image-container ${isZoomed ? "zoomed" : ""}`}>
        {!imageError ? (
          <img
            key={imageSrc}
            src={imageSrc}
            alt="Prompt"
            onClick={() => setIsZoomed(!isZoomed)}
            onLoad={handleImageLoad}
            onError={handleImageError}
            style={{ display: imageLoaded ? 'block' : 'none' }}
          />
        ) : (
          <div className="image-error">
            <p>{getErrorMessage('SYS_002_0005')}</p>
            <button
              className="primary small button-top"
              onClick={handleRetryImage}
              disabled={retryDisabled || isFetchingImage}
            >
              {isFetchingImage ? "Retrying..." : "Retry"}
            </button>
          </div>
        )}
        {!imageLoaded && !imageError && (
          <div className="image-loading">
            <SectionSkeleton title={uiText("survey.loadingImage")} rows={4} dense />
          </div>
        )}
        <button
          className="zoom-toggle"
          onClick={() => setIsZoomed(!isZoomed)}
          disabled={!imageLoaded || imageError}
        >
          {isZoomed ? "Reset zoom" : "Zoom"}
        </button>
      </div>

      <div className="meta">
        <span className="timer">Time: {elapsed}s</span>
      </div>

      {(minimumMet || priorityMet) && (
        <div className="survey-badges">
          {minimumMet && <span className="status-badge met">Minimum met</span>}
          {priorityMet && <span className="status-badge met">Priority met</span>}
        </div>
      )}

      <h3 className="survey-section-heading">Response Details</h3>
      <div className="field">
        <label>Description <span className="required" aria-label="required">*</span></label>
        <div className="textarea-wrap">
          <textarea
            ref={descriptionRef}
            className={showValidationErrors && description.length > 0 && (
              description.length < MIN_DESCRIPTION_LENGTH ||
              description.length > MAX_DESCRIPTION_LENGTH
            ) ? 'error-input' : ''}
            value={description}
            onChange={(e) => {
              const value = sanitizeAlphaNumericSpace(e.target.value);
              if (value.length <= MAX_DESCRIPTION_LENGTH) {
                setDescription(value);
              }
            }}
            placeholder="Describe what you see..."
            spellCheck
            disabled={!imageReady}
            maxLength={MAX_DESCRIPTION_LENGTH}
            onCopy={COPY_PASTE_DISABLED ? preventCopyPaste : undefined}
            onCut={COPY_PASTE_DISABLED ? preventCopyPaste : undefined}
            onPaste={COPY_PASTE_DISABLED ? preventCopyPaste : undefined}
            onContextMenu={COPY_PASTE_DISABLED ? preventCopyPaste : undefined}
            onDrop={COPY_PASTE_DISABLED ? preventCopyPaste : undefined}
            onDragOver={COPY_PASTE_DISABLED ? preventCopyPaste : undefined}
            onKeyDown={COPY_PASTE_DISABLED ? preventClipboardShortcuts : undefined}
          />
          <div className="textarea-counter">Words {wordCount} | Chars {charCount}/{MAX_DESCRIPTION_LENGTH}</div>
        </div>
        <div className="counts">
          <span>Words: {wordCount} / Min {MIN_WORDS}</span>
          <span className={showValidationErrors && wordCount < MIN_WORDS ? "warning" : "ok"}>
            Minimum: {MIN_WORDS} words
          </span>
          <span className={descriptionPriorityReady ? "ok" : "warning"}>Priority target: {PRIORITY_WORD_TARGET}+ words</span>
        </div>
        <div className={`priority-field-note ${descriptionPriorityReady ? "ready" : ""}`}>
          <div className="priority-field-head">
            <span>Priority target: {PRIORITY_WORD_TARGET}+ words</span>
            <strong>{wordCount}/{PRIORITY_WORD_TARGET}</strong>
          </div>
          <div className="priority-inline-bar">
            <span style={{ width: `${wordProgress}%` }} />
          </div>
          <p>
            {descriptionPriorityReady
              ? "Description target reached for priority queue consideration."
              : `Write ${wordShortfall} more words to reach priority level.`}
          </p>
          <p className="priority-micro-note">{DESCRIPTION_NOTES[descriptionNoteIndex]}</p>
        </div>
      </div>

      <h3 className="survey-section-heading">Difficulty Rating</h3>
      <div className="field effort-rating">
        <label>
          Image rating <span className="required" aria-label="required">*</span> {rating > 0 ? `${rating}/10` : ""}
        </label>
        <div className={`rating-scale ${!imageReady ? "rating-scale-disabled" : ""}`}>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((val) => (
            <label key={val} className="rating-option">
              <input
                type="radio"
                name="effort-rating"
                value={val}
                checked={rating === val}
                onChange={() => setRating(val)}
                disabled={!imageReady}
              />
              <span className="rating-label">{val}</span>
            </label>
          ))}
        </div>
        <div className="rating-labels">
          <span>Very Low</span>
          <span>Very High</span>
        </div>
      </div>

      <h3 className="survey-section-heading">Reflection</h3>
      <div className="field feedback-field">
        <label>Comments <span className="required" aria-label="required">*</span></label>
        <div className="textarea-wrap">
          <textarea
            ref={commentsRef}
            className={showValidationErrors && comments.length > 0 && (
              comments.length < MIN_FEEDBACK_LENGTH ||
              comments.length > MAX_FEEDBACK_LENGTH
            ) ? 'error-input' : ''}
            value={comments}
            onChange={(e) => {
              const value = sanitizeAlphaNumericSpace(e.target.value);
              if (value.length <= MAX_FEEDBACK_LENGTH) {
                setComments(value);
              }
            }}
            placeholder="Share any additional notes..."
            disabled={!imageReady}
            maxLength={MAX_FEEDBACK_LENGTH}
            onCopy={COPY_PASTE_DISABLED ? preventCopyPaste : undefined}
            onCut={COPY_PASTE_DISABLED ? preventCopyPaste : undefined}
            onPaste={COPY_PASTE_DISABLED ? preventCopyPaste : undefined}
            onContextMenu={COPY_PASTE_DISABLED ? preventCopyPaste : undefined}
            onDrop={COPY_PASTE_DISABLED ? preventCopyPaste : undefined}
            onDragOver={COPY_PASTE_DISABLED ? preventCopyPaste : undefined}
            onKeyDown={COPY_PASTE_DISABLED ? preventClipboardShortcuts : undefined}
          />
          <div className="textarea-counter">Chars {comments.length}/{MAX_FEEDBACK_LENGTH}</div>
        </div>
        <div className="counts">
          <span className={showValidationErrors && comments.length < MIN_FEEDBACK_LENGTH ? "warning" : ""}>
            Characters: {comments.length} / Min 4
          </span>
          <span className="ok">
            Minimum: 4 characters
          </span>
          <span className={feedbackCount >= PRIORITY_FEEDBACK_TARGET ? "ok" : "warning"}>
            Priority target: {PRIORITY_FEEDBACK_TARGET}+ characters
          </span>
        </div>
        <div className={`priority-field-note ${feedbackPriorityReady ? "ready" : ""}`}>
          <div className="priority-field-head">
            <span>Priority feedback target: {PRIORITY_FEEDBACK_TARGET}+ characters</span>
            <strong>{feedbackCount}/{PRIORITY_FEEDBACK_TARGET}</strong>
          </div>
          <div className="priority-inline-bar">
            <span style={{ width: `${feedbackProgress}%` }} />
          </div>
          <p>
            {feedbackPriorityReady
              ? "Feedback target reached for stronger priority profile."
              : `Add ${feedbackShortfall} more characters to strengthen priority chances.`}
          </p>
          <p className="priority-micro-note">{FEEDBACK_NOTES[feedbackNoteIndex]}</p>
        </div>
      </div>

      {submitError && <div className="banner warning">{submitError}</div>}

      <div className="actions survey-submit-actions survey-sticky-footer">
        <div className="submit-info-box">
          <p className="submit-trust-note">{uiText("survey.autosave")}</p>
          <p className="submit-shortcut-hint">{uiText("survey.submitShortcut")}</p>
        </div>
        <button
          className={`primary ${submitting ? "wiggle" : ""}`}
          onClick={handleSubmit}
          disabled={!canSubmit || submitLocked}
          title={getSubmitTooltip()}
        >
          {submitting ? (
            <>
              <span className="button-spinner" />
              Submitting...
            </>
          ) : submitLocked ? "Please wait..." : "Submit"}
        </button>
      </div>
    </div>
  );
}
