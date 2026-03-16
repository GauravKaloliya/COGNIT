import React from "react";
import PageSkeleton from "../components/PageSkeleton.jsx";
import PanelState from "../components/PanelState.jsx";
import { useSurveyFeedPage } from "../hooks/useSurveyFeedPage";
import { uiText } from "../utils/uiText";

export default function SurveyFeedPage({
  surveyCompleted = 0,
  setSurveyFeedbackReady,
  setStage,
  fetchNextSurvey,
}) {
  const {
    minWords: MIN_WORDS,
    loadingNext,
    continueError,
    isOnline,
    handleSurveyContinue,
    handleSurveyFinish,
  } = useSurveyFeedPage({
    setSurveyFeedbackReady,
    setStage,
    fetchNextSurvey,
  });

  if (loadingNext) {
    return (
      <PageSkeleton
        title={uiText("survey.loadingNext")}
        subtitle={uiText("survey.loadingNextSubtitle")}
        variant="survey"
      />
    );
  }

  return (
    <div className="panel survey-feed-panel">
      {!isOnline && (
        <div className="banner warning">
          <span>{uiText("survey.feedOffline")}</span>
        </div>
      )}
      <div className="guidance">
        <PanelState
          variant="success"
          icon="✓"
          title={uiText("survey.feedComplete")}
          message={uiText("survey.feedCompleteMessage", { count: surveyCompleted, suffix: surveyCompleted === 1 ? "" : "s" })}
        />
        <div className="survey-feedback-tip">
          <p>
            <em>Tip: Aim to describe colors, textures, relationships, and any notable objects.
            Remember to write at least {MIN_WORDS} words per description.</em>
          </p>
        </div>
        <div className="survey-feedback-actions">
          <button
            className="primary"
            onClick={handleSurveyContinue}
            disabled={loadingNext || !isOnline}
          >
            {loadingNext ? uiText("survey.loading") : uiText("survey.continue")}
          </button>
          <button
            className="ghost survey-feedback-finish"
            onClick={handleSurveyFinish}
            disabled={loadingNext || !isOnline}
          >
            Finish
          </button>
        </div>
        {continueError && (
          <PanelState
            variant="warning"
            title={uiText("survey.unableLoadNext")}
            message={uiText("survey.feedLoadFailedWithHint", { error: continueError })}
            actionLabel={uiText("survey.retryShort")}
            onAction={handleSurveyContinue}
            disabled={loadingNext}
          />
        )}
      </div>
    </div>
  );
}
