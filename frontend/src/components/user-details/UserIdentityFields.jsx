import React from "react";
import { uiText } from "../../utils/uiText.js";

export default function UserIdentityFields({
  demographics,
  errors,
  optionsLoading,
  checking,
  inputsLocked,
  emailInputDisabled,
  usernameOk,
  emailOk,
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
      <div className={`form-field username-field ${errors.username ? "error" : ""} ${optionsLoading ? "loading" : ""}`}>
        <label>{uiText("user.username")} <span className="required" aria-label="required">*</span></label>
        <input
          type="text"
          className={errors.username ? "error-input" : ""}
          placeholder={uiText("user.usernamePlaceholder")}
          value={demographics.username || ""}
          disabled={inputsLocked}
          onChange={(e) => updateField("username", sanitizeUsername(e.target.value))}
          onBlur={(e) => handleFieldBlur("username", e.target.value, true)}
        />
        {checking.username && <span className="checking-text">{uiText("user.checking")}</span>}
        {errors.username && <span className="error-text">{errors.username}</span>}
        {!usernameOk && (
          <span className="helper-text warning">{uiText("user.usernameHint", { min: usernameMin })}</span>
        )}
      </div>

      <div className={`form-field email-field ${errors.email ? "error" : ""} ${optionsLoading ? "loading" : ""}`}>
        <label>{uiText("user.email")} <span className="required" aria-label="required">*</span></label>
        <div className="input-with-ghost">
          <input
            type="email"
            className={errors.email ? "error-input" : ""}
            placeholder=""
            value={demographics.email || ""}
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
        {errors.email && <span className="error-text">{errors.email}</span>}
        {!emailOk && <span className="helper-text warning">{uiText("user.emailHint")}</span>}
      </div>
    </>
  );
}
