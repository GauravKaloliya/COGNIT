import React from "react";
import PageSkeleton from "../components/PageSkeleton.jsx";
import PanelState from "../components/PanelState.jsx";
import { useSurveyFeedPage } from "../hooks/useSurveyFeedPage";
import { uiText } from "../utils/uiText";
import DSButton from "../components/design/DSButton.jsx";
import PageStatusBanners from "../components/PageStatusBanners.jsx";
import ButtonRetryBadge from "../components/ButtonRetryBadge.jsx";
import PageActions from "../components/PageActions.jsx";

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
    pendingContinue,
    pendingFinish,
    retryCountdownContinue,
    retryCountdownFinish,
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
      <PageStatusBanners
        isOnline={isOnline}
        offlineMessage={uiText("survey.feedOffline")}
      />
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
        <PageActions sticky inline className="survey-feedback-actions">
          <DSButton
            className="primary"
            onClick={handleSurveyContinue}
            disabled={loadingNext || !isOnline}
          >
            {loadingNext
              ? uiText("survey.loading")
              : !isOnline && pendingContinue && retryCountdownContinue > 0
                ? uiText("common.tryAgainIn", { seconds: retryCountdownContinue })
                : uiText("common.continue")}
            {!isOnline && pendingContinue && <ButtonRetryBadge seconds={retryCountdownContinue} />}
          </DSButton>
          <DSButton
            variant="ghost"
            className="survey-feedback-finish"
            onClick={handleSurveyFinish}
            disabled={loadingNext || !isOnline}
          >
            {!isOnline && pendingFinish && retryCountdownFinish > 0
              ? uiText("common.tryAgainIn", { seconds: retryCountdownFinish })
              : uiText("common.finish")}
            {!isOnline && pendingFinish && <ButtonRetryBadge seconds={retryCountdownFinish} />}
          </DSButton>
        </PageActions>
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
              <ul className="payment-list">
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
