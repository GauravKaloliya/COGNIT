import { useCallback, useEffect, useMemo, useState } from "react";
import { endpoints } from "../utils/api.js";
import { getErrorMessage } from "../utils/errorRegistry.js";
import { getDisplayErrorMessage } from "../utils/appError.js";
import { runtimeConfig } from "../config/runtime";
import { uiText } from "../utils/uiText";
import { useOnlineStatus } from "./useOnlineStatus";
import { useRetryCountdown } from "./useRetryCountdown";
import { useIsMobile } from "./useIsMobile";
import { getPendingFlag, makeScopedKey, removeStoredKey, setPendingFlag } from "../utils/storage";
import {
  USER_DETAILS_DUPLICATE_ERROR_CODES,
  USER_DETAILS_ERROR_CODE_TO_FIELD,
  USER_DETAIL_FIELDS,
} from "../constants/userDetails";
import { REQUEST_CODES } from "../constants/request";
import { requirePublicId } from "../utils/publicId";
import { useParticipantOptions } from "./user-details/useParticipantOptions";
import { useUserDetailsLocation } from "./user-details/useUserDetailsLocation";
import { useUserDetailsValidationDraft } from "./user-details/useUserDetailsValidationDraft";
import { useUserDetailsVerification } from "./user-details/useUserDetailsVerification";
import { useStableSelector } from "./useStableSelector";

const USERNAME_MIN_LENGTH = runtimeConfig.usernameMinLength;
const AGE_MIN = runtimeConfig.ageMin;
const AGE_MAX = runtimeConfig.ageMax;
const LOCATION_MIN_LENGTH = runtimeConfig.locationMinLength;
const OTP_STATUS = runtimeConfig.otpStatus;
const USER_DETAILS_PENDING_KEY = runtimeConfig.storageKeys.userDetailsPending;

export function useUserDetailsPage({
  publicId,
  demographics,
  setDemographics,
  onSubmit,
  onEmailVerified,
  addToast,
}) {
  const scope = String(publicId || "").trim() || "anon";
  const scopedUserDetailsPendingKey = makeScopedKey(USER_DETAILS_PENDING_KEY, scope);
  const isOnline = useOnlineStatus();
  const isMobile = useIsMobile();
  const [submitting, setSubmitting] = useState(false);
  const [pendingSubmit, setPendingSubmit] = useState(false);
  const retryCountdown = useRetryCountdown(!isOnline && pendingSubmit, runtimeConfig.serviceRetrySeconds);

  const {
    errors,
    setErrors,
    fieldMeta,
    checking,
    draftRestored,
    validateForm,
    updateField,
    handleFieldBlur,
    startSubmitValidation,
    endSubmitValidation,
    setGeneralError,
    clearGeneralError,
  } = useUserDetailsValidationDraft({
    demographics,
    setDemographics,
    scope,
  });

  const { optionLists, optionsLoading } = useParticipantOptions({
    isOnline,
    priorExperienceValue: demographics.prior_experience,
    setDemographics,
    onGeneralError: setGeneralError,
  });

  const {
    locating,
    locationStatus,
    locationPermissionDenied,
    locationPermissionState,
    manualLocationAllowed,
    locationAutoSucceeded,
    userEditedLocationRef,
    detectLocation,
  } = useUserDetailsLocation({
    isMobile,
    demographicsLocation: demographics.location,
    setDemographics,
    setErrors,
  });

  const verification = useUserDetailsVerification({
    scope,
    publicId,
    demographicsEmail: demographics.email,
    isOnline,
    addToast,
    onEmailVerified,
  });

  const {
    otpStatus,
    otpDigits,
    otpError,
    otpExpirySeconds,
    otpLength,
    otpValue,
    resendSeconds,
    requestOtp,
    handleResend,
    setOtpDigit,
    setOtpFromPaste,
  } = verification;

  const showOtpField = [
    OTP_STATUS.sending,
    OTP_STATUS.sent,
    OTP_STATUS.sendFailed,
    OTP_STATUS.verifying,
    OTP_STATUS.verifyFailed,
  ].includes(otpStatus);
  const inputsLocked = submitting
    || otpStatus === OTP_STATUS.sending
    || otpStatus === OTP_STATUS.verifying
    || otpStatus === OTP_STATUS.sent
    || otpStatus === OTP_STATUS.verifyFailed;
  const allowEmailDuringOtp = otpStatus !== OTP_STATUS.idle;
  const emailInputDisabled = inputsLocked && !allowEmailDuringOtp;

  useEffect(() => {
    document.title = uiText("user.documentTitle");
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!isOnline) {
      setGeneralError(uiText("user.offlineSubmit"));
      setPendingFlag(scopedUserDetailsPendingKey);
      setPendingSubmit(true);
      return;
    }
    if (!validateForm()) return;

    clearGeneralError();
    startSubmitValidation();
    setSubmitting(true);

    try {
      const normalizedUsername = String(demographics.username || "").trim();
      const normalizedEmail = String(demographics.email || "").trim().toLowerCase();

      let usernameCheck;
      let emailCheck;
      try {
        [usernameCheck, emailCheck] = await Promise.all([
          endpoints.checkUsername(normalizedUsername),
          endpoints.checkEmail(normalizedEmail),
        ]);
      } catch (error) {
        if (error?.code === REQUEST_CODES.aborted) return;
        setGeneralError(error?.message || getErrorMessage("SYS_001_0001"));
        return;
      }

      const duplicateErrors = {};
      if (usernameCheck?.available === false) {
        duplicateErrors[USER_DETAIL_FIELDS.username] = getErrorMessage(USER_DETAILS_DUPLICATE_ERROR_CODES.username);
      }
      if (emailCheck?.available === false) {
        duplicateErrors[USER_DETAIL_FIELDS.email] = getErrorMessage(USER_DETAILS_DUPLICATE_ERROR_CODES.email);
      }
      if (Object.keys(duplicateErrors).length > 0) {
        setErrors((prev) => ({ ...prev, ...duplicateErrors }));
        return;
      }

      const participant = await onSubmit();
      const effectivePublicId = requirePublicId(participant?.public_id || publicId, () => {
        addToast?.(getErrorMessage("NF_001_0001"), "warning");
      });
      if (!effectivePublicId) {
        const missingPublicIdError = new Error(getErrorMessage("NF_001_0001"));
        missingPublicIdError.code = "NF_001_0001";
        missingPublicIdError.category = "NF";
        missingPublicIdError.status = 404;
        missingPublicIdError.retryable = false;
        missingPublicIdError.action = "redirect";
        throw missingPublicIdError;
      }

      await requestOtp({
        effectivePublicId,
        normalizedEmail,
      });
    } catch (error) {
      if (error?.code === REQUEST_CODES.aborted) return;
      const mappedField = USER_DETAILS_ERROR_CODE_TO_FIELD[error?.code] || error?.field || null;
      if (mappedField) {
        setErrors((prev) => ({
          ...prev,
          [mappedField]: getDisplayErrorMessage(error, USER_DETAILS_DUPLICATE_ERROR_CODES[mappedField] || "SYS_001_0001"),
        }));
        return;
      }
      if (error?.status === 409) {
        try {
          const [u, e] = await Promise.all([
            demographics.username?.trim()
              ? endpoints.checkUsername(demographics.username.trim()).catch(() => ({ available: true }))
              : Promise.resolve({ available: true }),
            demographics.email?.trim()
              ? endpoints.checkEmail(demographics.email.trim()).catch(() => ({ available: true }))
              : Promise.resolve({ available: true }),
          ]);
          const conflictErrors = {};
          if (u?.available === false) conflictErrors[USER_DETAIL_FIELDS.username] = getErrorMessage(USER_DETAILS_DUPLICATE_ERROR_CODES.username);
          if (e?.available === false) conflictErrors[USER_DETAIL_FIELDS.email] = getErrorMessage(USER_DETAILS_DUPLICATE_ERROR_CODES.email);
          if (Object.keys(conflictErrors).length > 0) {
            setErrors((prev) => ({ ...prev, ...conflictErrors }));
            return;
          }
        } catch {
          // Fall through to generic message.
        }
      }
      setGeneralError(error?.message || getErrorMessage("SYS_001_0001"));
    } finally {
      setSubmitting(false);
      endSubmitValidation();
    }
  }, [
    addToast,
    clearGeneralError,
    demographics.email,
    demographics.username,
    endSubmitValidation,
    isOnline,
    onSubmit,
    publicId,
    requestOtp,
    scopedUserDetailsPendingKey,
    setErrors,
    setGeneralError,
    startSubmitValidation,
    validateForm,
  ]);

  useEffect(() => {
    if (!isOnline || submitting) return;
    const pending = getPendingFlag(scopedUserDetailsPendingKey) === true;
    if (!pending) return;
    removeStoredKey(scopedUserDetailsPendingKey);
    setPendingSubmit(false);
    void handleSubmit();
  }, [handleSubmit, isOnline, scopedUserDetailsPendingKey, submitting]);

  const requiredFields = useMemo(() => ([
    USER_DETAIL_FIELDS.username,
    USER_DETAIL_FIELDS.email,
    USER_DETAIL_FIELDS.genderCode,
    USER_DETAIL_FIELDS.age,
    USER_DETAIL_FIELDS.location,
    USER_DETAIL_FIELDS.languageCode,
    USER_DETAIL_FIELDS.priorExperience,
  ]), []);

  const formFlags = useStableSelector(() => {
    const complete = requiredFields.every((field) => {
      const value = demographics[field];
      if (typeof value === "string") {
        return value.trim().length > 0;
      }
      return value !== null && value !== undefined && value !== "";
    });
    const hasErrors = Object.keys(errors).some((field) => field !== USER_DETAIL_FIELDS.general);
    const canSubmit = isOnline
      && !submitting
      && !optionsLoading
      && optionLists.genders.length > 0
      && optionLists.languages.length > 0
      && optionLists.priorExperiences.length > 0
      && complete
      && !hasErrors
      && otpStatus === OTP_STATUS.idle;
    return {
      isFormComplete: complete,
      canSubmit,
    };
  }, [
    demographics,
    errors,
    isOnline,
    optionLists.genders.length,
    optionLists.languages.length,
    optionLists.priorExperiences.length,
    optionsLoading,
    otpStatus,
    requiredFields,
    submitting,
    OTP_STATUS.idle,
  ]);

  const constants = useMemo(() => ({
    ageMin: AGE_MIN,
    ageMax: AGE_MAX,
    usernameMin: USERNAME_MIN_LENGTH,
    locationMin: LOCATION_MIN_LENGTH,
  }), []);

  return {
    constants,
    isOnline,
    genderOptions: optionLists.genders,
    languageOptions: optionLists.languages,
    priorExperienceGroups: optionLists.priorExperiences,
    optionsLoading,
    errors,
    submitting,
    checking,
    locating,
    locationStatus,
    locationPermissionDenied,
    locationPermissionState,
    manualLocationAllowed,
    locationAutoSucceeded,
    userEditedLocationRef,
    isFormComplete: formFlags.isFormComplete,
    canSubmit: formFlags.canSubmit,
    detectLocation,
    handleSubmit,
    handleFieldBlur,
    updateField,
    draftRestored,
    fieldMeta,
    retryCountdown,
    otpDigits,
    otpValue,
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
  };
}
