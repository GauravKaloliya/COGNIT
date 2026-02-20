import React, { useState, useEffect, useRef } from "react";
import { getApiUrl } from "../utils/apiBase";

const MIN_WORDS = 60;

export default function SurveyPage({
  survey,
  participantId,
  sessionId,
  onSubmit,
  onNext,
  onFinish,
  showNext,
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

  const surveyStartTime = useRef(Date.now());
  const timerIntervalRef = useRef(null);
  const wordCount = description.trim() ? description.trim().split(/\s+/).length : 0;
  const charCount = description.length;
  const commentsValid = comments.trim().length >= 5;
  const imageReady = imageLoaded && !imageError;
  const canSubmit = wordCount >= MIN_WORDS && rating !== 0 && commentsValid && !submitting && imageReady;

  const handleRetryImage = () => {
    setImageError(false);
    setImageLoaded(false);
    setTimerActive(false);
    const img = document.querySelector('.image-container img');
    if (img && img.src) {
      const originalSrc = img.src;
      img.src = originalSrc.split('?')[0] + '?retry=' + Date.now();
    }
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
      setSubmitError("Image not loaded properly. Please wait or refresh.");
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
        timeSpentSeconds
      });

      // Reset form after successful submission
      setDescription("");
      setRating(0);
      setComments("");
    } catch (error) {
      setSubmitError(error?.message || "Submission failed. Please try again.");
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
    if (!imageReady) return "Waiting for image to load...";
    if (submitting) return "Submitting...";
    if (wordCount < MIN_WORDS) return `Need at least ${MIN_WORDS} words (currently ${wordCount})`;
    if (rating === 0) return "Please select a rating";
    if (!commentsValid) return "Comments must be at least 5 characters";
    return "Submit your response";
  };

  const imageSrc = survey?.image_url
    ? (survey.image_url.startsWith('http') ? survey.image_url : getApiUrl(survey.image_url))
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
                className="primary"
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
          <div style={{
            background: 'linear-gradient(135deg, var(--success), var(--primary))',
            width: '100px',
            height: '100px',
            borderRadius: '50%',
            margin: '0 auto 32px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white',
            fontSize: '48px',
            boxShadow: '0 4px 20px rgba(24, 119, 242, 0.3)'
          }}>
            ✓
          </div>
          <h2 style={{ color: 'var(--success)', marginBottom: '20px', marginTop: '0' }}>Survey Complete!</h2>
          <p style={{ fontSize: '16px', lineHeight: '1.8', marginBottom: '32px', maxWidth: '500px', margin: '0 auto 32px' }}>
            Great job on your survey! You have completed {surveyCompleted} survey
            {surveyCompleted === 1 ? '' : 's'}. You can now choose to continue with more survey 
            images or finish the study.
          </p>
          <div style={{
            backgroundColor: 'var(--accent-bg)',
            padding: '20px',
            borderRadius: '12px',
            marginBottom: '32px',
            borderLeft: '4px solid var(--primary)',
            maxWidth: '600px',
            margin: '0 auto 32px'
          }}>
            <p style={{ margin: '0', color: 'var(--muted)', lineHeight: '1.6' }}>
              <em>Tip: Aim to describe colors, textures, relationships, and any notable objects.
              Remember to write at least {MIN_WORDS} words per description.</em>
            </p>
          </div>
          <div style={{ display: 'flex', gap: '20px', justifyContent: 'center', flexWrap: 'wrap', marginTop: '20px' }}>
            <button
              className="primary"
              onClick={onSurveyContinue}
              style={{ padding: '14px 28px', fontSize: '14px', height: '48px' }}
            >
              Continue Survey
            </button>
            <button
              className="ghost"
              onClick={onSurveyFinish}
              style={{ padding: '14px 28px', border: '2px solid var(--error)', color: 'var(--error)', fontSize: '14px', height: '48px' }}
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
      <div className="progress">
        {isSurvey ? (
          <span>Survey Session</span>
        ) : (
          <button className="ghost" onClick={onFinish}>
            Finish
          </button>
        )}
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
            <p>Image failed to load.</p>
            <button
              className="primary compact button-top"
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
          className={!isSurvey && wordCount > 0 && wordCount < MIN_WORDS ? 'error-input' : ''}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe what you see..."
          spellCheck
          disabled={!imageReady}
        />
      </div>

      <div className="counts">
        <span>Words: {wordCount} / Min {MIN_WORDS}</span>
        <span>Characters: {charCount}</span>
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
          className={!isSurvey && comments.length > 0 && comments.length < 5 ? 'error-input' : ''}
          value={comments}
          onChange={(e) => setComments(e.target.value)}
          placeholder="Share any additional notes..."
          disabled={!imageReady}
        />
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
        {showNext && (
          <button className="ghost" onClick={onNext}>
            Next
          </button>
        )}
      </div>

      {!isSurvey && (
        <p className="hint">You can stop at any time using the Finish button above</p>
      )}
    </div>
  );
}