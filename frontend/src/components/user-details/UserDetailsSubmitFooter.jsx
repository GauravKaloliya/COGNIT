import React from "react";
import PageActions from "../PageActions.jsx";
import DSButton from "../design/DSButton.jsx";

export default function UserDetailsSubmitFooter({
  errors,
  showOtpField,
  submitDisabled,
  handleSubmit,
  submitLabel,
}) {
  return (
    <PageActions sticky>
      {errors.general && <span className="error-text">{errors.general}</span>}
      {!showOtpField && (
        <DSButton variant="primary" onClick={handleSubmit} disabled={submitDisabled}>
          {submitLabel}
        </DSButton>
      )}
    </PageActions>
  );
}
