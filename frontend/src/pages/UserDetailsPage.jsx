import React from "react";
import { useUserDetailsPage } from "../hooks/useUserDetailsPage";
import { uiText } from "../utils/uiText";
import { runtimeConfig } from "../config/runtime";
import PageStatusBanners from "../components/PageStatusBanners.jsx";
import { sanitizeUsername } from "../utils/userDetailsHelpers";
import { useIsMobile } from "../hooks/useIsMobile.js";
import UserIdentityFields from "../components/user-details/UserIdentityFields.jsx";
import OtpVerificationField from "../components/user-details/OtpVerificationField.jsx";
import UserProfileFields from "../components/user-details/UserProfileFields.jsx";
import UserDetailsSubmitFooter from "../components/user-details/UserDetailsSubmitFooter.jsx";

export default function UserDetailsPage({
  publicId,
  demographics,
  setDemographics,
  onSubmit,
  onEmailVerified,
  addToast,
  systemReady
}) {
  const [emailFocused, setEmailFocused] = React.useState(false);
  const [emailPlaceholderIndex, setEmailPlaceholderIndex] = React.useState(0);
  const isMobile = useIsMobile();
  const {
    constants,
    isOnline,
    genderOptions,
    languageOptions,
    priorExperienceGroups,
    optionsLoading,
    errors,
    submitting,
    checking,
    locating,
    locationStatus,
    locationPermissionState,
    userEditedLocationRef,
    isFormComplete,
    detectLocation,
    otpDigits,
    otpLength,
    showOtpField,
    otpStatus,
    otpError,
    otpExpirySeconds,
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
    priorExperienceGroups.length === 0 ||
    !isOnline ||
    !isFormComplete ||
    Object.keys(errors).length > 0 ||
    otpStatus !== OTP_STATUS.idle
  );
  const firstEmptyOtpIndex = otpDigits.findIndex((digit) => !digit);
  const editableOtpIndex = firstEmptyOtpIndex === -1 ? otpLength - 1 : firstEmptyOtpIndex;
  const formatOtpTimer = (seconds) => {
    const clamped = Math.max(0, Number(seconds || 0));
    const mins = Math.floor(clamped / 60);
    const secs = Math.floor(clamped % 60);
    return `${mins}:${String(secs).padStart(2, "0")}`;
  };
  const showOtpExpiry = showOtpField && otpStatus !== OTP_STATUS.sending;
  const otpExpiryMessage = otpExpirySeconds > 0
    ? uiText("email.otpExpiresIn", { time: formatOtpTimer(otpExpirySeconds) })
    : uiText("email.otpExpired");

  React.useEffect(() => {
    if (!showEmailGhost) return undefined;
    if (emailDomains.length <= 1) return undefined;
    const id = window.setInterval(() => {
      setEmailPlaceholderIndex((prev) => (prev + 1) % emailDomains.length);
    }, runtimeConfig.emailPlaceholderRotateMs);
    return () => window.clearInterval(id);
  }, [emailDomains.length, showEmailGhost]);

  React.useEffect(() => {
    if (!showOtpField) return;
    if (otpStatus === OTP_STATUS.sending || otpStatus === OTP_STATUS.verifying) return;
    window.setTimeout(() => {
      inputRefs.current[editableOtpIndex]?.focus();
    }, runtimeConfig.focusAdvanceDelayMs);
  }, [showOtpField, otpStatus, editableOtpIndex, OTP_STATUS.sending, OTP_STATUS.verifying]);

  return (
    <div className="panel panel-with-corner-status">
      <div className="page-top-actions inline">
        <PageStatusBanners
          isOnline={isOnline}
          offlineMessage={uiText("user.offlineBanner")}
          draftRestored={draftRestored}
          compact
        />
      </div>
      {null}
      <h2>{uiText("user.pageTitle")}</h2>
      <p className="page-subtitle left">
        {uiText("user.pageSubtitle")}
      </p>
      
      <div className={`form-grid ${showOtpField ? "has-otp" : ""}`}>
        <UserIdentityFields
          demographics={demographics}
          errors={errors}
          optionsLoading={optionsLoading}
          checking={checking}
          inputsLocked={inputsLocked}
          emailInputDisabled={emailInputDisabled}
          usernameOk={usernameOk}
          emailOk={emailOk}
          usernameMin={USERNAME_MIN}
          showEmailGhost={showEmailGhost}
          emailPlaceholderDomain={emailPlaceholderDomain}
          emailPlaceholderIndex={emailPlaceholderIndex}
          updateField={updateField}
          handleFieldBlur={handleFieldBlur}
          sanitizeUsername={sanitizeUsername}
          setEmailFocused={setEmailFocused}
        />

        <OtpVerificationField
          showOtpField={showOtpField}
          otpDigits={otpDigits}
          otpLength={otpLength}
          otpStatus={otpStatus}
          otpStatusConfig={OTP_STATUS}
          otpError={otpError}
          otpExpiryMessage={otpExpiryMessage}
          showOtpExpiry={showOtpExpiry}
          resendSeconds={resendSeconds}
          otpStatusMessage={otpStatusMessage}
          resendLabel={resendLabel}
          canResend={canResend}
          inputRefs={inputRefs}
          editableOtpIndex={editableOtpIndex}
          toOtpDigits={toOtpDigits}
          setOtpDigit={setOtpDigit}
          setOtpFromPaste={setOtpFromPaste}
          handleResend={handleResend}
          focusAdvanceDelayMs={runtimeConfig.focusAdvanceDelayMs}
        />

        <UserProfileFields
          demographics={demographics}
          errors={errors}
          optionsLoading={optionsLoading}
          inputsLocked={inputsLocked}
          isMobile={isMobile}
          locating={locating}
          locationStatus={locationStatus}
          locationPermissionState={locationPermissionState}
          userEditedLocationRef={userEditedLocationRef}
          genderOptions={genderOptions}
          languageOptions={languageOptions}
          priorExperienceGroups={priorExperienceGroups}
          ageMin={AGE_MIN}
          ageMax={AGE_MAX}
          locationMin={LOCATION_MIN}
          ageOk={ageOk}
          locationOk={locationOk}
          updateField={updateField}
          handleFieldBlur={handleFieldBlur}
          detectLocation={detectLocation}
        />
      </div>

      <UserDetailsSubmitFooter
        errors={errors}
        showOtpField={showOtpField}
        submitDisabled={submitDisabled}
        handleSubmit={handleSubmit}
        submitLabel={submitLabel}
        isOnline={isOnline}
        retryCountdown={retryCountdown}
      />
    </div>
  );
}
