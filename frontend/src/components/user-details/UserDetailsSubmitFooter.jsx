import React from "react";
import { uiText } from "../../utils/uiText.js";
import PageActions from "../PageActions.jsx";
import DSButton from "../design/DSButton.jsx";
import ButtonRetryBadge from "../ButtonRetryBadge.jsx";

export default function UserDetailsSubmitFooter({
  errors,
  showOtpField,
  submitDisabled,
  handleSubmit,
  submitLabel,
  isOnline,
  retryCountdown,
}) {
  return (
    <PageActions sticky>
      {errors.general && <span className="error-text">{errors.general}</span>}
      {!showOtpField && (
        <>
          <DSButton variant="primary" onClick={handleSubmit} disabled={submitDisabled}>
            {submitLabel}
            {!isOnline && <ButtonRetryBadge seconds={retryCountdown} />}
          </DSButton>
          {!isOnline && (
            <div className="helper-text">
              {retryCountdown > 0
                ? uiText("common.tryAgainIn", { seconds: retryCountdown })
                : uiText("user.offlineBanner")}
            </div>
          )}
        </>
      )}
    </PageActions>
  );
}
