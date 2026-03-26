import { useCallback, useEffect, useRef, useState } from "react";
import { endpoints } from "../../utils/api.js";
import { runtimeConfig } from "../../config/runtime";
import { getErrorMessage } from "../../utils/errorRegistry.js";
import { uiText } from "../../utils/uiText";
import { REQUEST_CODES } from "../../constants/request";
import { ERROR_UI_EVENTS } from "../../constants/errorUiEvents";
import { clearScheduledInterval, scheduleInterval, SECOND_MS } from "../../utils/timing";
import { forEachStorageArea, makeScopedKey, removeStoredKey } from "../../utils/storage";
import { requirePublicId } from "../../utils/publicId";
import { useRetryCountdown } from "../useRetryCountdown";
import { storageAdapters } from "../../utils/storageAdapters";

const OTP_STATUS = runtimeConfig.otpStatus;
const EMAIL_OTP_STATE_KEY = runtimeConfig.storageKeys.emailOtpState;
const EMAIL_OTP_TTL_MS = Math.max(
  30000,
  (runtimeConfig.emailOtpExpirySeconds || 300) * 1000
);

export function useUserDetailsVerification({
  scope,
  publicId,
  demographicsEmail,
  isOnline,
  addToast,
  onEmailVerified,
}) {
  const otpLength = runtimeConfig.emailOtpLength;
  const scopedOtpKey = makeScopedKey(EMAIL_OTP_STATE_KEY, scope);
  const [otpDigits, setOtpDigits] = useState(() => Array.from({ length: otpLength }, () => ""));
  const [otpError, setOtpError] = useState("");
  const [otpStatus, setOtpStatus] = useState(OTP_STATUS.idle);
  const [resendCountdownActive, setResendCountdownActive] = useState(false);
  const [resendInitialSeconds, setResendInitialSeconds] = useState(runtimeConfig.emailOtpResendCooldownSeconds);
  const [emailEditable, setEmailEditable] = useState(false);
  const [otpExpiresAt, setOtpExpiresAt] = useState(null);
  const [otpExpirySeconds, setOtpExpirySeconds] = useState(0);
  const submittedPublicIdRef = useRef("");
  const submittedEmailRef = useRef("");
  const autoVerifyRef = useRef("");
  const resendEndsAtRef = useRef(null);
  const otpExpiresAtRef = useRef(null);
  const resendSeconds = useRetryCountdown(resendCountdownActive, resendInitialSeconds);
  const otpValue = otpDigits.join("");

  useEffect(() => {
    const storedOtp = storageAdapters.emailOtpState.read(scope, null, {
      ttlMs: EMAIL_OTP_TTL_MS,
      schemaVersion: runtimeConfig.uiStateSchemaVersion,
    });
    if (!storedOtp || typeof storedOtp !== "object") return;

    if (storedOtp.otpStatus === OTP_STATUS.verified) {
      forEachStorageArea((area) => {
        removeStoredKey(scopedOtpKey, area);
      });
      return;
    }

    if (storedOtp.publicId) submittedPublicIdRef.current = String(storedOtp.publicId);
    if (storedOtp.submittedEmail) submittedEmailRef.current = String(storedOtp.submittedEmail);
    if (typeof storedOtp.emailEditable === "boolean") setEmailEditable(storedOtp.emailEditable);
    if (typeof storedOtp.otpStatus === "string") {
      const normalizedStatus = [OTP_STATUS.sending, OTP_STATUS.verifying].includes(storedOtp.otpStatus)
        ? OTP_STATUS.sent
        : storedOtp.otpStatus === OTP_STATUS.sendFailed
          ? OTP_STATUS.verifyFailed
          : storedOtp.otpStatus;
      setOtpStatus(normalizedStatus);
    }
    if (storedOtp.resendEndsAt && typeof storedOtp.resendEndsAt === "number") {
      const remaining = Math.max(0, Math.ceil((storedOtp.resendEndsAt - Date.now()) / 1000));
      if (remaining > 0) {
        resendEndsAtRef.current = storedOtp.resendEndsAt;
        setResendInitialSeconds(remaining);
        setResendCountdownActive(true);
      }
    }
    if (storedOtp.otpExpiresAt && typeof storedOtp.otpExpiresAt === "number") {
      const remaining = Math.max(0, Math.ceil((storedOtp.otpExpiresAt - Date.now()) / 1000));
      if (remaining > 0) {
        otpExpiresAtRef.current = storedOtp.otpExpiresAt;
        setOtpExpiresAt(storedOtp.otpExpiresAt);
        setOtpExpirySeconds(remaining);
      }
    }
  }, [scope, scopedOtpKey]);

  useEffect(() => {
    if (!otpExpiresAt || otpStatus === OTP_STATUS.verified || otpStatus === OTP_STATUS.idle) {
      setOtpExpirySeconds(0);
      return undefined;
    }
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((otpExpiresAt - Date.now()) / 1000));
      setOtpExpirySeconds(remaining);
    };
    tick();
    const interval = scheduleInterval(tick, SECOND_MS);
    return () => clearScheduledInterval(interval);
  }, [otpExpiresAt, otpStatus]);

  useEffect(() => {
    if (resendCountdownActive && resendSeconds === 0) {
      setResendCountdownActive(false);
      resendEndsAtRef.current = null;
    }
  }, [resendCountdownActive, resendSeconds]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const handleOtpResendReady = (event) => {
      const detail = event?.detail || {};
      if (String(detail?.code || "") !== "AUTH_003_0002") return;
      setOtpStatus(OTP_STATUS.verifyFailed);
      setResendCountdownActive(false);
      resendEndsAtRef.current = null;
      setOtpError(detail?.message || getErrorMessage("AUTH_003_0002"));
    };
    window.addEventListener(ERROR_UI_EVENTS.otpResendReady, handleOtpResendReady);
    return () => window.removeEventListener(ERROR_UI_EVENTS.otpResendReady, handleOtpResendReady);
  }, []);

  useEffect(() => {
    if (!resendCountdownActive) return;
    if (otpExpirySeconds > 0) return;
    if (![OTP_STATUS.sent, OTP_STATUS.verifyFailed].includes(otpStatus)) return;
    setResendCountdownActive(false);
    resendEndsAtRef.current = null;
  }, [otpExpirySeconds, otpStatus, resendCountdownActive]);

  useEffect(() => {
    if (!submittedEmailRef.current) return;
    const normalizedEmail = String(demographicsEmail || "").trim().toLowerCase();
    if (normalizedEmail !== submittedEmailRef.current && otpStatus !== OTP_STATUS.verified) {
      setOtpDigits(Array.from({ length: otpLength }, () => ""));
      setOtpStatus((prev) => (prev === OTP_STATUS.idle ? prev : OTP_STATUS.sendFailed));
      setOtpError("");
    }
  }, [demographicsEmail, otpLength, otpStatus]);

  useEffect(() => {
    if (otpStatus === OTP_STATUS.idle) {
      forEachStorageArea((area) => {
        removeStoredKey(scopedOtpKey, area);
      });
      otpExpiresAtRef.current = null;
      setOtpExpiresAt(null);
      setOtpExpirySeconds(0);
      return;
    }
    if (resendCountdownActive && !resendEndsAtRef.current) {
      resendEndsAtRef.current = Date.now() + Math.max(1, resendInitialSeconds) * 1000;
    }
    storageAdapters.emailOtpState.write(scope, {
      publicId: submittedPublicIdRef.current || publicId,
      email: String(demographicsEmail || "").trim().toLowerCase(),
      submittedEmail: submittedEmailRef.current,
      otpStatus,
      resendEndsAt: resendEndsAtRef.current,
      otpExpiresAt: otpExpiresAtRef.current || otpExpiresAt,
      emailEditable,
    }, {
      ttlMs: EMAIL_OTP_TTL_MS,
      schemaVersion: runtimeConfig.uiStateSchemaVersion,
    });
  }, [
    demographicsEmail,
    emailEditable,
    otpExpiresAt,
    otpStatus,
    publicId,
    resendCountdownActive,
    resendInitialSeconds,
    scopedOtpKey,
    scope,
  ]);

  const requestOtp = useCallback(async ({
    effectivePublicId,
    normalizedEmail,
    emailUpdate = false,
    onFailure,
  }) => {
    autoVerifyRef.current = "";
    setOtpStatus(OTP_STATUS.sending);
    setOtpError("");
    setEmailEditable(false);
    try {
      const response = await endpoints.requestEmailOtp(effectivePublicId, normalizedEmail, emailUpdate);
      submittedPublicIdRef.current = effectivePublicId;
      submittedEmailRef.current = normalizedEmail;
      setOtpDigits(Array.from({ length: otpLength }, () => ""));
      setOtpStatus(OTP_STATUS.sent);
      setResendInitialSeconds(runtimeConfig.emailOtpResendCooldownSeconds);
      resendEndsAtRef.current = Date.now() + runtimeConfig.emailOtpResendCooldownSeconds * 1000;
      setResendCountdownActive(true);
      const expiresAtValue = response?.expires_at || response?.expiresAt;
      const parsedExpiry = expiresAtValue ? Date.parse(expiresAtValue) : NaN;
      const expiresAt = Number.isFinite(parsedExpiry)
        ? parsedExpiry
        : Date.now() + runtimeConfig.emailOtpExpirySeconds * 1000;
      const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      otpExpiresAtRef.current = expiresAt;
      setOtpExpiresAt(expiresAt);
      setOtpExpirySeconds(remaining);
      addToast?.(uiText("email.sentToast"), "success");
      return true;
    } catch (error) {
      if (error?.code === REQUEST_CODES.aborted) return false;
      setOtpStatus(OTP_STATUS.sendFailed);
      setResendCountdownActive(false);
      resendEndsAtRef.current = null;
      setEmailEditable(true);
      setOtpError(error?.message || getErrorMessage("SYS_002_0002"));
      onFailure?.(error);
      return false;
    }
  }, [addToast, otpLength]);

  const setOtpDigit = useCallback((index, value) => {
    const digitsOnly = String(value || "").replace(/\D/g, "");
    setOtpDigits((prev) => {
      const next = [...prev];
      next[index] = digitsOnly ? digitsOnly.slice(-1) : "";
      return next;
    });
  }, []);

  const setOtpFromPaste = useCallback((index, value) => {
    const digitsOnly = String(value || "").replace(/\D/g, "");
    if (!digitsOnly) return;
    setOtpDigits((prev) => {
      const next = [...prev];
      const slice = digitsOnly.slice(0, otpLength - index);
      slice.split("").forEach((digit, offset) => {
        next[index + offset] = digit;
      });
      return next;
    });
  }, [otpLength]);

  const verifyOtp = useCallback(async () => {
    const effectivePublicId = requirePublicId(submittedPublicIdRef.current || publicId);
    const normalizedEmail = String(demographicsEmail || "").trim().toLowerCase();
    const normalizedOtp = String(otpValue || "").replace(/\D/g, "");
    if (!effectivePublicId || !normalizedEmail) {
      setOtpError(getErrorMessage("VAL_003_0001"));
      return;
    }
    if (!normalizedOtp || normalizedOtp.length !== otpLength) {
      setOtpError(getErrorMessage("AUTH_003_0001"));
      return;
    }
    if (!isOnline) {
      setOtpError(uiText("email.offlineBanner"));
      return;
    }
    setOtpStatus(OTP_STATUS.verifying);
    setOtpError("");
    try {
      await endpoints.verifyEmailOtp(effectivePublicId, normalizedEmail, normalizedOtp);
      setOtpStatus(OTP_STATUS.verified);
      forEachStorageArea((area) => {
        removeStoredKey(scopedOtpKey, area);
      });
      addToast?.(uiText("email.verifiedToast"), "success");
      onEmailVerified?.();
    } catch (error) {
      if (error?.code === REQUEST_CODES.aborted) return;
      setOtpStatus(OTP_STATUS.verifyFailed);
      autoVerifyRef.current = "";
      setOtpDigits(Array.from({ length: otpLength }, () => ""));
      setEmailEditable(true);
      setOtpError(error?.message || getErrorMessage("SYS_002_0002"));
    }
  }, [addToast, demographicsEmail, isOnline, onEmailVerified, otpLength, otpValue, publicId, scopedOtpKey]);

  useEffect(() => {
    if (![OTP_STATUS.sent, OTP_STATUS.verifyFailed].includes(otpStatus)) return;
    if (!otpValue || otpValue.length !== otpLength) return;
    if (autoVerifyRef.current === otpValue) return;
    autoVerifyRef.current = otpValue;
    void verifyOtp();
  }, [otpLength, otpStatus, otpValue, verifyOtp]);

  const handleResend = useCallback(async () => {
    const effectivePublicId = requirePublicId(submittedPublicIdRef.current || publicId);
    const normalizedEmail = String(demographicsEmail || "").trim().toLowerCase();
    if (!effectivePublicId || !normalizedEmail) {
      setOtpError(getErrorMessage("VAL_003_0001"));
      return;
    }
    if (!isOnline) {
      setOtpError(uiText("email.offlineRequest"));
      return;
    }
    const emailUpdate = Boolean(submittedEmailRef.current && submittedEmailRef.current !== normalizedEmail);
    await requestOtp({
      effectivePublicId,
      normalizedEmail,
      emailUpdate,
    });
  }, [demographicsEmail, isOnline, publicId, requestOtp]);

  return {
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
  };
}
