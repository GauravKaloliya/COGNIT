import React from "react";
import PanelState from "../components/PanelState.jsx";
import { useFinishedPage } from "../hooks/useFinishedPage";
import { uiText } from "../utils/uiText";
import DSButton from "../components/design/DSButton.jsx";

export default function FinishedPage({ surveyCompleted, publicId, clearUserStorage }) {
  const { isOnline, rewardAmountLabel, handleFinish } = useFinishedPage({ publicId, clearUserStorage });

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
            <li>{uiText("finish.rewardBullet1", { amount: rewardAmountLabel })}</li>
            <li>{uiText("finish.rewardBullet2")}</li>
            <li>{uiText("finish.rewardBullet3")}</li>
            <li>{uiText("finish.rewardBullet4")}</li>
            <li>{uiText("finish.rewardBullet5")}</li>
          </ul>
          </div>
        </div>

        <p className="debrief">{uiText("finish.debrief")}</p>

        <div className="page-actions sticky-mobile-actions inline-actions">
          <DSButton variant="primary" onClick={handleFinish} disabled={!isOnline}>
            {uiText("finish.finishButton")}
          </DSButton>
          {!isOnline && (
            <div className="banner warning">
              <span>{uiText("finish.offlineFinishMessage")}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
