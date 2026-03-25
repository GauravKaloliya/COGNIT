import React from "react";
import { uiText } from "../utils/uiText.js";
import PageSkeleton from "../components/PageSkeleton.jsx";
import PanelState from "../components/PanelState.jsx";
import PageStatusBanners from "../components/PageStatusBanners.jsx";
import { sanitizeAlphaNumericSpace, useSurveyPage } from "../hooks/useSurveyPage";
import SurveyImagePanel from "../components/survey/SurveyImagePanel.jsx";
import SurveyDescriptionField from "../components/survey/SurveyDescriptionField.jsx";
import SurveyRatingField from "../components/survey/SurveyRatingField.jsx";
import SurveyCommentsField from "../components/survey/SurveyCommentsField.jsx";
import SurveySubmitFooter from "../components/survey/SurveySubmitFooter.jsx";

export default function SurveyPage({
  survey,
  publicId,
  surveyCompleted = 0,
  onSubmit,
  onRetry = null,
  fetchError = null,
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
    canSubmit,
    currentStep,
    minimumMet,
    isOnline,
    submitLocked,
    descriptionRef,
    commentsRef,
    imageSrc,
    hasUsableSurveyImage,
    handleSubmit,
    handleImageLoad,
    handleImageError,
    handleRetryImage,
    getSubmitTooltip,
    preventCopyPaste,
    preventClipboardShortcuts,
    draftRestored,
    saveError,
  } = useSurveyPage({
    survey,
    publicId,
    surveyCompleted,
    onSubmit,
    onRetry,
    fetchError,
    isFetchingImage,
  });

  const MIN_WORDS = constants.minWords;
  const MIN_DESCRIPTION_LENGTH = constants.minDescriptionLength;
  const MAX_DESCRIPTION_LENGTH = constants.maxDescriptionLength;
  const MIN_FEEDBACK_LENGTH = constants.minFeedbackLength;
  const MAX_FEEDBACK_LENGTH = constants.maxFeedbackLength;
  const UI_TOTAL_STEPS = constants.uiTotalSteps;
  const COPY_PASTE_DISABLED = constants.copyPasteDisabled;
  const visibleSubmitError = submitError
    && submitError !== uiText("survey.submit")
    && submitError !== uiText("survey.submitBusy")
    && submitError !== uiText("survey.submitLocked")
    ? submitError
    : "";

  // Show loading state if we're waiting for survey data
  if (!survey || !survey.image_id || !hasUsableSurveyImage) {
    return (
      <div className="panel status-panel">
        {fetchError && !isFetchingImage ? (
          <PanelState
            variant="error"
            icon="!"
            title={uiText("survey.imageLoadFailed")}
            message={fetchError || uiText("survey.imageRestoreFailed")}
            actionLabel={
              retryDisabled && retryCountdown > 0
                ? uiText("common.tryAgainIn", { seconds: retryCountdown })
                : uiText("common.retry")
            }
            onAction={retryDisabled ? null : handleRetryImage}
            disabled={retryDisabled}
          />
        ) : isFetchingImage || (!survey || !survey.image_id) ? (
          <PageSkeleton
            title={uiText("survey.loadingSurvey")}
            subtitle={uiText("survey.loadingSurveySubtitle")}
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
                ? uiText("common.tryAgainIn", { seconds: retryCountdown })
                : uiText("common.retry")
            }
            onAction={retryDisabled ? null : handleRetryImage}
            disabled={retryDisabled}
          />
        ) : (
          <PageSkeleton
            title={uiText("survey.loadingSurvey")}
            subtitle={uiText("survey.loadingSurveySubtitle")}
            variant="survey"
          />
        )}
      </div>
    );
  }

  return (
    <div className="panel survey-page-panel">
      <PageStatusBanners
        isOnline={isOnline}
        offlineMessage={uiText("survey.offlineBanner")}
        draftRestored={draftRestored}
        saveError={saveError}
      />
      <div className="meta meta-step-top">
        <span className="step-chip">{uiText("survey.stepLabel", { current: currentStep, total: Math.min(UI_TOTAL_STEPS, currentStep) })}</span>
      </div>
      <SurveyImagePanel
        imageSrc={imageSrc}
        imageLoaded={imageLoaded}
        imageError={imageError}
        isZoomed={isZoomed}
        setIsZoomed={setIsZoomed}
        retryCountdown={retryCountdown}
        retryDisabled={retryDisabled}
        handleRetryImage={handleRetryImage}
        handleImageLoad={handleImageLoad}
        handleImageError={handleImageError}
      />

      <div className="meta meta-timer-row">
        <span className="timer">{uiText("survey.timeElapsed", { seconds: elapsed })}</span>
      </div>

      {minimumMet && (
        <div className="survey-badges">
          {minimumMet && <span className="status-badge met">{uiText("survey.minimumMet")}</span>}
        </div>
      )}

      <SurveyDescriptionField
        description={description}
        setDescription={setDescription}
        descriptionRef={descriptionRef}
        showValidationErrors={showValidationErrors}
        minDescriptionLength={MIN_DESCRIPTION_LENGTH}
        maxDescriptionLength={MAX_DESCRIPTION_LENGTH}
        minWords={MIN_WORDS}
        wordCount={wordCount}
        charCount={charCount}
        imageReady={imageReady}
        copyPasteDisabled={COPY_PASTE_DISABLED}
        preventCopyPaste={preventCopyPaste}
        preventClipboardShortcuts={preventClipboardShortcuts}
        sanitizeAlphaNumericSpace={sanitizeAlphaNumericSpace}
      />

      <SurveyRatingField
        rating={rating}
        setRating={setRating}
        imageReady={imageReady}
      />

      <SurveyCommentsField
        comments={comments}
        setComments={setComments}
        commentsRef={commentsRef}
        showValidationErrors={showValidationErrors}
        minFeedbackLength={MIN_FEEDBACK_LENGTH}
        maxFeedbackLength={MAX_FEEDBACK_LENGTH}
        imageReady={imageReady}
        copyPasteDisabled={COPY_PASTE_DISABLED}
        preventCopyPaste={preventCopyPaste}
        preventClipboardShortcuts={preventClipboardShortcuts}
        sanitizeAlphaNumericSpace={sanitizeAlphaNumericSpace}
      />

      <SurveySubmitFooter
        visibleSubmitError={visibleSubmitError}
        submitting={submitting}
        canSubmit={canSubmit}
        submitLocked={submitLocked}
        isOnline={isOnline}
        handleSubmit={handleSubmit}
        getSubmitTooltip={getSubmitTooltip}
      />
    </div>
  );
}
