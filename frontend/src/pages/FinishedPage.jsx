import React from "react";
import PanelState from "../components/PanelState.jsx";
import { useFinishedPage } from "../hooks/useFinishedPage";
import { uiText } from "../utils/uiText";
import DSButton from "../components/design/DSButton.jsx";

export default function FinishedPage({ surveyCompleted, publicId }) {
  const { isOnline, rewardAmountLabel, handleFinish } = useFinishedPage({ publicId });

  return (
    <div className="panel finish-panel">
      {!isOnline && (
        <div className="banner warning">
          <span>{uiText("finish.offlineBanner")}</span>
        </div>
      )}
      <div className="finish-wrapper">
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

        <div className="finish-reminder card">
          <div className="card-header">
            <h4><span className="icon-badge" aria-hidden="true">🏆</span> {uiText("finish.rewardHeading")}</h4>
          </div>
          <div className="card-body">
          <ul>
            <li>Participants are <strong>randomly selected</strong> to receive <strong>{rewardAmountLabel} rewards</strong></li>
            <li>Active participants who write detailed descriptions get added to a <strong>priority list</strong></li>
            <li>Priority participants have <strong>higher chances</strong> of being selected</li>
            <li>Rewards are sent via <strong>UPI transfer</strong> within 24-48 hours</li>
            <li>If you&apos;re selected, you&apos;ll receive an email/SMS with payment confirmation</li>
          </ul>
          </div>
        </div>

        <p className="debrief">
          Debrief: C.O.G.N.I.T. (Cognitive Network for Image & Text Modeling)
          advances our understanding of how humans describe visual content and how AI can better model this cognitive process. Your responses
          contribute to improving image-text understanding and generation systems.
        </p>

        <div className="page-actions sticky-mobile-actions inline-actions">
          <DSButton variant="primary" onClick={handleFinish}>
            {uiText("finish.finishButton")}
          </DSButton>
        </div>
      </div>
    </div>
  );
}
