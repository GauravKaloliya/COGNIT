import React from "react";
import { sanitizeUsername, useUserDetailsPage } from "../hooks/useUserDetailsPage";
import { uiText } from "../utils/uiText";
import { PRIOR_EXPERIENCE_GROUPS, PRIOR_EXPERIENCE_NONE } from "../content/userDetailsOptions";
import DSButton from "../components/design/DSButton.jsx";
import { runtimeConfig } from "../config/runtime";

export default function UserDetailsPage({
  publicId,
  demographics,
  setDemographics,
  onSubmit,
  onEmailVerified,
  addToast,
  systemReady,
  onBack
}) {
  const [emailFocused, setEmailFocused] = React.useState(false);
  const [emailPlaceholderIndex, setEmailPlaceholderIndex] = React.useState(0);
  const [emailPlaceholderTick, setEmailPlaceholderTick] = React.useState(0);
  const {
    constants,
    isOnline,
    genderOptions,
    languageOptions,
    optionsLoading,
    errors,
    submitting,
    checking,
    locating,
    locationStatus,
    locationPermissionDenied,
    manualLocationAllowed,
    userEditedLocationRef,
    isFormComplete,
    detectLocation,
    otpDigits,
    otpLength,
    showOtpField,
    otpStatus,
    otpError,
    resendSeconds,
    emailInputDisabled,
    inputsLocked,
    setOtpDigit,
    setOtpFromPaste,
    handleResend,
    handleSubmit,
    handleFieldBlur,
    updateField,
    draftRestored,
    saveError,
    retryCountdown,
  } = useUserDetailsPage({
    publicId,
    demographics,
    setDemographics,
    onSubmit,
    onEmailVerified,
    addToast,
  });

  const AGE_MIN = constants.ageMin;
  const AGE_MAX = constants.ageMax;
  const USERNAME_MIN = constants.usernameMin;
  const LOCATION_MIN = constants.locationMin;
  const usernameOk = (demographics.username || "").trim().length >= USERNAME_MIN;
  const emailOk = Boolean((demographics.email || "").trim()) && !errors.email;
  const phoneOk = Boolean((demographics.phone || "").trim()) && !errors.phone;
  const ageOk = Boolean((demographics.age || "").trim()) && !errors.age;
  const locationOk = (demographics.location || "").trim().length >= LOCATION_MIN && !errors.location;
  const rawEmailDomains = uiText("user.emailDomains").split("|").map((d) => d.trim()).filter(Boolean);
  const emailDomains = Array.from(new Set(rawEmailDomains));
  const emailPlaceholderDomain =
    emailDomains[emailPlaceholderIndex % emailDomains.length]
    || uiText("user.emailDefaultDomain")
    || runtimeConfig.allowedEmailDomains[0]
    || "";
  const showEmailGhost = !emailFocused && !(demographics.email || "").trim();
  const inputRefs = React.useRef([]);
  const toOtpDigits = (value) => String(value || "").replace(/\D/g, "");
  const OTP_STATUS = runtimeConfig.otpStatus;
  const otpStatusMessage = otpStatus === OTP_STATUS.sending
    ? uiText("email.requesting")
    : otpStatus === OTP_STATUS.sent
      ? uiText("email.sentToast")
      : otpStatus === OTP_STATUS.verifying
        ? uiText("email.verifying")
        : "";
  const resendLabel = resendSeconds > 0
    ? uiText("email.resendIn", { seconds: resendSeconds })
    : uiText("email.sendAgain");
  const canResend = resendSeconds === 0 && otpStatus !== OTP_STATUS.sending && otpStatus !== OTP_STATUS.verifying;
  const submitLabel = otpStatus === OTP_STATUS.sending
    ? uiText("email.requesting")
    : otpStatus === OTP_STATUS.sent
      ? uiText("email.sentToast")
      : submitting
        ? uiText("common.submitting")
        : uiText("common.continue");
  const submitDisabled = (
    !systemReady ||
    submitting ||
    optionsLoading ||
    genderOptions.length === 0 ||
    languageOptions.length === 0 ||
    !isOnline ||
    !isFormComplete ||
    (locationPermissionDenied && !manualLocationAllowed) ||
    Object.keys(errors).length > 0 ||
    otpStatus !== OTP_STATUS.idle
  );
  const firstEmptyOtpIndex = otpDigits.findIndex((digit) => !digit);
  const editableOtpIndex = firstEmptyOtpIndex === -1 ? otpLength - 1 : firstEmptyOtpIndex;

  React.useEffect(() => {
    if (!showEmailGhost) return undefined;
    if (emailDomains.length <= 1) return undefined;
    const id = window.setInterval(() => {
      setEmailPlaceholderIndex((prev) => (prev + 1) % emailDomains.length);
      setEmailPlaceholderTick((prev) => prev + 1);
    }, runtimeConfig.emailPlaceholderRotateMs);
    return () => window.clearInterval(id);
  }, [emailDomains.length, showEmailGhost]);

  return (
    <div className="panel panel-with-corner-status">
      <div className="page-top-actions inline">
        {onBack && (
          <DSButton
            variant="ghost"
            className="back-button"
            onClick={onBack}
          >
            {uiText("common.backWithArrow")}
          </DSButton>
        )}
        {draftRestored && (
          <div className="banner info compact">
            <span>{uiText("draft.restored")}</span>
          </div>
        )}
        {!isOnline && (
          <div className="banner warning compact">
            <span>{uiText("user.offlineBanner")}</span>
          </div>
        )}
        {saveError && (
          <div className="banner warning compact">
            <span>{saveError}</span>
          </div>
        )}
      </div>
      {null}
      <h2>{uiText("user.pageTitle")}</h2>
      <p className="page-subtitle left">
        {uiText("user.pageSubtitle")}
      </p>
      
      <div className="form-grid">
        <div className={`form-field ${errors.username ? 'error' : ''} ${optionsLoading ? 'loading' : ''}`}>
          <label>{uiText("user.username")} <span className="required" aria-label="required">*</span></label>
          <input
            type="text"
            className={errors.username ? 'error-input' : ''}
            placeholder={uiText("user.usernamePlaceholder")}
            value={demographics.username || ''}
            disabled={inputsLocked}
            onChange={(e) => updateField('username', sanitizeUsername(e.target.value))}
            onBlur={(e) => handleFieldBlur('username', e.target.value, true)}
          />
          {checking.username && <span className="checking-text">{uiText("user.checking")}</span>}
          {errors.username && <span className="error-text">{errors.username}</span>}
          {!usernameOk && (
            <span className="helper-text warning">{uiText("user.usernameHint", { min: USERNAME_MIN })}</span>
          )}
        </div>

        <div className={`form-field ${errors.email ? 'error' : ''} ${optionsLoading ? 'loading' : ''}`}>
          <label>{uiText("user.email")} <span className="required" aria-label="required">*</span></label>
          <div className="input-with-ghost">
            <input
              type="email"
              className={errors.email ? 'error-input' : ''}
              placeholder=""
              value={demographics.email || ''}
              disabled={emailInputDisabled}
              onChange={(e) => updateField('email', e.target.value)}
              onFocus={() => setEmailFocused(true)}
              onBlur={(e) => {
                setEmailFocused(false);
                handleFieldBlur('email', e.target.value, true);
              }}
            />
            {showEmailGhost && (
              <span className="ghost-placeholder simple">
                <span className="ghost-prefix">{uiText("user.emailGhostPrefix")}</span>
                <span key={emailPlaceholderTick} className="ghost-domain simple-animate">{emailPlaceholderDomain}</span>
              </span>
            )}
          </div>
          {checking.email && <span className="checking-text">{uiText("user.checking")}</span>}
          {errors.email && <span className="error-text">{errors.email}</span>}
          {!emailOk && <span className="helper-text warning">{uiText("user.emailHint")}</span>}
        </div>

        <div className={`form-field ${errors.phone ? 'error' : ''} ${optionsLoading ? 'loading' : ''}`}>
          <label>{uiText("user.phone")} <span className="required" aria-label="required">*</span></label>
          <input
            type="tel"
            inputMode="numeric"
            pattern="[0-9]*"
            className={errors.phone ? 'error-input' : ''}
            placeholder={uiText("user.phonePlaceholder")}
            value={demographics.phone || ''}
            disabled={inputsLocked}
            onChange={(e) => {
              const value = e.target.value.replace(/\D/g, '');
              updateField('phone', value);
            }}
            onBlur={(e) => {
              const value = e.target.value.replace(/\D/g, '');
              handleFieldBlur('phone', value, true);
            }}
          />
          {checking.phone && <span className="checking-text">{uiText("user.checking")}</span>}
          {errors.phone && <span className="error-text">{errors.phone}</span>}
          {!phoneOk && <span className="helper-text warning">{uiText("user.phoneHint")}</span>}
        </div>

        {showOtpField && (
          <div className="form-field">
            <label>{uiText("email.otpLabel")} <span className="required" aria-label="required">*</span></label>
            <div className="otp-inputs" role="group" aria-label={uiText("email.otpLabel")}>
              {otpDigits.map((digit, index) => (
                <input
                  key={`otp-${index}`}
                  ref={(el) => {
                    inputRefs.current[index] = el;
                  }}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  className="otp-input"
                  maxLength={1}
                  value={digit}
                  disabled={otpStatus === OTP_STATUS.verifying || otpStatus === OTP_STATUS.sending}
                  onChange={(e) => {
                    const raw = e.target.value;
                    const digitsOnly = toOtpDigits(raw);

                    if (index !== editableOtpIndex) {
                      inputRefs.current[editableOtpIndex]?.focus();
                      return;
                    }

                    setOtpDigit(index, digitsOnly);
                    if (digitsOnly && index < otpLength - 1) {
                      window.setTimeout(() => inputRefs.current[index + 1]?.focus(), runtimeConfig.focusAdvanceDelayMs);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Backspace") {
                      e.preventDefault();
                      if (index !== editableOtpIndex) {
                        inputRefs.current[editableOtpIndex]?.focus();
                        return;
                      }
                      // Allow clearing only the current editable digit (no going back).
                      setOtpDigit(index, "");
                      return;
                    }
                    if (e.key === "ArrowLeft") {
                      e.preventDefault();
                      inputRefs.current[editableOtpIndex]?.focus();
                      return;
                    }
                    if (e.key === "ArrowRight") {
                      e.preventDefault();
                      inputRefs.current[editableOtpIndex]?.focus();
                    }
                  }}
                  onPaste={(e) => {
                    e.preventDefault();
                    const pasted = e.clipboardData.getData("text");
                    const digitsOnly = toOtpDigits(pasted);
                    if (!digitsOnly) return;
                    setOtpFromPaste(0, digitsOnly);
                    const nextIndex = Math.min(otpLength - 1, digitsOnly.length - 1);
                    window.setTimeout(() => inputRefs.current[nextIndex]?.focus(), runtimeConfig.focusAdvanceDelayMs);
                  }}
                  onFocus={() => {
                    if (index !== editableOtpIndex) inputRefs.current[editableOtpIndex]?.focus();
                  }}
                  aria-label={`${uiText("email.otpLabel")} ${index + 1}`}
                />
              ))}
            </div>
            {otpError && <span className="error-text">{otpError}</span>}
            <div className="inline-actions">
              <DSButton
                variant="ghost"
                type="button"
                disabled={!canResend}
                onClick={handleResend}
              >
                {otpStatus === OTP_STATUS.sending ? uiText("email.requesting") : resendLabel}
              </DSButton>
              {otpStatusMessage && <span className="checking-text">{otpStatusMessage}</span>}
            </div>
          </div>
        )}

        <div className={`form-field ${errors.gender_code ? 'error' : ''} ${optionsLoading ? 'loading' : ''}`}>
          <label>{uiText("user.gender")} <span className="required" aria-label="required">*</span></label>
          <select
            className={errors.gender_code ? 'error-input' : ''}
            value={demographics.gender_code || ''}
            disabled={optionsLoading || genderOptions.length === 0 || inputsLocked}
            onChange={(e) => updateField('gender_code', e.target.value)}
            onBlur={(e) => handleFieldBlur('gender_code', e.target.value)}
          >
            <option value="" disabled>{uiText("user.genderPlaceholder")}</option>
            {genderOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          {optionsLoading && <span className="checking-text">{uiText("user.checking")}</span>}
          {errors.gender_code && <span className="error-text">{errors.gender_code}</span>}
        </div>

        <div className={`form-field ${errors.age ? 'error' : ''} ${optionsLoading ? 'loading' : ''}`}>
          <label>{uiText("user.age")} <span className="required" aria-label="required">*</span></label>
          <input
            type="number"
            inputMode="numeric"
            pattern="[0-9]*"
            className={`number-left${errors.age ? ' error-input' : ''}`}
            min={AGE_MIN}
            max={AGE_MAX}
            placeholder={uiText("user.agePlaceholderRange", { min: AGE_MIN, max: AGE_MAX })}
            value={demographics.age || ''}
            disabled={inputsLocked}
            onChange={(e) => {
              const value = e.target.value.replace(/\D/g, '');
              updateField('age', value);
            }}
            onBlur={(e) => {
              handleFieldBlur('age', e.target.value);
            }}
          />
          {errors.age && <span className="error-text">{errors.age}</span>}
          {!ageOk && (
            <span className="helper-text warning">{uiText("user.ageHint", { min: AGE_MIN, max: AGE_MAX })}</span>
          )}
          <span className="helper-text">{uiText("user.ageRange", { min: AGE_MIN, max: AGE_MAX })}</span>
        </div>

        <div className={`form-field ${errors.location ? 'error' : ''} ${optionsLoading ? 'loading' : ''}`}>
          <label>{uiText("user.location")} <span className="required" aria-label="required">*</span></label>
          <input
            type="text"
            className={errors.location ? 'error-input' : ''}
            placeholder={
              locating
                ? uiText("user.locationPlaceholderDetecting")
                : (manualLocationAllowed ? uiText("user.locationPlaceholderManual") : uiText("user.locationPlaceholderAuto"))
            }
            value={demographics.location || ''}
            disabled={locating || !manualLocationAllowed || inputsLocked}
            readOnly={locating || !manualLocationAllowed || inputsLocked}
            onChange={(e) => {
              userEditedLocationRef.current = true;
              updateField("location", e.target.value);
            }}
            onBlur={(e) => {
              handleFieldBlur("location", e.target.value);
            }}
          />
          {locationPermissionDenied && !locating && (
            <DSButton
              type="button"
              variant="ghost"
              className="location-permission-btn"
              disabled={inputsLocked}
              onClick={() => detectLocation("manual")}
            >
              {uiText("user.enableLocation")}
            </DSButton>
          )}
          {locationStatus && <span className="checking-text">{locationStatus}</span>}
          {errors.location && <span className="error-text">{errors.location}</span>}
          {!locationOk && (
            <span className="helper-text warning">{uiText("user.locationHint", { min: LOCATION_MIN })}</span>
          )}
        </div>

        <div className={`form-field ${errors.language_code ? 'error' : ''} ${optionsLoading ? 'loading' : ''}`}>
          <label>{uiText("user.language")} <span className="required" aria-label="required">*</span></label>
          <select
            className={errors.language_code ? 'error-input' : ''}
            value={demographics.language_code || ''}
            disabled={optionsLoading || languageOptions.length === 0 || inputsLocked}
            onChange={(e) => updateField('language_code', e.target.value)}
            onBlur={(e) => handleFieldBlur('language_code', e.target.value)}
          >
            <option value="" disabled>{uiText("user.languagePlaceholder")}</option>
            {languageOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          {optionsLoading && <span className="checking-text">{uiText("user.checking")}</span>}
          {errors.language_code && <span className="error-text">{errors.language_code}</span>}
        </div>

        <div className={`form-field ${errors.prior_experience ? 'error' : ''} ${optionsLoading ? 'loading' : ''}`}>
          <label>{uiText("user.priorExperience")} <span className="required" aria-label="required">*</span></label>
          <select
            className={errors.prior_experience ? 'error-input' : ''}
            value={demographics.prior_experience || ''}
            disabled={inputsLocked}
            onChange={(e) => updateField('prior_experience', e.target.value)}
            onBlur={(e) => handleFieldBlur('prior_experience', e.target.value)}
          >
            <option value="" disabled>{uiText("user.priorExperiencePlaceholder")}</option>
            {PRIOR_EXPERIENCE_GROUPS.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.options.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </optgroup>
            ))}
            <option value={PRIOR_EXPERIENCE_NONE}>{PRIOR_EXPERIENCE_NONE}</option>
          </select>
          {errors.prior_experience && <span className="error-text">{errors.prior_experience}</span>}
        </div>
      </div>

      <div className="page-actions sticky-mobile-actions">
        {errors.general && <span className="error-text">{errors.general}</span>}
        <DSButton
          variant="primary"
          onClick={handleSubmit}
          disabled={submitDisabled}
        >
          {submitLabel}
          {!isOnline && retryCountdown > 0 && (
            <span className="button-badge">
              <span className="button-spinner small" />
              {retryCountdown}s
            </span>
          )}
        </DSButton>
        {!isOnline && retryCountdown > 0 && (
          <div className="helper-text">{uiText("survey.retryIn", { seconds: retryCountdown })}</div>
        )}
      </div>
    </div>
  );
}
