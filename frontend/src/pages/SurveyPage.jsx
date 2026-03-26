import React from "react";
import { uiText } from "../utils/uiText.js";
import PageStatusBanners from "../components/PageStatusBanners.jsx";
import { sanitizeAlphaNumericSpace, useSurveyPage } from "../hooks/useSurveyPage";
import SurveyImagePanel from "../components/survey/SurveyImagePanel.jsx";
import SurveyDescriptionField from "../components/survey/SurveyDescriptionField.jsx";
import SurveyRatingField from "../components/survey/SurveyRatingField.jsx";
import SurveyCommentsField from "../components/survey/SurveyCommentsField.jsx";
import SurveySubmitFooter from "../components/survey/SurveySubmitFooter.jsx";
import { useRenderProfiler } from "../hooks/useRenderProfiler.js";
import AsyncStatePanel from "../components/AsyncStatePanel.jsx";
import { prefetchBehaviorChunks } from "../components/app/AppStageRouter.jsx";

export default function SurveyPage({
  survey,
  publicId,
  surveyCompleted = 0,
  onSubmit,
  onAccountFlagged = null,
  onRetry = null,
  onWarmNextSurvey = null,
  fetchError = null,
  isFetchingImage = false,
}) {
  const profileRender = useRenderProfiler("SurveyPage", 20);
  const [showDeferredDecorations, setShowDeferredDecorations] = React.useState(false);
  const {
    constants,
    description,
    setDescription,
    difficultyRating,
    setDifficultyRating,
    confidenceScore,
    setConfidenceScore,
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
    retryExhausted,
    imagePanelErrorMessage,
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
    saveError,
    optimisticMessage,
    touchField,
  } = useSurveyPage({
    survey,
    publicId,
    surveyCompleted,
    onSubmit,
    onAccountFlagged,
    onRetry,
    onWarmNextSurvey,
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
  const visibleFetchError = fetchError === "image_unavailable"
    ? uiText("survey.feedLoadFailed")
    : fetchError;
  const deferredSaveError = React.useDeferredValue(saveError);

  React.useEffect(() => {
    prefetchBehaviorChunks({
      fromStage: "survey",
      surveyLikelyComplete: minimumMet,
    });
  }, [minimumMet]);

  React.useEffect(() => {
    if (!minimumMet) {
      setShowDeferredDecorations(false);
      return undefined;
    }
    let timeoutId = null;
    let idleId = null;
    const run = () => {
      React.startTransition(() => {
        setShowDeferredDecorations(true);
      });
    };
    if (typeof window.requestIdleCallback === "function") {
      idleId = window.requestIdleCallback(run, { timeout: 350 });
    } else {
      timeoutId = window.setTimeout(run, 180);
    }
    return () => {
      if (idleId !== null && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [minimumMet]);

  // Show loading state if we're waiting for survey data
  if (!survey || !survey.image_id || !hasUsableSurveyImage) {
    const retryLabel = retryDisabled && retryCountdown > 0
      ? uiText("common.tryAgainIn", { seconds: retryCountdown })
      : uiText("common.retry");
    return (
      <div className="panel status-panel">
        <AsyncStatePanel
          loading={isFetchingImage || !survey?.image_id}
          error={visibleFetchError || (survey?.image_id && !imageSrc ? uiText("survey.imageRestoreFailed") : "")}
          retryLabel={retryLabel}
          onRetry={handleRetryImage}
          retryDisabled={retryDisabled}
        />
      </div>
    );
  }

  return (
    <div className="panel survey-page-panel">
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {optimisticMessage || visibleSubmitError}
      </div>
      <PageStatusBanners
        saveError={deferredSaveError}
      />
      <div className="meta meta-step-top">
        <span className="step-chip">{uiText("survey.stepLabel", { current: currentStep, total: UI_TOTAL_STEPS })}</span>
      </div>
        <SurveyImagePanel
          imageSrc={imageSrc}
          imageLoaded={imageLoaded}
          imageError={imageError}
          showImageError={retryExhausted}
          errorMessage={imagePanelErrorMessage}
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

      {minimumMet && showDeferredDecorations && (
        <div className="survey-badges">
          {minimumMet && <span className="status-badge met">{uiText("survey.minimumMet")}</span>}
        </div>
      )}

      <React.Profiler id="survey-fields" onRender={profileRender}>
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
          disabled={formDisabled}
          copyPasteDisabled={COPY_PASTE_DISABLED}
          preventCopyPaste={preventCopyPaste}
          preventClipboardShortcuts={preventClipboardShortcuts}
          sanitizeAlphaNumericSpace={sanitizeAlphaNumericSpace}
          onBlur={() => touchField("description")}
        />

        <SurveyRatingField
          difficultyRating={difficultyRating}
          setDifficultyRating={setDifficultyRating}
          confidenceScore={confidenceScore}
          setConfidenceScore={setConfidenceScore}
          imageReady={imageReady}
          disabled={formDisabled}
          onDifficultyBlur={() => touchField("difficulty")}
          onConfidenceBlur={() => touchField("confidence")}
        />

        <SurveyCommentsField
          comments={comments}
          setComments={setComments}
          commentsRef={commentsRef}
          showValidationErrors={showValidationErrors}
          minFeedbackLength={MIN_FEEDBACK_LENGTH}
          maxFeedbackLength={MAX_FEEDBACK_LENGTH}
          commentsCharCount={commentsCharCount}
          imageReady={imageReady}
          disabled={formDisabled}
          copyPasteDisabled={COPY_PASTE_DISABLED}
          preventCopyPaste={preventCopyPaste}
          preventClipboardShortcuts={preventClipboardShortcuts}
          sanitizeAlphaNumericSpace={sanitizeAlphaNumericSpace}
          onBlur={() => touchField("comments")}
        />
      </React.Profiler>

      <SurveySubmitFooter
        visibleSubmitError={visibleSubmitError}
        submitting={submitting}
        canSubmit={canSubmit}
        submitLocked={submitLocked || formDisabled}
        handleSubmit={handleSubmit}
        getSubmitTooltip={getSubmitTooltip}
      />
    </div>
  );
}
