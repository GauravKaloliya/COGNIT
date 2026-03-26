import React from "react";
import { uiText } from "../../utils/uiText.js";
import DSButton from "../design/DSButton.jsx";
import PageActions from "../PageActions.jsx";

export default function SurveySubmitFooter({
  visibleSubmitError,
  submitting,
  canSubmit,
  submitLocked,
  handleSubmit,
  getSubmitTooltip,
}) {
  return (
    <>
      {visibleSubmitError && <div className="banner warning">{visibleSubmitError}</div>}

      <PageActions sticky className={`actions survey-submit-actions survey-sticky-footer ${submitting ? "is-submitting" : ""} ${submitLocked ? "is-locked" : ""}`}>
        <div className="submit-info-box">
          <p className="submit-shortcut-hint">{uiText("survey.submitShortcut")}</p>
        </div>
        <DSButton
          className={`primary survey-submit-button ${submitting ? "wiggle is-submitting" : ""}`}
          onClick={handleSubmit}
          disabled={!canSubmit || submitLocked}
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
