import React, { useState, useEffect, useRef, useCallback } from "react";
import { endpoints } from "../utils/api.js";
import { getErrorMessage } from "../utils/errorRegistry.js";

const VERIFICATION_REASON_CODES = {
  unrecognized_app: 'FRAUD_001_0003',
  duplicate_transaction_id: 'DUP_003_0002',
  invalid_banking_name: 'FRAUD_002_0001',
  invalid_amount: 'FRAUD_002_0003',
  time_out_of_range: 'FRAUD_002_0008',
  invalid_timestamp: 'FRAUD_002_0007',
  missing_timestamp: 'FRAUD_002_0007',
  ocr_unavailable: 'SYS_001_0004'
};

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

  const getVerificationErrorMessage = (reasons = []) => {
    if (!reasons.length) return "";
    return reasons
      .map((reason) => {
        const errorCode = VERIFICATION_REASON_CODES[reason];
        return errorCode ? getErrorMessage(errorCode) : reason;
      })
      .join('. ');
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

  // Get QR code container style with animated border and glow
  const getQrContainerStyle = () => {
    const color = getTimerColor();
    const progressAngle = Math.max(0, Math.min(360, (timerProgress / 100) * 360));
    return {
      borderRadius: '16px',
      background: 'var(--panel)',
      width: '100%',
      position: 'relative',
      backgroundImage: `linear-gradient(var(--panel), var(--panel)), conic-gradient(from -90deg, ${color} 0deg ${progressAngle}deg, var(--border-light) ${progressAngle}deg 360deg)`,
      backgroundOrigin: 'border-box',
      backgroundClip: 'padding-box, border-box',
      border: '3px solid transparent',
      boxShadow: `0 0 20px ${color}30, 0 4px 12px rgba(0,0,0,0.1)`,
      transition: 'box-shadow 0.5s ease, background 0.5s ease',
      animation: timerProgress <= 30 ? `qr-glow 1.5s ease-in-out infinite${timerProgress <= 15 ? ', timer-pulse 1s ease-in-out infinite' : ''}` : 'none',
      overflow: 'hidden',
    };
  };

  // Handle payment expiry
  const handleExpiry = useCallback(() => {
    setPaymentStatus("expired");
    setError(getErrorMessage('PAY_001_0001'));
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

  // Restore timer state from sessionStorage on page refresh
  useEffect(() => {
    if (!paymentData || timerIntervalRef.current) return;

    const expiresAt = getTimerState();
    if (expiresAt) {
      const { remaining } = calculateTimerValues(expiresAt);
      if (remaining > 0) {
        startTimer(expiresAt);
      } else {
        clearTimerState();
        handleExpiry();
      }
    }

    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
    };
  }, [paymentData, getTimerState, clearTimerState, calculateTimerValues, startTimer, handleExpiry]);

  const createPayment = async () => {
    if (!publicId) {
      setError(getErrorMessage('SYS_002_0010'));
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const data = await endpoints.createPayment(publicId, 1);
      sessionStorage.setItem("payment_id", data.payment_id);

      const expiresAt = new Date(data.expires_at);
      const now = new Date();
      if (expiresAt <= now) {
        throw new Error(getErrorMessage('PAY_001_0001'));
      }

      setPaymentData(data);
      startTimer(data.expires_at);
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
      const errorMessage = err.code
        ? getErrorMessage(err.code)
        : err.message || getErrorMessage('SYS_002_0009');
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
        setError(getErrorMessage('VAL_003_0004'));
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        setError(getErrorMessage('VAL_003_0005'));
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

  const fileToBase64 = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result);
      reader.onerror = (error) => reject(error);
    });
  };

  const handleUploadAndFinalize = async () => {
    if (!uploadFile) {
      setError(getErrorMessage('VAL_003_0006'));
      return;
    }

    if (!paymentData?.payment_id) {
      setError(getErrorMessage('SYS_002_0011'));
      return;
    }

    setVerifying(true);
    setError(null);

    try {
      // Extract file extension from uploaded file
      const fileExtension = uploadFile.name.split('.').pop().toLowerCase();

      // Step 1: Convert file to base64
      const imageBase64 = await fileToBase64(uploadFile);

      // Step 2: Calculate SHA256
      const sha256 = await calculateSha256(uploadFile);

      // Step 3: Call verify-upload endpoint which handles verification and S3 upload
      const verifyData = await endpoints.verifyUpload(
        paymentData.payment_id,
        imageBase64,
        fileExtension,
        sha256
      );

      // Check verification result
      const verification = verifyData.verification;

      if (verification?.verified && verification.status === "rejected_fraud") {
        setPaymentStatus("rejected_fraud");
        setVerifying(false);
        const reasons = verification.failure_reasons || [];
        setFailureReasons(reasons);
        const specificError = getVerificationErrorMessage(reasons);
        setError(specificError || getErrorMessage('FRAUD_002_0009'));
        return;
      }

      if (verification?.verified && verification.status === "success") {
        setPaymentStatus("success");
        sessionStorage.removeItem("payment_id");
        clearTimerState();
        await onNext();
        return;
      }

      // Fall back to polling status endpoint for async processing
      const statusData = await endpoints.getPaymentStatus(paymentData.payment_id);

      if (statusData.status === "rejected_fraud") {
        setPaymentStatus("rejected_fraud");
        setVerifying(false);
        const reasons = statusData.verification_details?.failure_reasons || [];
        setFailureReasons(reasons);
        const specificError = getVerificationErrorMessage(reasons);
        setError(specificError || getErrorMessage('FRAUD_002_0009'));
        return;
      }

      if (statusData.status === "expired") {
        handleExpiry();
        return;
      }

      if (statusData.status === "success") {
        setPaymentStatus("success");
        sessionStorage.removeItem("payment_id");
        clearTimerState();
        await onNext();
        return;
      }

      if (verification?.status === "error") {
        setVerifying(false);
        setError(getErrorMessage('SYS_002_0012'));
        return;
      }

      setVerifying(false);
      setError(getErrorMessage('SYS_002_0013'));
    } catch (err) {
      // Handle specific error codes with better messaging
      if (err.code === 'PAY_001_0001' || err.code === 'ERR_PAYMENT_EXPIRED') {
        handleExpiry();
        return;
      }

      if (err.code) {
        setError(getErrorMessage(err.code));
      } else if (err.message && err.message.toLowerCase().includes('timeout')) {
        setError(getErrorMessage('SYS_002_0008'));
      } else if (err.message && err.message.toLowerCase().includes('fetch')) {
        setError(getErrorMessage('SYS_002_0007'));
      } else {
        setError(getErrorMessage('SYS_002_0013'));
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
          {error || getErrorMessage('PAY_001_0001')}
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
          {error || getErrorMessage('FRAUD_002_0009')}
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
          <section className="payment-card highlight">
            <h3>
              <span className="payment-card-emoji" aria-hidden="true">⚠️</span>
              Important Instructions
            </h3>
            <ul className="payment-steps">
              <li>Pay exactly ₹1 using a UPI app</li>
              <li><strong>Use only: Google Pay, Paytm, or BHIM</strong></li>
              <li>Take a screenshot immediately after payment</li>
              <li>Upload the screenshot below to verify</li>
              <li>Payment session expires in {formatTime(timeRemaining)}</li>
            </ul>
          </section>
        )}

        {paymentStatus === "pending" && (
          <section className="payment-card">
            <h3>
              <span className="payment-card-emoji" aria-hidden="true">📤</span>
              Upload Payment Screenshot
            </h3>
            <p>After completing the payment, upload a screenshot from Google Pay, Paytm, or BHIM.</p>

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
      </div>
    </div>
  );
}
