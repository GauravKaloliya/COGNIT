import React from "react";
import { uiText } from "../../utils/uiText.js";
import DSButton from "../design/DSButton.jsx";
import PageActions from "../PageActions.jsx";

export default function SurveySubmitFooter({
  visibleSubmitError,
  optimisticMessage,
  submitting,
  canSubmit,
  submitLocked,
  isOnline,
  handleSubmit,
  getSubmitTooltip,
}) {
  return (
    <>
      {visibleSubmitError && <div className="banner warning">{visibleSubmitError}</div>}
      {!visibleSubmitError && optimisticMessage ? <div className="banner info">{optimisticMessage}</div> : null}

      <PageActions sticky className="actions survey-submit-actions survey-sticky-footer">
        <div className="submit-info-box">
          <p className="submit-shortcut-hint">{uiText("survey.submitShortcut")}</p>
        </div>
        <DSButton
          className={`primary ${submitting ? "wiggle" : ""}`}
          onClick={handleSubmit}
          disabled={!canSubmit || submitLocked || !isOnline}
          title={getSubmitTooltip()}
        >
          {submitting ? (
            <>
              <span className="button-spinner" />
              {uiText("survey.submitBusy")}
            </>
          ) : submitLocked ? uiText("survey.submitLocked") : uiText("survey.submit")}
        </DSButton>
      </PageActions>
    </>
  );
}
