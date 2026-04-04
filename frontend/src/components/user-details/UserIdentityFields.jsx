import React from "react";
import { uiText } from "../../utils/uiText.js";

function UserIdentityFields({
  username,
  email,
  usernameError,
  emailError,
  optionsLoading,
  checking,
  inputsLocked,
  emailInputDisabled,
  usernameOk,
  emailFormatHintVisible,
  usernameMin,
  showEmailGhost,
  emailPlaceholderDomain,
  emailPlaceholderIndex,
  updateField,
  handleFieldBlur,
  sanitizeUsername,
  setEmailFocused,
}) {
  return (
    <>
      <div className={`form-field username-field ${usernameError ? "error" : ""} ${optionsLoading ? "loading" : ""}`}>
        <label>{uiText("user.username")} <span className="required" aria-label={uiText("common.requiredAria")}>*</span></label>
        <input
          type="text"
          className={usernameError ? "error-input" : ""}
          placeholder={uiText("user.usernamePlaceholder")}
          value={username || ""}
          disabled={inputsLocked}
          onChange={(e) => updateField("username", sanitizeUsername(e.target.value))}
          onBlur={(e) => handleFieldBlur("username", e.target.value, true)}
        />
        {checking.username && <span className="checking-text">{uiText("user.checking")}</span>}
        {usernameError && <span className="error-text">{usernameError}</span>}
        {!usernameOk && (
          <span className="helper-text warning">{uiText("user.usernameHint", { min: usernameMin })}</span>
        )}
      </div>

      <div className={`form-field email-field ${emailError ? "error" : ""} ${optionsLoading ? "loading" : ""}`}>
        <label>{uiText("user.email")} <span className="required" aria-label={uiText("common.requiredAria")}>*</span></label>
        <div className="input-with-ghost">
          <input
            type="email"
            className={emailError ? "error-input" : ""}
            placeholder=""
            value={email || ""}
            disabled={emailInputDisabled}
            onChange={(e) => updateField("email", e.target.value)}
            onFocus={() => setEmailFocused(true)}
            onBlur={(e) => {
              setEmailFocused(false);
              handleFieldBlur("email", e.target.value, true);
            }}
          />
          {showEmailGhost && (
            <span className="ghost-placeholder simple">
              <span className="ghost-prefix">{uiText("user.emailGhostPrefix")}</span>
              <span key={emailPlaceholderIndex} className="ghost-domain simple-animate">{emailPlaceholderDomain}</span>
            </span>
          )}
        </div>
        {checking.email && <span className="checking-text">{uiText("user.checking")}</span>}
        {emailError && <span className="error-text">{emailError}</span>}
        {emailFormatHintVisible && <span className="helper-text warning">{uiText("user.emailHint")}</span>}
      </div>
    </>
  );
}

export default React.memo(UserIdentityFields);
