import React, { useState, useEffect } from "react";

export default function OTPVerification({ 
  mobile, 
  onVerified, 
  onCancel,
  apiUrl 
}) {
  const [otp, setOtp] = useState("");
  const [verificationId, setVerificationId] = useState(null);
  const [status, setStatus] = useState("idle"); // idle, sending, sent, verifying, verified, error
  const [error, setError] = useState(null);
  const [canResend, setCanResend] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [isDemoMode, setIsDemoMode] = useState(false);

  useEffect(() => {
    // Start countdown timer after OTP is sent
    if (status === "sent" && countdown > 0) {
      const timer = setTimeout(() => {
        setCountdown(countdown - 1);
      }, 1000);
      return () => clearTimeout(timer);
    } else if (countdown === 0 && status === "sent") {
      setCanResend(true);
    }
  }, [countdown, status]);

  const sendOTP = async () => {
    setStatus("sending");
    setError(null);
    setCanResend(false);

    try {
      // Ensure no double slashes by normalizing the URL
      const baseUrl = apiUrl?.replace(/\/+$/, '') || '';
      const response = await fetch(`${baseUrl}/otp/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mobile })
      });

      const data = await response.json();

      if (response.ok) {
        setVerificationId(data.verificationId);
        setStatus("sent");
        setCountdown(60); // 60 seconds countdown before resend

        // Check if in demo mode
        if (data.demoMode) {
          setIsDemoMode(true);
          setError("Demo mode: Enter any 6-digit OTP (e.g., 123456)");
          // Keep the demo message visible
        }
      } else {
        throw new Error(data.error || "Failed to send OTP");
      }
    } catch (err) {
      setStatus("error");
      setError(err.message || "Failed to send OTP. Please try again.");
    }
  };

  const verifyOTP = async () => {
    if (!otp || otp.length !== 6) {
      setError("Please enter a valid 6-digit OTP");
      return;
    }

    setStatus("verifying");
    setError(null);

    try {
      // Ensure no double slashes by normalizing the URL
      const baseUrl = apiUrl?.replace(/\/+$/, '') || '';
      const response = await fetch(`${baseUrl}/otp/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          verificationId,
          otp,
          mobile
        })
      });

      const data = await response.json();

      if (response.ok && data.status === "verified") {
        setStatus("verified");
        onVerified();
      } else {
        throw new Error(data.message || data.error || "Invalid OTP");
      }
    } catch (err) {
      setStatus("sent");
      setError(err.message || "Failed to verify OTP. Please try again.");
    }
  };

  const handleResend = () => {
    setOtp("");
    setError(null);
    sendOTP();
  };

  // Auto-send OTP when component mounts
  useEffect(() => {
    if (status === "idle") {
      sendOTP();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleOtpChange = (e) => {
    const value = e.target.value.replace(/\D/g, "").slice(0, 6);
    setOtp(value);
    // Don't clear demo mode message
    if (error && !isDemoMode) {
      setError(null);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter" && otp.length === 6 && status === "sent") {
      verifyOTP();
    }
  };

  return (
    <div className="otp-verification-modal">
      <div className="otp-verification-content">
        <h3>Verify Your Phone Number</h3>
        <p className="otp-subtitle">
          {status === "sending" && "Sending OTP..."}
          {status === "sent" && (
            <>
              Enter the 6-digit OTP sent to +91 {mobile}
              {isDemoMode && (
                <span className="demo-mode-badge"> Demo Mode Active</span>
              )}
            </>
          )}
          {status === "verifying" && "Verifying OTP..."}
          {status === "verified" && "Phone number verified successfully!"}
          {status === "error" && "Failed to send OTP"}
        </p>

        {isDemoMode && (status === "sent" || status === "verifying") && (
          <div className="demo-mode-info">
            <strong>💡 Demo Mode:</strong> Enter any 6-digit number (e.g., 123456) to verify
          </div>
        )}

        {(status === "sent" || status === "verifying") && (
          <div className="otp-input-container">
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength="6"
              className="otp-input"
              placeholder="000000"
              value={otp}
              onChange={handleOtpChange}
              onKeyPress={handleKeyPress}
              disabled={status === "verifying"}
              autoFocus
            />
            {error && <span className="error-text">{error}</span>}
          </div>
        )}

        {status === "error" && (
          <div className="error-text">{error}</div>
        )}

        <div className="otp-actions">
          {(status === "sent" || status === "error") && (
            <>
              <button
                className="primary"
                onClick={verifyOTP}
                disabled={otp.length !== 6 || status === "verifying"}
              >
                Verify OTP
              </button>
              {canResend ? (
                <button
                  className="ghost"
                  onClick={handleResend}
                >
                  Resend OTP
                </button>
              ) : (
                <p className="resend-timer">
                  Resend OTP in {countdown}s
                </p>
              )}
            </>
          )}

          {status === "verifying" && (
            <div className="loading-spinner">Verifying...</div>
          )}

          {status === "sending" && (
            <div className="loading-spinner">Sending OTP...</div>
          )}

          {status === "verified" && (
            <div className="success-message">
              ✓ Phone number verified successfully!
            </div>
          )}

          {onCancel && status !== "verified" && status !== "verifying" && (
            <button
              className="ghost"
              onClick={onCancel}
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
