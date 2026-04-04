import React from "react";
import { useUserDetailsPage } from "../hooks/useUserDetailsPage";
import { uiText } from "../utils/uiText";
import { runtimeConfig } from "../config/runtime";
import { buildUserDetailsValidators, sanitizeUsername } from "../utils/userDetailsHelpers";
import { useIsMobile } from "../hooks/useIsMobile.js";
import UserIdentityFields from "../components/user-details/UserIdentityFields.jsx";
import OtpVerificationField from "../components/user-details/OtpVerificationField.jsx";
import UserProfileFields from "../components/user-details/UserProfileFields.jsx";
import UserDetailsSubmitFooter from "../components/user-details/UserDetailsSubmitFooter.jsx";
import { useRenderProfiler } from "../hooks/useRenderProfiler.js";
import { prefetchBehaviorChunks } from "../components/app/AppStageRouter.jsx";

export default function UserDetailsPage({
  storageScope,
  publicId,
  sessionHydrated = false,
  demographics,
  setDemographics,
  onSubmit,
  onEmailVerified,
  addToast,
  systemReady
}) {
  const [emailFocused, setEmailFocused] = React.useState(false);
  const [emailPlaceholderIndex, setEmailPlaceholderIndex] = React.useState(0);
  const [showOtpDeliveryNotice, setShowOtpDeliveryNotice] = React.useState(false);
  const profileRender = useRenderProfiler("UserDetailsPage", 20);
  const isMobile = useIsMobile();
  const {
    constants,
    genderOptions,
    languageOptions,
    priorExperienceGroups,
    optionsLoading,
    errors,
    submitting,
    optimisticMessage,
    checking,
    locating,
    locationStatus,
    locationPermissionState,
    userEditedLocationRef,
    isFormComplete,
    canSubmit,
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
  } = useUserDetailsPage({
    storageScope,
    publicId,
    sessionHydrated,
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
  const emailDomains = React.useMemo(() => {
    const rawEmailDomains = (runtimeConfig.allowedEmailDomains || [])
      .map((d) => String(d || "").trim())
      .filter(Boolean);
    return Array.from(new Set(rawEmailDomains));
  }, []);
  const fieldStatus = React.useMemo(() => ({
    usernameOk: (demographics.username || "").trim().length >= USERNAME_MIN,
    emailOk: Boolean((demographics.email || "").trim()) && !errors.email,
    ageOk: Boolean((demographics.age || "").trim()) && !errors.age,
    locationOk: (demographics.location || "").trim().length >= LOCATION_MIN && !errors.location,
  }), [LOCATION_MIN, USERNAME_MIN, demographics.age, demographics.email, demographics.location, demographics.username, errors.age, errors.email, errors.location]);
  const { usernameOk, emailOk, ageOk, locationOk } = fieldStatus;
  const validators = React.useMemo(() => buildUserDetailsValidators({
    usernameMinLength: USERNAME_MIN,
    ageMin: AGE_MIN,
    ageMax: AGE_MAX,
    locationMinLength: LOCATION_MIN,
  }), [AGE_MAX, AGE_MIN, LOCATION_MIN, USERNAME_MIN]);
  const emailFormatHintVisible = React.useMemo(() => {
    if (errors.email) return false;
    return Boolean(validators.validateEmailInput(demographics.email));
  }, [demographics.email, errors.email, validators]);
  const identityFields = React.useMemo(() => ({
    username: demographics.username || "",
    email: demographics.email || "",
    usernameError: errors.username || "",
    emailError: errors.email || "",
  }), [demographics.email, demographics.username, errors.email, errors.username]);
  const profileFields = React.useMemo(() => ({
    genderCode: demographics.gender_code || "",
    age: demographics.age || "",
    location: demographics.location || "",
    languageCode: demographics.language_code || "",
    priorExperience: demographics.prior_experience || "",
    genderError: errors.gender_code || "",
    ageError: errors.age || "",
    locationError: errors.location || "",
    languageError: errors.language_code || "",
    priorExperienceError: errors.prior_experience || "",
  }), [
    demographics.age,
    demographics.gender_code,
    demographics.language_code,
    demographics.location,
    demographics.prior_experience,
    errors.age,
    errors.gender_code,
    errors.language_code,
    errors.location,
    errors.prior_experience,
  ]);
  const emailPlaceholderDomain =
    emailDomains[emailPlaceholderIndex % emailDomains.length]
    || "";
  const showEmailGhost = !emailFocused && !(demographics.email || "").trim();
  const inputRefs = React.useRef([]);
  const toOtpDigits = (value) => String(value || "").replace(/\D/g, "");
  const OTP_STATUS = runtimeConfig.otpStatus;
  const showOtpExpiry = showOtpField && otpStatus !== OTP_STATUS.sending;
  const otpExpired = showOtpExpiry && otpExpirySeconds <= 0;
  const otpStatusMessage = React.useMemo(() => (
    otpError || otpExpired
      ? ""
      : otpStatus === OTP_STATUS.sending
      ? uiText("email.requesting")
      : otpStatus === OTP_STATUS.sent
        ? uiText("email.sentToast")
        : otpStatus === OTP_STATUS.verifying
          ? uiText("email.verifying")
          : ""
  ), [OTP_STATUS.sending, OTP_STATUS.sent, OTP_STATUS.verifying, otpError, otpExpired, otpStatus]);
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
  const submitDisabled = !systemReady || !canSubmit;
  const effectiveSubmitDisabled = submitDisabled || submitting;
  const firstEmptyOtpIndex = otpDigits.findIndex((digit) => !digit);
  const editableOtpIndex = firstEmptyOtpIndex === -1 ? otpLength - 1 : firstEmptyOtpIndex;
  const formatOtpTimer = (seconds) => {
    const clamped = Math.max(0, Number(seconds || 0));
    const mins = Math.floor(clamped / 60);
    const secs = Math.floor(clamped % 60);
    return `${mins}:${String(secs).padStart(2, "0")}`;
  };
  const otpExpiryMessage = otpExpirySeconds > 0
    ? uiText("email.otpExpiresIn", { time: formatOtpTimer(otpExpirySeconds) })
    : uiText("email.otpExpired");
  const initialOtpSentRef = React.useRef(false);

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

  React.useEffect(() => {
    if (otpStatus !== OTP_STATUS.sent || initialOtpSentRef.current) return;
    initialOtpSentRef.current = true;
    setShowOtpDeliveryNotice(true);
  }, [OTP_STATUS.sent, otpStatus]);

  React.useEffect(() => {
    prefetchBehaviorChunks({
      fromStage: "user-details",
      userDetailsLikelyComplete: isFormComplete,
    });
  }, [isFormComplete]);

  return (
    <div className="panel panel-with-corner-status">
      <h2>{uiText("user.pageTitle")}</h2>
      <p className="page-subtitle left">
        {uiText("user.pageSubtitle")}
      </p>
      {showOtpDeliveryNotice && (
        <div className="banner warning">
          {uiText("email.deliveryDelayNotice")}
        </div>
      )}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {otpStatusMessage}
      </div>

      <React.Profiler id="user-details-form-grid" onRender={profileRender}>
        <div className={`form-grid ${showOtpField ? "has-otp" : ""}`}>
          <UserIdentityFields
            username={identityFields.username}
            email={identityFields.email}
            usernameError={identityFields.usernameError}
            emailError={identityFields.emailError}
            optionsLoading={optionsLoading}
            checking={checking}
            inputsLocked={inputsLocked}
            emailInputDisabled={emailInputDisabled}
            usernameOk={usernameOk}
            emailOk={emailOk}
            emailFormatHintVisible={emailFormatHintVisible}
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
            otpExpired={otpExpired}
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
            genderCode={profileFields.genderCode}
            age={profileFields.age}
            location={profileFields.location}
            languageCode={profileFields.languageCode}
            priorExperience={profileFields.priorExperience}
            genderError={profileFields.genderError}
            ageError={profileFields.ageError}
            locationError={profileFields.locationError}
            languageError={profileFields.languageError}
            priorExperienceError={profileFields.priorExperienceError}
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
      </React.Profiler>

      <UserDetailsSubmitFooter
        errors={errors}
        showOtpField={showOtpField}
        submitDisabled={effectiveSubmitDisabled}
        submitting={submitting}
        handleSubmit={handleSubmit}
        submitLabel={submitLabel}
        optimisticMessage={optimisticMessage}
      />
    </div>
  );
}
