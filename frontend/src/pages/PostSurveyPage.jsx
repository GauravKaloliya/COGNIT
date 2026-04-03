import React from "react";
import PanelState from "../components/PanelState.jsx";
import { uiText } from "../utils/uiText";
import DSButton from "../components/design/DSButton.jsx";
import PageActions from "../components/PageActions.jsx";
import { usePostSurveyPage } from "../hooks/usePostSurveyPage";

export default function PostSurveyPage({
  surveyCompleted = 0,
  email = "",
  clearUserStorage = null,
  resetWorkflowToConsent = null,
}) {
  const {
    handleSurveyFinish,
  } = usePostSurveyPage({
    clearUserStorage,
    resetWorkflowToConsent,
  });
  const reportItems = React.useMemo(() => ([
    {
      title: uiText("finish.reportItem1Title"),
      description: uiText("finish.reportItem1Description"),
    },
    {
      title: uiText("finish.reportItem2Title"),
      description: uiText("finish.reportItem2Description"),
    },
    {
      title: uiText("finish.reportItem3Title"),
      description: uiText("finish.reportItem3Description"),
    },
    {
      title: uiText("finish.reportItem4Title"),
      description: uiText("finish.reportItem4Description"),
    },
    {
      title: uiText("finish.reportItem5Title"),
      description: uiText("finish.reportItem5Description"),
    },
  ]), []);
  const privacyItems = React.useMemo(() => ([
    uiText("finish.privacyItem1"),
    uiText("finish.privacyItem2"),
    uiText("finish.privacyItem3"),
    uiText("finish.privacyItem4"),
    uiText("finish.privacyItem5"),
  ]), []);

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
        <section className="report-explainer" aria-labelledby="report-explainer-title">
          <div className="report-explainer-masthead">
            <div className="report-explainer-kicker">{uiText("finish.reportExplainerKicker")}</div>
            <div className="report-explainer-meta">
              <span>{uiText("finish.reportExplainerMetaType")}</span>
              <span>{uiText("finish.reportExplainerMetaDelivery")}</span>
            </div>
          </div>
          <div className="report-explainer-header">
            <div>
              <span className="status-badge met">{uiText("finish.reportExplainerBadge")}</span>
              <h3 id="report-explainer-title">{uiText("finish.reportExplainerTitle")}</h3>
            </div>
            <p className="report-explainer-intro">{uiText("finish.reportExplainerIntro")}</p>
          </div>
          <ol className="report-explainer-list">
            {reportItems.map((item, index) => (
              <li key={item.title} className="report-explainer-item">
                <div className="report-explainer-index" aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </div>
                <div className="report-explainer-body">
                  <strong>{item.title}</strong>
                  <span>{item.description}</span>
                </div>
              </li>
            ))}
          </ol>
        </section>
        <section className="privacy-explainer" aria-labelledby="privacy-explainer-title">
          <div className="privacy-explainer-header">
            <span className="status-badge met">{uiText("finish.privacyBadge")}</span>
            <h3 id="privacy-explainer-title">{uiText("finish.privacyTitle")}</h3>
          </div>
          <p className="privacy-explainer-intro">{uiText("finish.privacyIntro")}</p>
          <ul className="privacy-explainer-list">
            {privacyItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
        <p className="debrief">{uiText("finish.debrief")}</p>
        <PageActions sticky inline className="survey-feedback-actions">
          <DSButton
            variant="primary"
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
