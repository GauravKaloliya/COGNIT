import React, { useState, useEffect, useRef, useCallback } from "react";
import { getApiUrl } from "../utils/apiBase";
import { endpoints } from "../utils/api.js";
import { getErrorMessage } from "../utils/errorRegistry.js";

const MIN_WORDS = parseInt(import.meta.env.VITE_MIN_WORDS || "60", 10);
const MIN_DESCRIPTION_LENGTH = parseInt(import.meta.env.VITE_MIN_DESCRIPTION_LENGTH || "60", 10);
const MAX_DESCRIPTION_LENGTH = parseInt(import.meta.env.VITE_MAX_DESCRIPTION_LENGTH || "10000", 10);
const MIN_FEEDBACK_LENGTH = parseInt(import.meta.env.VITE_MIN_FEEDBACK_LENGTH || "5", 10);
const MAX_FEEDBACK_LENGTH = parseInt(import.meta.env.VITE_MAX_FEEDBACK_LENGTH || "2000", 10);

export default function SurveyPage({
  survey,
  publicId,
  onSubmit,
  onFinish,
  isSurvey = false,
  surveyFeedbackReady = false,
  onSurveyContinue,
  onSurveyFinish,
  fetchError = null,
  onRetry,
  surveyCompleted = 0
}) {
  const [description, setDescription] = useState("");
  const [rating, setRating] = useState(0);
  const [comments, setComments] = useState("");
  const [isZoomed, setIsZoomed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [timerActive, setTimerActive] = useState(false);

  // Engagement tracking state
  const [engagementData, setEngagementData] = useState({
    tabSwitchCount: 0,
    pageCloseAttempts: 0,
    networkDisconnects: 0
  });

  const surveyStartTime = useRef(Date.now());
  const timerIntervalRef = useRef(null);
  const descriptionRef = useRef(null);
  const commentsRef = useRef(null);
  const wordCount = description.trim() ? description.trim().split(/\s+/).length : 0;
  const charCount = description.length;
  const descriptionValid = description.length >= MIN_DESCRIPTION_LENGTH && description.length <= MAX_DESCRIPTION_LENGTH;
  const commentsValid = comments.trim().length >= MIN_FEEDBACK_LENGTH && comments.trim().length <= MAX_FEEDBACK_LENGTH;
  const imageReady = imageLoaded && !imageError;
  const canSubmit = wordCount >= MIN_WORDS && rating !== 0 && commentsValid && descriptionValid && !submitting && imageReady;

  // Set up enhanced engagement tracking
  useEffect(() => {
    // Track tab visibility changes
    const handleVisibilityChange = async () => {
      if (document.hidden && publicId) {
        setEngagementData(prev => ({
          ...prev,
          tabSwitchCount: prev.tabSwitchCount + 1
        }));

        // Send engagement event to backend using API wrapper
        try {
          await endpoints.trackEngagement({
            public_id: publicId,
            event_type: 'tab_switch'
          });
        } catch (error) {
          console.warn('Failed to track tab switch:', error);
        }
      }
    };

    // Track page close attempts
    const handleBeforeUnload = async (e) => {
      if (publicId) {
        setEngagementData(prev => ({
          ...prev,
          pageCloseAttempts: prev.pageCloseAttempts + 1
        }));

        // Send engagement event to backend using API wrapper (non-blocking)
        endpoints.trackEngagement({
          public_id: publicId,
          event_type: 'page_close_attempt'
        }).catch(error => {
          console.warn('Failed to track page close:', error);
        });
      }
      // Allow navigation but track it
      delete e['returnValue'];
    };

    // Track network disconnects
    const handleOnline = async () => {
      // Network restored
      if (publicId) {
        try {
          await endpoints.trackEngagement({
            public_id: publicId,
            event_type: 'network_reconnect'  // Note: different event type for online
          });
        } catch (error) {
          console.warn('Failed to track network reconnect:', error);
        }
      }
    };

    const handleOffline = async () => {
      if (publicId) {
        setEngagementData(prev => ({
          ...prev,
          networkDisconnects: prev.networkDisconnects + 1
        }));

        // Send engagement event to backend using API wrapper
        try {
          await endpoints.trackEngagement({
            public_id: publicId,
            event_type: 'network_disconnect'
          });
        } catch (error) {
          console.warn('Failed to track network disconnect:', error);
        }
      }
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
  }, [publicId]);

  // Copy-paste prevention for survey page only (as requested)
  const preventCopyPaste = useCallback((e) => {
    e.preventDefault();
    return false;
  }, []);

  // Add copy-paste prevention to textareas for survey page only
  useEffect(() => {
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

  const handleRetryImage = () => {
    setImageError(false);
    setImageLoaded(false);
    setTimerActive(false);
    onRetry();
  };

  useEffect(() => {
    setElapsed(0);
    setImageLoaded(false);
    setImageError(false);
    setIsZoomed(false);
    setSubmitError("");
    setTimerActive(false);
    surveyStartTime.current = Date.now();
    
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
  }, [survey?.image_id]);

  useEffect(() => {
    if (timerActive) {
      timerIntervalRef.current = setInterval(() => {
        setElapsed((prev) => prev + 1);
      }, 1000);
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

  useEffect(() => {
    if (submitError) {
      setSubmitError("");
    }
  }, [description, rating, comments]);

  const handleSubmit = async () => {
    if (!canSubmit) {
      setSubmitError(getSubmitTooltip());
      return;
    }

    // Additional validation before submit
    if (!survey || !survey.image_id) {
      setSubmitError(getErrorMessage('SYS_002_0004'));
      return;
    }

    setSubmitting(true);
    setSubmitError("");
    const timeSpentSeconds = Math.round((Date.now() - surveyStartTime.current) / 1000);

    try {
      await onSubmit({
        description,
        rating,
        comments,
        timeSpentSeconds,
        engagementData
      });

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
    }
  };

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

  const getSubmitTooltip = () => {
    if (!imageReady) return getErrorMessage('SYS_002_0018');
    if (submitting) return "Submitting...";
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
  };

  const imageSrc = survey?.url
    ? (survey.url.startsWith('http') ? survey.url : getApiUrl(survey.url))
    : "";

  // Show loading state if we're waiting for survey data
  if (!survey || !survey.image_id) {
    return (
      <div className="panel status-panel">
        {fetchError ? (
          <div className="image-error">
            <p className="status-message error">{fetchError}</p>
            {onRetry && (
              <button
                className="primary small"
                onClick={onRetry}
              >
                Retry
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="spinner"></div>
            <p className="status-message">Loading image...</p>
          </>
        )}
      </div>
    );
  }

  if (isSurvey && surveyFeedbackReady) {
    return (
      <div className="panel">
        <div className="guidance">
          <div className="survey-feedback-icon">
            ✓
          </div>
          <h2 className="survey-feedback-title">Survey Complete!</h2>
          <p className="survey-feedback-text">
            Great job on your survey! You have completed {surveyCompleted} survey
            {surveyCompleted === 1 ? '' : 's'}. You can now choose to continue with more survey 
            images or finish the study.
          </p>
          <div className="survey-feedback-tip">
            <p>
              <em>Tip: Aim to describe colors, textures, relationships, and any notable objects.
              Remember to write at least {MIN_WORDS} words per description.</em>
            </p>
          </div>
          <div className="survey-feedback-actions">
            <button
              className="primary"
              onClick={onSurveyContinue}
            >
              Continue Survey
            </button>
            <button
              className="ghost survey-feedback-finish"
              onClick={onSurveyFinish}
            >
              Finish
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
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
            >
              Retry
            </button>
          </div>
        )}
        {!imageLoaded && !imageError && (
          <div className="image-loading">
            <div className="spinner"></div>
            <p>Loading image...</p>
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

      <div className="field">
        <label>Description</label>
        <textarea
          ref={descriptionRef}
          className={!isSurvey && description.length > 0 && (
            description.length < MIN_DESCRIPTION_LENGTH ||
            description.length > MAX_DESCRIPTION_LENGTH
          ) ? 'error-input' : ''}
          value={description}
          onChange={(e) => {
            const value = e.target.value;
            if (value.length <= MAX_DESCRIPTION_LENGTH) {
              setDescription(value);
            }
          }}
          placeholder="Describe what you see..."
          spellCheck
          disabled={!imageReady}
          maxLength={MAX_DESCRIPTION_LENGTH}
        />
      </div>

      <div className="counts">
        <span>Words: {wordCount} / Min {MIN_WORDS}</span>
        <span>Characters: {charCount} / {MAX_DESCRIPTION_LENGTH}</span>
        <span className={wordCount >= MIN_WORDS ? "ok" : "warning"}>
          Minimum: {MIN_WORDS} words
        </span>
      </div>

      <div className="field effort-rating">
        <label>Image rating {rating > 0 ? `${rating}/10` : ""}</label>
        <div className="rating-scale">
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

      <div className="field">
        <label>Comments</label>
        <textarea
          ref={commentsRef}
          className={!isSurvey && comments.length > 0 && (
            comments.length < MIN_FEEDBACK_LENGTH ||
            comments.length > MAX_FEEDBACK_LENGTH
          ) ? 'error-input' : ''}
          value={comments}
          onChange={(e) => {
            const value = e.target.value;
            if (value.length <= MAX_FEEDBACK_LENGTH) {
              setComments(value);
            }
          }}
          placeholder="Share any additional notes..."
          disabled={!imageReady}
          maxLength={MAX_FEEDBACK_LENGTH}
        />
        {comments.length > 0 && (
          <div className="counts">
            <span className={comments.length >= MIN_FEEDBACK_LENGTH ? "ok" : "warning"}>
              Characters: {comments.length} / {MAX_FEEDBACK_LENGTH}
            </span>
          </div>
        )}
      </div>

      {submitError && <div className="banner warning">{submitError}</div>}

      <div className="actions">
        <button
          className={`primary ${submitting ? "wiggle" : ""}`}
          onClick={handleSubmit}
          disabled={!canSubmit}
          title={getSubmitTooltip()}
        >
          {submitting ? "Submitting..." : "Submit"}
        </button>
      </div>

      {!isSurvey && (
        <p className="hint">You can stop at any time using the Finish button above</p>
      )}
    </div>
  );
}
