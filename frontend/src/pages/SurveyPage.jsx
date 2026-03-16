import React from "react";
import { getErrorMessage } from "../utils/errorRegistry.js";
import { uiText } from "../utils/uiText.js";
import PageSkeleton from "../components/PageSkeleton.jsx";
import SectionSkeleton from "../components/SectionSkeleton.jsx";
import PanelState from "../components/PanelState.jsx";
import DSButton from "../components/design/DSButton.jsx";
import {
  DESCRIPTION_NOTES,
  FEEDBACK_NOTES,
  sanitizeAlphaNumericSpace,
  useSurveyPage,
} from "../hooks/useSurveyPage";

export default function SurveyPage({
  survey,
  publicId,
  surveyCompleted = 0,
  onSubmit,
  fetchError = null,
  onRetry,
  isFetchingImage = false,
}) {
  const {
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
    cacheBustedSrc,
    hasUsableSurveyImage,
    handleRetryImage,
    handleSubmit,
    handleImageLoad,
    handleImageError,
    getSubmitTooltip,
    preventCopyPaste,
    preventClipboardShortcuts,
    draftRestored,
    lastSavedAt,
    isSaving,
    saveError,
  } = useSurveyPage({
    survey,
    publicId,
    surveyCompleted,
    onSubmit,
    fetchError,
  });

  const MIN_WORDS = constants.minWords;
  const PRIORITY_WORD_TARGET = constants.priorityWordTarget;
  const MIN_DESCRIPTION_LENGTH = constants.minDescriptionLength;
  const MAX_DESCRIPTION_LENGTH = constants.maxDescriptionLength;
  const MIN_FEEDBACK_LENGTH = constants.minFeedbackLength;
  const MAX_FEEDBACK_LENGTH = constants.maxFeedbackLength;
  const PRIORITY_FEEDBACK_TARGET = constants.priorityFeedbackTarget;
  const UI_TOTAL_STEPS = constants.uiTotalSteps;
  const COPY_PASTE_DISABLED = constants.copyPasteDisabled;

  // Show loading state if we're waiting for survey data
  if (!survey || !survey.image_id || !hasUsableSurveyImage) {
    return (
      <div className="panel status-panel">
        {isFetchingImage || (!survey || !survey.image_id) ? (
          <PageSkeleton
            title={uiText("survey.loadingImage")}
            subtitle={uiText("survey.canvasSubtitle")}
            variant="survey"
          />
        ) : fetchError || (survey?.image_id && !imageSrc) ? (
          <PanelState
            variant="error"
            icon="!"
            title={uiText("survey.imageLoadFailed")}
            message={fetchError || uiText("survey.imageRestoreFailed")}
            actionLabel={
              retryDisabled && retryCountdown > 0
                ? uiText("survey.retryIn", { seconds: retryCountdown })
                : isFetchingImage
                  ? uiText("survey.retrying")
                  : uiText("survey.retry")
            }
            onAction={onRetry ? () => handleRetryImage(onRetry, isFetchingImage) : null}
            disabled={retryDisabled || isFetchingImage}
          />
        ) : (
          <PageSkeleton
            title={uiText("survey.loadingImage")}
            subtitle={uiText("survey.canvasSubtitle")}
            variant="survey"
          />
        )}
      </div>
    );
  }

  return (
    <div className="panel survey-page-panel">
      {!isOnline && (
        <div className="banner warning">
          <span>{uiText("survey.offlineBanner")}</span>
        </div>
      )}
      {draftRestored && (
        <div className="banner info">
          <span>{uiText("draft.restored")}</span>
        </div>
      )}
      {saveError && (
        <div className="banner warning">
          <span>{saveError}</span>
        </div>
      )}
      <div className="meta meta-step-top">
        <span className="step-chip">{uiText("survey.stepLabel", { current: currentStep, total: Math.min(UI_TOTAL_STEPS, currentStep) })}</span>
      </div>
      <div className={`image-container ${isZoomed ? "zoomed" : ""}`}>
        {!imageError ? (
          <img
            key={cacheBustedSrc}
            src={cacheBustedSrc}
            alt={uiText("survey.promptAlt")}
            onClick={() => setIsZoomed(!isZoomed)}
            onLoad={handleImageLoad}
            onError={handleImageError}
            style={{ display: imageLoaded ? 'block' : 'none' }}
          />
        ) : (
          <div className="image-error">
            <p>{getErrorMessage('SYS_002_0005')}</p>
            <DSButton
              variant="primary"
              className="small button-top"
              onClick={() => handleRetryImage(onRetry, isFetchingImage)}
              disabled={retryDisabled || isFetchingImage}
            >
              {isFetchingImage ? uiText("survey.retryingShort") : uiText("survey.retryShort")}
            </DSButton>
          </div>
        )}
        {!imageLoaded && !imageError && (
          <div className="image-loading">
            <SectionSkeleton title={uiText("survey.loadingImage")} rows={4} dense />
          </div>
        )}
        <DSButton
          variant="ghost"
          className="zoom-toggle"
          onClick={() => setIsZoomed(!isZoomed)}
          disabled={!imageLoaded || imageError}
        >
          {isZoomed ? uiText("survey.resetZoom") : uiText("survey.zoom")}
        </DSButton>
      </div>

      <div className="meta">
        <span className="timer">{uiText("survey.timeElapsed", { seconds: elapsed })}</span>
      </div>

      {(minimumMet || priorityMet) && (
        <div className="survey-badges">
          {minimumMet && <span className="status-badge met">{uiText("survey.minimumMet")}</span>}
          {priorityMet && <span className="status-badge met">{uiText("survey.priorityMet")}</span>}
        </div>
      )}

      <div className="field">
        <label>{uiText("survey.descriptionLabel")} <span className="required" aria-label="required">*</span></label>
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
            placeholder={uiText("survey.descriptionPlaceholder")}
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
          <div className="textarea-counter">{uiText("survey.wordsChars", { words: wordCount, chars: charCount, max: MAX_DESCRIPTION_LENGTH })}</div>
        </div>
        <div className="counts">
          <span>{uiText("survey.wordsMin", { words: wordCount, min: MIN_WORDS })}</span>
          <span className={showValidationErrors && wordCount < MIN_WORDS ? "warning" : "ok"}>
            {uiText("survey.minimumWords", { min: MIN_WORDS })}
          </span>
          <span className={descriptionPriorityReady ? "ok" : ""}>
            {uiText("survey.priorityWords", { target: PRIORITY_WORD_TARGET })}
          </span>
        </div>
        <div className={`helper-text ${wordCount >= MIN_WORDS ? "ok" : "warning"}`}>
          {wordCount >= MIN_WORDS
            ? uiText("survey.wordsGood")
            : uiText("survey.wordsRemaining", { remaining: MIN_WORDS - wordCount })}
        </div>
        <div className={`priority-field-note ${descriptionPriorityReady ? "ready" : ""}`}>
          <div className="priority-field-head">
            <span>{uiText("survey.priorityWords", { target: PRIORITY_WORD_TARGET })}</span>
            <strong>{wordCount}/{PRIORITY_WORD_TARGET}</strong>
          </div>
          <div className="priority-inline-bar">
            <span style={{ width: `${wordProgress}%` }} />
          </div>
          <p>
            {descriptionPriorityReady
              ? uiText("survey.priorityReachedDesc")
              : uiText("survey.priorityRemainingDesc", { remaining: wordShortfall })}
          </p>
          <p className="priority-micro-note">{DESCRIPTION_NOTES[descriptionNoteIndex]}</p>
        </div>
      </div>

      <div className="field effort-rating">
        <label>
          {uiText("survey.ratingLabel")} <span className="required" aria-label="required">*</span> {rating > 0 ? `${rating}/10` : ""}
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
          <span>{uiText("survey.ratingLow")}</span>
          <span>{uiText("survey.ratingHigh")}</span>
        </div>
      </div>

      <div className="field feedback-field">
        <label>{uiText("survey.commentsLabel")} <span className="required" aria-label="required">*</span></label>
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
            placeholder={uiText("survey.commentsPlaceholder")}
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
          <div className="textarea-counter">{uiText("survey.charsCount", { count: comments.length, max: MAX_FEEDBACK_LENGTH })}</div>
        </div>
        <div className="counts">
          <span className={showValidationErrors && comments.length < MIN_FEEDBACK_LENGTH ? "warning" : ""}>
            {uiText("survey.feedbackMin", { count: comments.length })}
          </span>
          <span className="ok">
            {uiText("survey.feedbackMinimum")}
          </span>
          <span className={feedbackCount >= PRIORITY_FEEDBACK_TARGET ? "ok" : ""}>
            {uiText("survey.feedbackPriority", { target: PRIORITY_FEEDBACK_TARGET })}
          </span>
        </div>
        <div className={`helper-text ${comments.length >= MIN_FEEDBACK_LENGTH ? "ok" : "warning"}`}>
          {comments.length >= MIN_FEEDBACK_LENGTH
            ? uiText("survey.feedbackGood")
            : uiText("survey.feedbackRemainingMin", { remaining: MIN_FEEDBACK_LENGTH - comments.length })}
        </div>
        <div className={`priority-field-note ${feedbackPriorityReady ? "ready" : ""}`}>
          <div className="priority-field-head">
            <span>{uiText("survey.feedbackTargetTitle", { target: PRIORITY_FEEDBACK_TARGET })}</span>
            <strong>{feedbackCount}/{PRIORITY_FEEDBACK_TARGET}</strong>
          </div>
          <div className="priority-inline-bar">
            <span style={{ width: `${feedbackProgress}%` }} />
          </div>
          <p>
            {feedbackPriorityReady
              ? uiText("survey.feedbackReached")
              : uiText("survey.feedbackRemaining", { remaining: feedbackShortfall })}
          </p>
          <p className="priority-micro-note">{FEEDBACK_NOTES[feedbackNoteIndex]}</p>
        </div>
      </div>

      {submitError && <div className="banner warning">{submitError}</div>}

      <div className="actions page-actions survey-submit-actions survey-sticky-footer sticky-mobile-actions">
        <div className="submit-info-box">
          <p className="submit-shortcut-hint">{uiText("survey.submitShortcut")}</p>
        </div>
        <DSButton
          className={`primary ${submitting ? "wiggle" : ""}`}
          onClick={handleSubmit}
          disabled={!canSubmit || submitLocked || !isOnline}
          title={getSubmitTooltip()}
        >
          {submitting ? (
            <>
              <span className="button-spinner" />
              {uiText("survey.submitBusy")}
            </>
          ) : submitLocked ? uiText("survey.submitLocked") : uiText("survey.submit")}
        </DSButton>
      </div>
    </div>
  );
}
