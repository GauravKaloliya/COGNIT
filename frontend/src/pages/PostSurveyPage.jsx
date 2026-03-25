import React from "react";
import PageSkeleton from "../components/PageSkeleton.jsx";
import PanelState from "../components/PanelState.jsx";
import { uiText } from "../utils/uiText";
import DSButton from "../components/design/DSButton.jsx";
import PageActions from "../components/PageActions.jsx";
import { usePostSurveyPage } from "../hooks/usePostSurveyPage";

export default function PostSurveyPage({
  surveyCompleted = 0,
  publicId = "",
  clearUserStorage = null,
  setSurveyFeedbackReady = null,
  setStage = null,
  fetchNextSurvey = null,
}) {
  const {
    loadingNext,
    continueError,
    handleSurveyContinue,
    handleSurveyFinish,
  } = usePostSurveyPage({
    publicId,
    clearUserStorage,
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
    <div className="panel finish-panel survey-feed-panel">
      <div className="finish-wrapper guidance">
        <h2>{uiText("finish.thankYouTitle")}</h2>

        <PanelState
          variant="success"
          icon="✓"
          title=""
          message={uiText("finish.responsesRecorded")}
        />
        <p className="page-subtitle">
          {uiText("finish.pageSubtitle", { count: surveyCompleted, suffix: surveyCompleted !== 1 ? "s" : "" })}
        </p>
        <p className="debrief">{uiText("finish.debrief")}</p>
        <PageActions sticky inline className="survey-feedback-actions">
          <DSButton
            className="primary"
            onClick={handleSurveyContinue}
            disabled={loadingNext}
          >
            {loadingNext ? uiText("survey.loading") : uiText("common.continue")}
          </DSButton>
          <DSButton
            variant="ghost"
            className="survey-feedback-finish"
            onClick={handleSurveyFinish}
            disabled={loadingNext}
          >
            {uiText("finish.finishButton")}
          </DSButton>
        </PageActions>
        {continueError && (
          <div className="card">
            <div className="card-header">
              <PanelState
                variant="warning"
                title={uiText("survey.unableLoadNext")}
                message={uiText("survey.feedLoadFailedWithHint", { error: continueError })}
                actionLabel={null}
                onAction={null}
                disabled
              />
            </div>
            <div className="card-body">
              <p className="helper-text">{uiText("survey.guidanceTitle")}</p>
              <ul className="guidance-list">
                <li>{uiText("survey.guidanceCheckConnection")}</li>
                <li>{uiText("survey.guidanceContinueLater")}</li>
                <li>{uiText("survey.guidanceSupport")}</li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
