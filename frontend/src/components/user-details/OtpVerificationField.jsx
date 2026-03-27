import React from "react";
import { uiText } from "../../utils/uiText.js";
import DSButton from "../design/DSButton.jsx";
import RefreshIcon from "../icons/RefreshIcon.jsx";
import LoadingSpinner from "../icons/LoadingSpinner.jsx";

export default function OtpVerificationField({
  showOtpField,
  otpDigits,
  otpLength,
  otpStatus,
  otpStatusConfig,
  otpError,
  otpExpiryMessage,
  showOtpExpiry,
  resendSeconds,
  otpStatusMessage,
  resendLabel,
  canResend,
  inputRefs,
  editableOtpIndex,
  toOtpDigits,
  setOtpDigit,
  setOtpFromPaste,
  handleResend,
  focusAdvanceDelayMs,
}) {
  if (!showOtpField) return null;

  return (
    <div className="form-field otp-field">
      <label>{uiText("email.otpLabel")} <span className="required" aria-label="required">*</span></label>

      <div className="otp-row">
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
              disabled={otpStatus === otpStatusConfig.verifying || otpStatus === otpStatusConfig.sending}
              onChange={(e) => {
                const raw = e.target.value;
                const digitsOnly = toOtpDigits(raw);

                if (index !== editableOtpIndex) {
                  inputRefs.current[editableOtpIndex]?.focus();
                  return;
                }

                setOtpDigit(index, digitsOnly);
                if (digitsOnly && index < otpLength - 1) {
                  window.setTimeout(() => inputRefs.current[index + 1]?.focus(), focusAdvanceDelayMs);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Backspace") {
                  e.preventDefault();
                  const effectiveIndex = index === editableOtpIndex ? index : editableOtpIndex;
                  const currentDigit = otpDigits[effectiveIndex];

                  if (index !== editableOtpIndex) {
                    inputRefs.current[effectiveIndex]?.focus();
                  }

                  if (currentDigit) {
                    setOtpDigit(effectiveIndex, "");
                    return;
                  }

                  const previousIndex = Math.max(0, effectiveIndex - 1);
                  if (previousIndex !== effectiveIndex) {
                    setOtpDigit(previousIndex, "");
                    window.setTimeout(() => inputRefs.current[previousIndex]?.focus(), focusAdvanceDelayMs);
                  }
                  return;
                }
                if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
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
                window.setTimeout(() => inputRefs.current[nextIndex]?.focus(), focusAdvanceDelayMs);
              }}
              onFocus={() => {
                if (index !== editableOtpIndex) inputRefs.current[editableOtpIndex]?.focus();
              }}
              aria-label={`${uiText("email.otpLabel")} ${index + 1}`}
            />
          ))}
        </div>

        <DSButton
          className="otp-resend-btn"
          variant="ghost"
          type="button"
          onClick={canResend ? handleResend : undefined}
          aria-disabled={!canResend}
          aria-label={resendLabel}
          title={resendLabel}
        >
          {otpStatus === otpStatusConfig.sending ? <LoadingSpinner /> : <RefreshIcon />}
        </DSButton>
      </div>

      {otpError && <span className="error-text">{otpError}</span>}
      {showOtpExpiry && <span className="helper-text warning">{otpExpiryMessage}</span>}
      {resendSeconds > 0 && (
        <span className="helper-text">{uiText("email.resendIn", { seconds: resendSeconds })}</span>
      )}
      {otpStatusMessage && <span className="checking-text">{otpStatusMessage}</span>}
    </div>
  );
}
