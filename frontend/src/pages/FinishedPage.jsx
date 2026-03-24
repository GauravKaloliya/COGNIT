import React from "react";
import PanelState from "../components/PanelState.jsx";
import { useFinishedPage } from "../hooks/useFinishedPage";
import { uiText } from "../utils/uiText";
import DSButton from "../components/design/DSButton.jsx";
import PageStatusBanners from "../components/PageStatusBanners.jsx";
import PageActions from "../components/PageActions.jsx";

export default function FinishedPage({ surveyCompleted, publicId, clearUserStorage }) {
  const { isOnline, handleFinish } = useFinishedPage({ publicId, clearUserStorage });

  return (
    <div className="panel finish-panel">
      <PageStatusBanners
        isOnline={isOnline}
        offlineMessage={uiText("finish.offlineBanner")}
      />
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
        <p className="debrief">{uiText("finish.debrief")}</p>

        <PageActions sticky inline>
          <DSButton variant="primary" onClick={handleFinish} disabled={!isOnline}>
            {uiText("finish.finishButton")}
          </DSButton>
          {!isOnline && (
            <div className="banner warning">
              <span>{uiText("finish.offlineFinishMessage")}</span>
            </div>
          )}
        </PageActions>
      </div>
    </div>
  );
}
