import React from "react";
import PanelState from "../components/PanelState.jsx";
import { uiText } from "../utils/uiText";
import DSButton from "../components/design/DSButton.jsx";
import PageActions from "../components/PageActions.jsx";
import { usePostSurveyPage } from "../hooks/usePostSurveyPage";

export default function PostSurveyPage({
  surveyCompleted = 0,
  publicId = "",
  email = "",
  clearUserStorage = null,
  resetWorkflowToConsent = null,
}) {
  const {
    handleSurveyFinish,
  } = usePostSurveyPage({
    publicId,
    clearUserStorage,
    resetWorkflowToConsent,
  });

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
        <div className="finish-report-notice" role="status" aria-live="polite">
          {uiText("finish.reportNotice", { email: email || "your registered email" })}
        </div>
        <p className="debrief">{uiText("finish.debrief")}</p>
        <PageActions sticky inline className="survey-feedback-actions">
          <DSButton
            variant="ghost"
            className="survey-feedback-finish"
            onClick={handleSurveyFinish}
          >
            {uiText("finish.finishButton")}
          </DSButton>
        </PageActions>
      </div>
    </div>
  );
}
