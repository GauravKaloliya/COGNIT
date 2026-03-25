import React from "react";
import PageSkeleton from "../components/PageSkeleton.jsx";
import PanelState from "../components/PanelState.jsx";
import { uiText } from "../utils/uiText";
import DSButton from "../components/design/DSButton.jsx";
import PageStatusBanners from "../components/PageStatusBanners.jsx";
import ButtonRetryBadge from "../components/ButtonRetryBadge.jsx";
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
    isOnline,
    pendingContinue,
    pendingFinish,
    retryCountdownContinue,
    retryCountdownFinish,
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
      <PageStatusBanners
        isOnline={isOnline}
        offlineMessage={uiText("finish.offlineBanner")}
      />
      <div className="finish-wrapper guidance">
        <h2>{uiText("finish.thankYouTitle")}</h2>
        <p className="page-subtitle">
          {uiText("finish.pageSubtitle", { count: surveyCompleted, suffix: surveyCompleted !== 1 ? "s" : "" })}
        </p>

        <PanelState
          variant="success"
          icon="✓"
          title={uiText("finish.thanks")}
          message={uiText("finish.responsesRecorded")}
        />
        <p className="debrief">{uiText("finish.debrief")}</p>
        <PageActions sticky inline className="survey-feedback-actions">
          <DSButton
            className="primary"
            onClick={handleSurveyContinue}
            disabled={loadingNext || !isOnline}
          >
            {loadingNext
              ? uiText("survey.loading")
              : !isOnline && pendingContinue
                ? (retryCountdownContinue > 0
                  ? uiText("common.tryAgainIn", { seconds: retryCountdownContinue })
                  : uiText("survey.feedOfflineContinue"))
                : uiText("common.continue")}
            {!isOnline && pendingContinue && <ButtonRetryBadge seconds={retryCountdownContinue} />}
          </DSButton>
          <DSButton
            variant="ghost"
            className="survey-feedback-finish"
            onClick={handleSurveyFinish}
            disabled={loadingNext || !isOnline}
          >
            {!isOnline && pendingFinish
              ? (retryCountdownFinish > 0
                ? uiText("common.tryAgainIn", { seconds: retryCountdownFinish })
                : uiText("finish.offlineFinishMessage"))
              : uiText("finish.finishButton")}
            {!isOnline && pendingFinish && <ButtonRetryBadge seconds={retryCountdownFinish} />}
          </DSButton>
        </PageActions>
        {!isOnline && (
          <div className="banner warning">
            <span>{uiText("finish.offlineFinishMessage")}</span>
          </div>
        )}
        {continueError && (
          <div className="card">
            <div className="card-header">
              <PanelState
                variant="warning"
                title={uiText("survey.unableLoadNext")}
                message={uiText("survey.feedLoadFailedWithHint", { error: continueError })}
                actionLabel={retryCountdownContinue > 0
                  ? uiText("common.tryAgainIn", { seconds: retryCountdownContinue })
                  : null}
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
