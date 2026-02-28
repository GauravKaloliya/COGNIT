import React, { useState, useEffect, useRef, useCallback } from "react";
import { getApiUrl } from "../utils/apiBase";
import { endpoints } from "../utils/api.js";
import { parseErrorResponse, getErrorMessage } from "../utils/errorRegistry.js";
import { handleApiError } from "../utils/api.js";

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
  const [verificationProgress, setVerificationProgress] = useState(0);
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
      'unrecognized_app': 'Screenshot not from an allowed UPI app. Please use Google Pay, Paytm, or BHIM.',
      'duplicate_transaction_id': 'This transaction has already been used. Please make a fresh payment.',
      'duplicate_screenshot': 'This screenshot has already been submitted. Please use a fresh payment screenshot.',
      'rejected_reuse': 'This screenshot was previously rejected. Please use a fresh payment screenshot.'
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

  // Get QR code container wrapper style with border filling animation
  const getQrBorderWrapperStyle = () => {
    const color = getTimerColor();
    const borderColor = 'var(--border)';
    return {
      borderRadius: '14px',
      padding: '3px',
      background: `conic-gradient(from 0deg, ${color} 0% ${timerProgress}%, ${borderColor} ${timerProgress}% 100%)`,
      boxShadow: `0 0 12px ${color}40`,
      transition: 'box-shadow 1s linear',
      animation: timerProgress <= 15 ? 'timer-pulse 1s ease-in-out infinite' : 'none',
      display: 'inline-flex',
      width: '100%',
    };
  };

  // Get QR code container style with border filling animation
  const getQrContainerStyle = () => {
    return {
      borderRadius: '12px',
      background: 'var(--panel)',
      width: '100%',
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
      const errorMessage = err.message || "We couldn't create the payment. Please try again.";
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

  // Convert file to base64
  const fileToBase64 = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result);
      reader.onerror = error => reject(error);
    });
  };

  // Simulate progress animation for verification
  const simulateProgress = () => {
    setVerificationProgress(0);
    const steps = [15, 30, 45, 60, 75, 85, 92, 97];
    let stepIndex = 0;
    
    const interval = setInterval(() => {
      if (stepIndex < steps.length) {
        setVerificationProgress(steps[stepIndex]);
        stepIndex++;
      } else {
        clearInterval(interval);
      }
    }, 400);
    
    return () => clearInterval(interval);
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
    const cleanupProgress = simulateProgress();

    try {
      // Convert file to base64
      const imageBase64 = await fileToBase64(uploadFile);
      const fileExtension = uploadFile.name.split('.').pop().toLowerCase();

      // Call the new verify-and-upload endpoint
      // This verifies FIRST, then uploads to S3 and database only if verified
      const result = await endpoints.verifyAndUploadPayment(
        paymentData.payment_id,
        imageBase64,
        fileExtension
      );

      cleanupProgress();
      setVerificationProgress(100);

      if (result.status === "rejected_fraud") {
        setPaymentStatus("rejected_fraud");
        setVerifying(false);
        const reasons = result.failure_reasons || [];
        setFailureReasons(reasons);
        const specificError = getVerificationErrorMessage(reasons);
        setError(specificError || "Your payment screenshot could not be verified. Please ensure you are using Google Pay, Paytm, or BHIM.");
        return;
      }

      if (result.status === "success" && result.verified) {
        setPaymentStatus("success");
        sessionStorage.removeItem("payment_id");
        clearTimerState();
        await onNext();
        return;
      }

      // Fallback error
      setError("Payment verification failed. Please try again.");

    } catch (err) {
      cleanupProgress();
      setVerificationProgress(0);
      
      // Handle specific error codes with better messaging
      if (err.code === 'PAY_001_0001' || err.code === 'ERR_PAYMENT_EXPIRED') {
        handleExpiry();
        return;
      }

      if (err.code === 'ERR_PAYMENT_NOT_FOUND') {
        setError("Payment session not found. Please create a new payment.");
        return;
      }

      if (err.code === 'ERR_INVALID_IMAGE_TYPE') {
        setError("Invalid image format. Please upload JPG, PNG, or WEBP images only.");
        return;
      }

      // Handle network and other errors
      if (err.message && err.message.includes('fetch')) {
        setError("Unable to connect to server. Please check your internet connection and try again.");
        return;
      }

      if (err.message && err.message.includes('timeout')) {
        setError("The request took too long. Please try again.");
        return;
      }

      // For any other errors, provide a more helpful message
      if (err.code) {
        setError(`Payment verification failed (${err.code}). Please try again or contact support if the problem persists.`);
      } else {
        setError("Payment verification failed. Please try again.");
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
    setVerificationProgress(0);
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

            <div style={!isMobile ? getQrBorderWrapperStyle() : undefined}>
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

        {/* Important Notice Box - Above Verification Box */}
        <section className="payment-card payment-notice-card">
          <h3>
            <span className="payment-card-emoji" aria-hidden="true">🔔</span>
            Important Notice
          </h3>
          <div className="payment-notice-content">
            <p><strong>Only verified payment screenshots will be accepted!</strong></p>
            <ul className="payment-steps">
              <li>✅ Accepted apps: <strong>Google Pay, Paytm, BHIM</strong> only</li>
              <li>✅ Make sure the transaction is <strong>successful</strong></li>
              <li>✅ Screenshot must show <strong>beneficiary name: Gaurav</strong></li>
              <li>✅ Amount must be exactly <strong>₹1</strong></li>
              <li>❌ Screenshots from other apps will be rejected</li>
            </ul>
          </div>
        </section>

        {paymentStatus === "pending" && (
          <section className="payment-card">
            <h3>
              <span className="payment-card-emoji" aria-hidden="true">📤</span>
              Upload Payment Screenshot
            </h3>
            <p>After completing the payment, upload a screenshot from Google Pay, Paytm, or BHIM.</p>

            {/* Verification Progress Animation */}
            {verifying && (
              <div className="verification-progress-container">
                <div className="verification-progress-bar">
                  <div 
                    className="verification-progress-fill" 
                    style={{ width: `${verificationProgress}%` }}
                  />
                </div>
                <div className="verification-progress-content">
                  <div className="verification-spinner-ring">
                    <div className="verification-spinner"></div>
                  </div>
                  <div className="verification-text">
                    <span className="verification-title">Verifying Payment</span>
                    <span className="verification-status">
                      {verificationProgress < 30 && "Reading screenshot..."}
                      {verificationProgress >= 30 && verificationProgress < 60 && "Extracting details..."}
                      {verificationProgress >= 60 && verificationProgress < 85 && "Validating payment..."}
                      {verificationProgress >= 85 && "Almost done..."}
                    </span>
                  </div>
                  <span className="verification-percentage">{verificationProgress}%</span>
                </div>
              </div>
            )}

            {!verifying && (
              <>
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
                  {verifying ? "Verifying..." : "Verify & Confirm Payment"}
                </button>
              </>
            )}
          </section>
        )}

        <section className="payment-card">
          <h3>
            <span className="payment-card-emoji" aria-hidden="true">⚠️</span>
            Important
          </h3>
          <ul className="payment-steps">
            <li>Pay exactly ₹1 using a UPI app</li>
            <li>Use only: Google Pay, Paytm, or BHIM</li>
            <li>Take a screenshot immediately after payment</li>
            <li>Upload the screenshot above to verify</li>
            <li>Payment session expires in {formatTime(timeRemaining)}</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
