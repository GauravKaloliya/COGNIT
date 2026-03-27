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
  isTransitioningToNext = false,
}) {
  const profileRender = useRenderProfiler("SurveyPage", 20);
  const [showDeferredDecorations, setShowDeferredDecorations] = React.useState(false);
  const {
    constants,
    formState,
    mediaState,
    fieldRefs,
    handlers,
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
  const {
    description,
    difficultyRating,
    confidenceRating,
    comments,
    submitting,
    submitError,
    showValidationErrors,
    elapsed,
    wordCount,
    charCount,
    commentsCharCount,
    canSubmit,
    currentStep,
    minimumMet,
    submitLocked,
    formDisabled,
    inputsDisabled,
    saveError,
    optimisticMessage,
  } = formState;
  const {
    isZoomed,
    imageLoaded,
    imageError,
    imageReady,
    retryExhausted,
    imagePanelErrorMessage,
    retryDisabled,
    retryCountdown,
    imageElementRef,
    imageSrc,
    hasUsableSurveyImage,
  } = mediaState;
  const { descriptionRef, commentsRef } = fieldRefs;
  const {
    setDescription,
    setDifficultyRating,
    setConfidenceRating,
    setComments,
    setIsZoomed,
    handleSubmit,
    handleImageLoad,
    handleImageError,
    handleRetryImage,
    getSubmitTooltip,
    preventCopyPaste,
    preventClipboardShortcuts,
    touchField,
  } = handlers;

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
  const surveyImageId = survey?.image_id || survey?.imageId || "";

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
  if (isTransitioningToNext || !survey || !surveyImageId || !hasUsableSurveyImage) {
    const retryLabel = retryDisabled && retryCountdown > 0
      ? uiText("common.tryAgainIn", { seconds: retryCountdown })
      : uiText("common.retry");
    return (
      <div className="panel status-panel">
        <AsyncStatePanel
          loading={isFetchingImage || !surveyImageId}
          error={visibleFetchError || (surveyImageId && !imageSrc ? uiText("survey.imageRestoreFailed") : "")}
          retryLabel={retryLabel}
          onRetry={handleRetryImage}
          retryDisabled={retryDisabled}
        />
      </div>
    );
  }

  return (
    <div className="panel survey-page-panel survey-stage-shell">
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {optimisticMessage || visibleSubmitError}
      </div>
      <div className="stage-section" style={{ "--section-index": 0 }}>
        <PageStatusBanners
          saveError={deferredSaveError}
        />
      </div>
      <div className="meta meta-step-top stage-section" style={{ "--section-index": 1 }}>
        <span className="step-chip">{uiText("survey.stepLabel", { current: currentStep, total: UI_TOTAL_STEPS })}</span>
      </div>
      <div className="stage-section parallax-deep survey-image-stage" style={{ "--section-index": 2 }}>
        <SurveyImagePanel
          imageSrc={imageSrc}
          imageLoaded={imageLoaded}
          imageError={imageError}
          showImageError={retryExhausted}
          errorMessage={imagePanelErrorMessage}
          isZoomed={isZoomed}
          setIsZoomed={setIsZoomed}
          retryDisabled={retryDisabled}
          imageRef={imageElementRef}
        handleRetryImage={handleRetryImage}
        handleImageLoad={handleImageLoad}
        handleImageError={handleImageError}
      />
      </div>

      <div className="meta meta-timer-row stage-section" style={{ "--section-index": 3 }}>
        <span className="timer">{uiText("survey.timeElapsed", { seconds: elapsed })}</span>
      </div>

      {minimumMet && showDeferredDecorations && (
        <div className="survey-badges stage-section" style={{ "--section-index": 4 }}>
          {minimumMet && <span className="status-badge met">{uiText("survey.minimumMet")}</span>}
        </div>
      )}

      <React.Profiler id="survey-fields" onRender={profileRender}>
        <div className="stage-section" style={{ "--section-index": 5 }}>
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
            disabled={inputsDisabled}
            copyPasteDisabled={COPY_PASTE_DISABLED}
            preventCopyPaste={preventCopyPaste}
            preventClipboardShortcuts={preventClipboardShortcuts}
            sanitizeAlphaNumericSpace={sanitizeAlphaNumericSpace}
            onBlur={() => touchField("description")}
          />
        </div>

        <div className="stage-section" style={{ "--section-index": 6 }}>
          <SurveyRatingField
            difficultyRating={difficultyRating}
            setDifficultyRating={setDifficultyRating}
            confidenceRating={confidenceRating}
            setConfidenceRating={setConfidenceRating}
            imageReady={imageReady}
            disabled={inputsDisabled}
            onDifficultyBlur={() => touchField("difficulty")}
            onConfidenceBlur={() => touchField("confidence")}
          />
        </div>

        <div className="stage-section" style={{ "--section-index": 7 }}>
          <SurveyCommentsField
            comments={comments}
            setComments={setComments}
            commentsRef={commentsRef}
            showValidationErrors={showValidationErrors}
            minFeedbackLength={MIN_FEEDBACK_LENGTH}
            maxFeedbackLength={MAX_FEEDBACK_LENGTH}
            commentsCharCount={commentsCharCount}
            imageReady={imageReady}
            disabled={inputsDisabled}
            copyPasteDisabled={COPY_PASTE_DISABLED}
            preventCopyPaste={preventCopyPaste}
            preventClipboardShortcuts={preventClipboardShortcuts}
            sanitizeAlphaNumericSpace={sanitizeAlphaNumericSpace}
            onBlur={() => touchField("comments")}
          />
        </div>
      </React.Profiler>

      <div className="stage-section" style={{ "--section-index": 8 }}>
        <SurveySubmitFooter
          visibleSubmitError={visibleSubmitError}
          submitting={submitting}
          canSubmit={canSubmit}
          submitLocked={submitLocked || formDisabled}
          handleSubmit={handleSubmit}
          getSubmitTooltip={getSubmitTooltip}
        />
      </div>
    </div>
  );
}
