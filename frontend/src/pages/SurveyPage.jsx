import React from "react";
import { uiText } from "../utils/uiText.js";
import PageStatusBanners from "../components/PageStatusBanners.jsx";
import { sanitizeAlphaNumericSpace, sanitizeSurveyDescription, useSurveyPage } from "../hooks/useSurveyPage";
import SurveyImagePanel from "../components/survey/SurveyImagePanel.jsx";
import SurveyDescriptionField from "../components/survey/SurveyDescriptionField.jsx";
import SurveyRatingField from "../components/survey/SurveyRatingField.jsx";
import SurveyCommentsField from "../components/survey/SurveyCommentsField.jsx";
import SurveySubmitFooter from "../components/survey/SurveySubmitFooter.jsx";
import { useRenderProfiler } from "../hooks/useRenderProfiler.js";
import AsyncStatePanel from "../components/AsyncStatePanel.jsx";
import { prefetchBehaviorChunks } from "../components/app/AppStageRouter.jsx";
import { useIsMobile } from "../hooks/useIsMobile.js";

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
  const isMobile = useIsMobile();
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
    isFullscreen,
    imageLoaded,
    imageError,
    imageReady,
    retryExhausted,
    imagePanelErrorMessage,
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
    setIsFullscreen,
    handleSubmit,
    handleImageLoad,
    handleImageError,
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
  const remainingSurveys = Math.max(0, UI_TOTAL_STEPS - currentStep);
  const surveyProgressPercent = Math.min(100, Math.max(0, (currentStep / Math.max(UI_TOTAL_STEPS, 1)) * 100));
  const progressNotice = remainingSurveys > 0
    ? uiText(
      remainingSurveys === 1 ? "survey.remainingNotice" : "survey.remainingNoticePlural",
      { current: currentStep, total: UI_TOTAL_STEPS, remaining: remainingSurveys }
    )
    : uiText("survey.finalNotice");
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

  React.useLayoutEffect(() => {
    if (!isMobile || !surveyImageId) return;
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [isMobile, surveyImageId]);

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
    return (
      <div className="panel status-panel">
        <AsyncStatePanel
          loading={isFetchingImage || !surveyImageId}
          error={visibleFetchError || (surveyImageId && !imageSrc ? uiText("survey.imageRestoreFailed") : "")}
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
      <div className="stage-section" style={{ "--section-index": 2 }}>
        <div className="field-progress survey-progress-card">
          <div className="survey-progress-copy">
            <span className="step-chip">{uiText("survey.stepLabel", { current: currentStep, total: UI_TOTAL_STEPS })}</span>
            <div
              className="field-progress-track survey-progress-track"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(surveyProgressPercent)}
              aria-label={uiText("common.progress")}
            >
              <span
                className="field-progress-fill survey-progress-fill"
                style={{ width: `${surveyProgressPercent}%` }}
              />
            </div>
            <div className="survey-progress-notice">{progressNotice}</div>
          </div>
        </div>
      </div>
      <div className="stage-section parallax-deep survey-image-stage" style={{ "--section-index": 3 }}>
        <SurveyImagePanel
          imageSrc={imageSrc}
          imageLoaded={imageLoaded}
          imageError={imageError}
          showImageError={retryExhausted}
          errorMessage={imagePanelErrorMessage}
          isZoomed={isZoomed}
          isFullscreen={isFullscreen}
          setIsZoomed={setIsZoomed}
          setIsFullscreen={setIsFullscreen}
          imageRef={imageElementRef}
          handleImageLoad={handleImageLoad}
          handleImageError={handleImageError}
          copyPasteDisabled={COPY_PASTE_DISABLED}
          preventCopyPaste={preventCopyPaste}
        />
      </div>

      <div className="meta meta-timer-row stage-section" style={{ "--section-index": 4 }}>
        <span className="timer">{uiText("survey.timeElapsed", { seconds: elapsed })}</span>
      </div>

      {minimumMet && showDeferredDecorations && (
        <div className="survey-badges stage-section" style={{ "--section-index": 5 }}>
          {minimumMet && <span className="status-badge met">{uiText("survey.minimumMet")}</span>}
        </div>
      )}

      <React.Profiler id="survey-fields" onRender={profileRender}>
        <div className="stage-section" style={{ "--section-index": 6 }}>
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
            sanitizeSurveyDescription={sanitizeSurveyDescription}
            onBlur={() => touchField("description")}
          />
        </div>

        <div className="stage-section" style={{ "--section-index": 7 }}>
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

        <div className="stage-section" style={{ "--section-index": 8 }}>
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

      <div className="stage-section" style={{ "--section-index": 9 }}>
        <SurveySubmitFooter
          visibleSubmitError={visibleSubmitError}
          submitting={submitting}
          canSubmit={canSubmit}
          submitLocked={submitLocked || formDisabled}
          handleSubmit={handleSubmit}
          getSubmitTooltip={getSubmitTooltip}
          optimisticMessage={optimisticMessage}
        />
      </div>
    </div>
  );
}
