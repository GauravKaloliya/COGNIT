import React from "react";
import PageActions from "../PageActions.jsx";
import DSButton from "../design/DSButton.jsx";

export default function UserDetailsSubmitFooter({
  errors,
  showOtpField,
  submitDisabled,
  submitting,
  handleSubmit,
  submitLabel,
}) {
  return (
    <PageActions sticky className={`actions survey-submit-actions survey-sticky-footer ${submitting ? "is-submitting" : ""}`}>
      {errors.general && <span className="error-text">{errors.general}</span>}
      {!showOtpField && (
        <DSButton
          variant="primary"
          className={`primary survey-submit-button ${submitting ? "wiggle is-submitting" : ""}`}
          onClick={handleSubmit}
          disabled={submitDisabled}
        >
          {submitting ? (
            <>
              <span className="button-spinner" />
              {submitLabel}
            </>
          ) : submitLabel}
        </DSButton>
      )}
    </PageActions>
  );
}
