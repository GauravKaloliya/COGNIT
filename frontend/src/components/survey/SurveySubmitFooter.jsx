import React from "react";
import { uiText } from "../../utils/uiText.js";
import DSButton from "../design/DSButton.jsx";
import PageActions from "../PageActions.jsx";

export default function SurveySubmitFooter({
  visibleSubmitError,
  submitting,
  canSubmit,
  submitLocked,
  submitBlockReason,
  handleSubmit,
  getSubmitTooltip,
  optimisticMessage,
}) {
  const activeLabel = submitting && optimisticMessage ? optimisticMessage : uiText("survey.submitBusy");
  return (
    <>
      {visibleSubmitError && <div className="banner warning">{visibleSubmitError}</div>}
      {!visibleSubmitError && !canSubmit && !submitting && submitBlockReason && (
        <div className="banner warning">{submitBlockReason}</div>
      )}

      <PageActions sticky className={`actions survey-submit-actions survey-sticky-footer ${submitting ? "is-submitting" : ""} ${submitLocked ? "is-locked" : ""}`}>
        <DSButton
          className={`primary survey-submit-button ${submitting ? "wiggle is-submitting" : ""}`}
          onClick={handleSubmit}
          disabled={submitLocked}
          title={getSubmitTooltip()}
        >
          {submitting ? (
            <>
              <span className="button-spinner" />
              {activeLabel}
            </>
          ) : submitLocked ? uiText("survey.submitLocked") : uiText("survey.submit")}
        </DSButton>
      </PageActions>
    </>
  );
}
