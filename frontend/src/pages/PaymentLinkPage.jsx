import React, { useState, useEffect, useRef, useCallback } from "react";
import { getApiUrl } from "../utils/apiBase";
import { endpoints } from "../utils/api.js";
import { getErrorMessage, handleApiError, parseErrorResponse } from "../utils/errors";

export default function PaymentLinkPage({ 
  onNext, 
  onBack,
  publicId
}) {
  const [paymentData, setPaymentData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState("pending");
  const [uploadFile, setUploadFile] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState(null);
  const [failureReasons, setFailureReasons] = useState([]);
  const fileInputRef = useRef(null);

  // Timer state
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [timerProgress, setTimerProgress] = useState(100);
  const timerIntervalRef = useRef(null);

  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

  const getVerificationErrorMessage = (reasons) => {
    const messages = {
      'low_resolution': 'Screenshot resolution too low. Please upload a clearer image.',
      'low_ocr_confidence': 'Could not read text clearly. Please retake screenshot.',
      'unrecognized_app': 'Screenshot not from an allowed UPI app (GPay, PhonePe, Paytm, etc.).',
      'vpa_mismatch': 'Payment not made to correct UPI ID.',
      'note_mismatch': 'Payment note does not match session. Please use exact note shown.',
      'amount_mismatch': 'Payment amount must be exactly ₹1.',
      'missing_success_indicator': 'Payment success status not detected.',
      'failure_indicator_present': 'Payment appears to have failed or is pending.',
      'missing_transaction_id': 'Transaction ID not found in screenshot.',
      'duplicate_transaction_id': 'This transaction has already been used. Please make a fresh payment.'
    };
    return reasons.map(r => messages[r] || r).join('. ');
  };

  // Timer state persistence helpers
  const saveTimerState = useCallback((expiresAt) => {
    sessionStorage.setItem("payment_timer_expires_at", expiresAt);
  }, []);

  const clearTimerState = useCallback(() => {
    sessionStorage.removeItem("payment_timer_expires_at");
  }, []);

  const getTimerState = useCallback(() => {
    return sessionStorage.getItem("payment_timer_expires_at");
  }, []);

  // Calculate timer values based on expiry
  const calculateTimerValues = useCallback((expiresAt) => {
    const now = new Date().getTime();
    const expiry = new Date(expiresAt).getTime();
    const totalDuration = 5 * 60 * 1000;
    const remaining = Math.max(0, expiry - now);
    const progress = Math.max(0, (remaining / totalDuration) * 100);
    return { remaining, progress };
  }, []);

  // Format time remaining into MM:SS
  const formatTime = (ms) => {
    const totalSeconds = Math.ceil(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  // Get timer color based on progress
  const getTimerColor = () => {
    if (timerProgress > 60) return '#27ae60';
    if (timerProgress > 30) return '#f39c12';
    return '#e74c3c';
  };

  // Get border animation style for UPI button
  const getButtonStyle = () => {
    const color = getTimerColor();
    return {
      border: `3px solid ${color}`,
      boxShadow: `0 0 10px ${color}40, 0 0 20px ${color}20`,
      animation: timerProgress <= 15 ? 'timer-pulse 1s ease-in-out infinite' : 'none',
    };
  };

  // Get QR code container style with filling border animation
  const getQrContainerStyle = () => {
    const color = getTimerColor();
    const filled = 100 - timerProgress;
    return {
      outline: `3px solid ${color}`,
      outlineOffset: '2px',
      boxShadow: `0 0 12px ${color}40`,
      background: `linear-gradient(to top, ${color}18 ${filled}%, transparent ${filled}%)`,
      transition: 'background 1s linear, outline-color 1s linear, box-shadow 1s linear',
      animation: timerProgress <= 15 ? 'timer-pulse 1s ease-in-out infinite' : 'none',
    };
  };

  // Handle payment expiry
  const handleExpiry = useCallback(() => {
    setPaymentStatus("expired");
    setError("Payment session has expired. Please create a new payment to continue.");
    sessionStorage.removeItem("payment_id");
    clearTimerState();
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
    }
  }, [clearTimerState]);

  // Start the countdown timer
  const startTimer = useCallback((expiresAt) => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
    }

    saveTimerState(expiresAt);

    const updateTimer = () => {
      const { remaining, progress } = calculateTimerValues(expiresAt);
      setTimeRemaining(remaining);
      setTimerProgress(progress);

      if (remaining <= 0) {
        clearInterval(timerIntervalRef.current);
        handleExpiry();
      }
    };

    updateTimer();
    timerIntervalRef.current = setInterval(updateTimer, 1000);
  }, [calculateTimerValues, saveTimerState, handleExpiry]);

  useEffect(() => {
    document.title = "Payment - C.O.G.N.I.T.";
    createPayment();

    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
    };
  }, []);

  // Restore timer state from sessionStorage on mount and when payment data changes
  useEffect(() => {
    if (!paymentData) return;

    const expiresAt = getTimerState();

    if (expiresAt) {
      const { remaining, progress } = calculateTimerValues(expiresAt);

      if (remaining > 0 && progress > 0) {
        setTimeRemaining(remaining);
        setTimerProgress(progress);

        if (timerIntervalRef.current) {
          clearInterval(timerIntervalRef.current);
        }

        const updateTimer = () => {
          const values = calculateTimerValues(expiresAt);
          setTimeRemaining(values.remaining);
          setTimerProgress(values.progress);

          if (values.remaining <= 0) {
            clearInterval(timerIntervalRef.current);
            handleExpiry();
          }
        };

        updateTimer();
        timerIntervalRef.current = setInterval(updateTimer, 1000);
      } else {
        clearTimerState();
        setTimeRemaining(0);
        setTimerProgress(100);
      }
    } else if (paymentData?.expires_at) {
      startTimer(paymentData.expires_at);
    }
  }, [paymentData, getTimerState, clearTimerState, calculateTimerValues, startTimer, handleExpiry]);

  const createPayment = async () => {
    if (!publicId) {
      setError("We couldn't find your registration details. Please go back and complete the registration form.");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const data = await endpoints.createPayment(publicId, 1);
      setPaymentData(data);
      sessionStorage.setItem("payment_id", data.payment_id);

      const expiresAt = new Date(data.expires_at);
      const now = new Date();
      if (expiresAt <= now) {
        throw new Error("The payment session has expired. Please try again to create a new payment.");
      }
    } catch (err) {
      // Log error to backend for analytics
      if (err.code) {
        endpoints.logClientError({
          error_code: err.code,
          error_message: err.message,
          page_url: window.location.href,
          extra_data: {
            category: err.category,
            severity: err.severity,
            action: err.action
          }
        }).catch(() => {});
      }
      const errorMessage = getErrorMessage(err, "We couldn't create the payment. Please try again.");
      setError(errorMessage);
      sessionStorage.removeItem("payment_id");
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (!file.type.startsWith('image/')) {
        setError("Please upload an image file (JPG, PNG, etc.) of your payment screenshot.");
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        setError("The file is too large. Please upload an image smaller than 5MB.");
        return;
      }
      setUploadFile(file);
      setError(null);
    }
  };

  const calculateSha256 = async (file) => {
    const arrayBuffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  };

  const handleUploadAndFinalize = async () => {
    if (!uploadFile) {
      setError("Please upload a screenshot of your payment first.");
      return;
    }

    if (!paymentData?.payment_id) {
      setError("We couldn't find your payment details. Please try again.");
      return;
    }

    setVerifying(true);
    setError(null);

    try {
      // Extract file extension from uploaded file
      const fileExtension = uploadFile.name.split('.').pop().toLowerCase();

      // Step 1: Get upload URL using API wrapper
      const { upload_url, object_key } = await endpoints.generateUploadUrl(
        paymentData.payment_id,
        fileExtension
      );

      // Step 2: Upload file to S3
      const uploadResponse = await fetch(upload_url, {
        method: "PUT",
        headers: { "Content-Type": uploadFile.type },
        body: uploadFile
      });

      if (!uploadResponse.ok) {
        throw new Error("We couldn't upload your screenshot. Please check your internet connection and try again.");
      }

      // Step 3: Calculate SHA256 and finalize
      const sha256 = await calculateSha256(uploadFile);
      const finalizeData = await endpoints.finalizePayment(
        paymentData.payment_id,
        object_key,
        sha256
      );

      // Check inline verification result first (avoids extra round-trip)
      const inlineVerification = finalizeData.verification;
      if (inlineVerification?.verified && inlineVerification.status === "rejected_fraud") {
        setPaymentStatus("rejected_fraud");
        setVerifying(false);
        const reasons = inlineVerification.failure_reasons || [];
        setFailureReasons(reasons);
        const specificError = getVerificationErrorMessage(reasons);
        setError(specificError || "Your payment screenshot could not be verified. Please ensure you are using a valid UPI app and the screenshot shows a successful transaction.");
        return;
      }

      if (inlineVerification?.verified && inlineVerification.status === "success") {
        setPaymentStatus("success");
        sessionStorage.removeItem("payment_id");
        clearTimerState();
        await onNext();
        return;
      }

      // Fall back to polling status endpoint
      const statusData = await endpoints.getPaymentStatus(paymentData.payment_id);

      if (statusData.status === "rejected_fraud") {
        setPaymentStatus("rejected_fraud");
        setVerifying(false);
        const reasons = statusData.verification_details?.failure_reasons || [];
        setFailureReasons(reasons);
        const specificError = getVerificationErrorMessage(reasons);
        setError(specificError || "Your payment screenshot could not be verified. Please ensure you are using a valid UPI app and the screenshot shows a successful transaction.");
        return;
      }

      if (statusData.status === "expired") {
        handleExpiry();
        throw new Error("Payment session has expired. Please create a new payment.");
      }

      setPaymentStatus("success");
      sessionStorage.removeItem("payment_id");
      clearTimerState();
      await onNext();
    } catch (err) {
      // Handle specific error codes
      if (err.code === 'PAY_001_0001' || err.code === 'ERR_PAYMENT_EXPIRED') {
        handleExpiry();
      }

      // Log error to backend for analytics
      if (err.code) {
        endpoints.logClientError({
          error_code: err.code,
          error_message: err.message,
          page_url: window.location.href,
          extra_data: {
            category: err.category,
            severity: err.severity,
            action: err.action,
            failure_reasons: failureReasons
          }
        }).catch(() => {});
      }

      const errorMessage = getErrorMessage(err, "Payment verification failed. Please try again.");
      setError(errorMessage);
    } finally {
      setVerifying(false);
    }
  };

  const handleRetry = () => {
    sessionStorage.removeItem("payment_id");
    clearTimerState();
    setPaymentData(null);
    setUploadFile(null);
    setPaymentStatus("pending");
    setError(null);
    setFailureReasons([]);
    setTimeRemaining(0);
    setTimerProgress(100);
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
    }
    createPayment();
  };

  if (isLoading) {
    return (
      <div className="panel payment-panel">
        <div className="page-top-actions">
          {onBack && (
            <button className="ghost back-button" onClick={onBack}>
              ← Back
            </button>
          )}
        </div>
        <div className="status-panel">
          <h2>Creating Payment</h2>
          <p className="status-message">Please wait...</p>
          <div className="spinner" />
        </div>
      </div>
    );
  }

  if (error && !paymentData) {
    return (
      <div className="panel payment-panel">
        <div className="page-top-actions">
          {onBack && (
            <button className="ghost back-button" onClick={onBack}>
              ← Back
            </button>
          )}
        </div>
        <div className="banner warning spaced">{error}</div>
        <div className="page-actions">
          <button className="primary" onClick={handleRetry}>
            Try Again
          </button>
        </div>
      </div>
    );
  }

  if (paymentStatus === "expired") {
    return (
      <div className="panel payment-panel">
        <div className="page-top-actions">
          {onBack && (
            <button className="ghost back-button" onClick={onBack}>
              ← Back
            </button>
          )}
        </div>
        <div className="payment-header">
          <div className="payment-header-emoji" aria-hidden="true">⏰</div>
          <h2 className="payment-title">Payment Expired</h2>
          <p className="payment-subtitle">Your payment session has timed out</p>
        </div>
        <div className="banner warning spaced">
          {error || "The payment session has expired. Please create a new payment to continue."}
        </div>
        <div className="page-actions">
          <button className="primary" onClick={handleRetry}>
            Create New Payment
          </button>
        </div>
      </div>
    );
  }

  if (paymentStatus === "rejected_fraud") {
    return (
      <div className="panel payment-panel">
        <div className="page-top-actions">
          {onBack && (
            <button className="ghost back-button" onClick={onBack}>
              ← Back
            </button>
          )}
        </div>
        <div className="payment-header">
          <div className="payment-header-emoji" aria-hidden="true">❌</div>
          <h2 className="payment-title">Payment Verification Failed</h2>
          <p className="payment-subtitle">We couldn't verify your payment screenshot</p>
        </div>
        <div className="banner warning spaced">
          {error || "Your payment screenshot could not be verified."}
        </div>
        {failureReasons.length > 0 && (
          <div className="payment-failure-details">
            <p><strong>Verification issues:</strong></p>
            <ul>
              {failureReasons.map((reason, index) => (
                <li key={index}>{getVerificationErrorMessage([reason])}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="page-actions">
          <button className="primary" onClick={handleRetry}>
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="panel payment-panel">
      <div className="page-top-actions">
        {onBack && (
          <button className="ghost back-button" onClick={onBack}>
            ← Back
          </button>
        )}
      </div>

      <div className="payment-header">
        <div className="payment-header-emoji" aria-hidden="true">📱</div>
        <h2 className="payment-title">{isMobile ? "Pay with UPI" : "Scan & Verify Payment"}</h2>
        <p className="payment-subtitle">
          {timeRemaining > 0
            ? `Time remaining: ${formatTime(timeRemaining)}`
            : "Complete payment and upload screenshot"}
        </p>
      </div>

      {error && (
        <div className="banner warning spaced">
          {error}
        </div>
      )}

      <div className="payment-content">
        {paymentData && paymentStatus === "pending" && (
          <section className="payment-card">
            <h3>
              <span className="payment-card-emoji" aria-hidden="true">💳</span>
              {isMobile ? "Pay with UPI" : "Scan QR Code"}
            </h3>

            <div className="payment-qr-container" style={!isMobile ? getQrContainerStyle() : undefined}>
              {isMobile ? (
                <a
                  href={paymentData.upi_link}
                  className="payment-upi-button"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={getButtonStyle()}
                >
                  <span>💳</span>
                  <span>Pay ₹1 with UPI</span>
                  <span className="payment-upi-timer">
                    {paymentStatus === "expired" ? 'Expired' : formatTime(timeRemaining)}
                  </span>
                </a>
              ) : (
                <>
                  <img
                    src={`data:image/png;base64,${paymentData.qr_base64}`}
                    alt="Payment QR Code"
                    className="payment-qr-code"
                  />
                  <p className="payment-note">Scan with any UPI app to pay ₹1</p>
                  <p className="payment-note" style={{ fontWeight: 600, color: getTimerColor() }}>
                    {paymentStatus === "expired" ? 'Expired' : formatTime(timeRemaining)}
                  </p>
                </>
              )}
            </div>

            {paymentData.upi_note && (
              <p className="payment-note" style={{ marginTop: '10px', fontWeight: 'bold' }}>
                Payment Note: {paymentData.upi_note}
              </p>
            )}

            <div className="payment-status-badge pending">
              <span>⏱️</span>
              Payment pending — upload screenshot after paying
            </div>
          </section>
        )}

        {paymentStatus === "pending" && (
          <section className="payment-card">
            <h3>
              <span className="payment-card-emoji" aria-hidden="true">📤</span>
              Upload Payment Screenshot
            </h3>
            <p>After completing the payment, upload a screenshot of the transaction.</p>

            <div
              className="payment-upload-area"
              onClick={() => fileInputRef.current?.click()}
            >
              {uploadFile ? (
                <div>
                  <p>✅ {uploadFile.name}</p>
                  <p className="payment-note">Click to change</p>
                </div>
              ) : (
                <div>
                  <p>📷</p>
                  <p>Click to upload payment screenshot</p>
                </div>
              )}
              <input
                type="file"
                ref={fileInputRef}
                accept="image/*"
                onChange={handleFileChange}
                style={{ display: 'none' }}
              />
            </div>

            <button
              className="primary"
              onClick={handleUploadAndFinalize}
              disabled={!uploadFile || verifying}
            >
              {verifying ? "Verifying..." : "Confirm Payment"}
            </button>
          </section>
        )}

        <section className="payment-card">
          <h3>
            <span className="payment-card-emoji" aria-hidden="true">⚠️</span>
            Important
          </h3>
          <ul className="payment-steps">
            <li>Pay exactly ₹1 using a UPI app</li>
            <li>Take a screenshot immediately after payment</li>
            <li>Upload the screenshot above to verify</li>
            <li>Payment session expires in {formatTime(timeRemaining)}</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
