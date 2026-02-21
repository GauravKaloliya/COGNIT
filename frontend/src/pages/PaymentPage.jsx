import React, { useState, useEffect, useRef, useCallback } from "react";
import { getApiUrl } from "../utils/apiBase";

export default function PaymentPage({ 
  onPaymentComplete, 
  onBack,
  systemReady,
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
      'missing_transaction_id': 'Transaction ID not found in screenshot.'
    };
    return reasons.map(r => messages[r] || r).join('. ');
  };

  // Timer state
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [timerProgress, setTimerProgress] = useState(100);
  const [timerStarted, setTimerStarted] = useState(false);
  const timerIntervalRef = useRef(null);

  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

  // Timer state persistence helpers
  const saveTimerState = useCallback((expiresAt) => {
    sessionStorage.setItem("payment_timer_expires_at", expiresAt);
    sessionStorage.setItem("payment_timer_started", "true");
  }, []);

  const clearTimerState = useCallback(() => {
    sessionStorage.removeItem("payment_timer_expires_at");
    sessionStorage.removeItem("payment_timer_started");
  }, []);

  const getTimerState = useCallback(() => {
    const expiresAt = sessionStorage.getItem("payment_timer_expires_at");
    const started = sessionStorage.getItem("payment_timer_started");
    return {
      expiresAt,
      started: started === "true"
    };
  }, []);

  // Calculate timer values based on expiry
  const calculateTimerValues = useCallback((expiresAt) => {
    const now = new Date().getTime();
    const expiry = new Date(expiresAt).getTime();
    const totalDuration = 5 * 60 * 1000; // 5 minutes in milliseconds
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
    if (timerProgress > 60) return '#27ae60'; // Green
    if (timerProgress > 30) return '#f39c12'; // Orange
    return '#e74c3c'; // Red
  };

  // Get border animation style
  const getButtonStyle = () => {
    if (!timerStarted) return undefined;

    const color = getTimerColor();
    const borderWidth = 3;
    return {
      border: `${borderWidth}px solid ${color}`,
      boxShadow: `0 0 10px ${color}40, 0 0 20px ${color}20`,
      animation: timerProgress <= 15 ? 'timer-pulse 1s ease-in-out infinite' : 'none',
    };
  };

  // Start the countdown timer
  const startTimer = useCallback((expiresAt) => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
    }

    // Save timer state to sessionStorage
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

    updateTimer(); // Initial update
    timerIntervalRef.current = setInterval(updateTimer, 1000);
  }, [calculateTimerValues, saveTimerState]);

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

  // Handle UPI link click to start timer
  const handleUpiLinkClick = useCallback(() => {
    if (!timerStarted && paymentData?.expires_at) {
      setTimerStarted(true);
      startTimer(paymentData.expires_at);
    }
  }, [timerStarted, paymentData, startTimer]);

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

    const { expiresAt, started } = getTimerState();

    if (started && expiresAt) {
      // Check if the stored expiry is still valid
      const { remaining, progress } = calculateTimerValues(expiresAt);

      if (remaining > 0 && progress > 0) {
        // Timer is still valid, restore state
        setTimerStarted(true);
        setTimeRemaining(remaining);
        setTimerProgress(progress);

        // Set up the timer interval directly (without saving state since it's already saved)
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

        updateTimer(); // Initial update
        timerIntervalRef.current = setInterval(updateTimer, 1000);
      } else {
        // Timer has expired, clear state
        clearTimerState();
        setTimerStarted(false);
        setTimeRemaining(0);
        setTimerProgress(100);
      }
    }
  }, [paymentData, getTimerState, clearTimerState, calculateTimerValues, handleExpiry]);

  const createPayment = async () => {
    if (!publicId) {
      setError("We couldn't find your registration details. Please go back and complete the registration form.");
      return;
    }

    setIsLoading(true);
    setError(null);

    // Clear any existing timer state when creating a new payment
    clearTimerState();
    setTimerStarted(false);
    setTimeRemaining(0);
    setTimerProgress(100);

    try {
      const response = await fetch(getApiUrl('/payments/create'), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          public_id: publicId,
          amount: 1
        })
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to create payment");
      }

      const data = await response.json();
      setPaymentData(data);
      sessionStorage.setItem("payment_id", data.payment_id);
      
      const expiresAt = new Date(data.expires_at);
      const now = new Date();
      if (expiresAt <= now) {
        throw new Error("The payment session has expired. Please try again to create a new payment.");
      }
    } catch (err) {
      let errorMessage = "We couldn't create the payment. Please try again.";
      
      // Provide user-friendly error messages
      if (err.message.includes("participant not found")) {
        errorMessage = "We couldn't find your registration. Please go back and complete the registration form first.";
      } else if (err.message.includes("expired")) {
        errorMessage = err.message; // Already user-friendly
      } else if (err.message.includes("network") || err.message.includes("fetch")) {
        errorMessage = "We're having trouble connecting to our servers. Please check your internet connection and try again.";
      } else if (err.message) {
        errorMessage = err.message;
      }
      
      setError(errorMessage);
      // Clear the payment_id on error to allow retry
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
      const uploadUrlResponse = await fetch(
        getApiUrl(`/payments/${paymentData.payment_id}/upload-url`),
        { method: "POST" }
      );

      if (!uploadUrlResponse.ok) {
        const data = await uploadUrlResponse.json();
        // Handle expired payment (410 Gone)
        if (uploadUrlResponse.status === 410 || data.error?.includes("expired")) {
          handleExpiry();
          throw new Error("Payment session has expired. Please create a new payment.");
        }
        throw new Error(data.error || "Failed to get upload URL");
      }

      const { upload_url, object_key } = await uploadUrlResponse.json();

      const uploadResponse = await fetch(upload_url, {
        method: "PUT",
        headers: { "Content-Type": uploadFile.type },
        body: uploadFile
      });

      if (!uploadResponse.ok) {
        throw new Error("We couldn't upload your screenshot. Please check your internet connection and try again.");
      }

      const sha256 = await calculateSha256(uploadFile);

      const finalizeResponse = await fetch(
        getApiUrl(`/payments/${paymentData.payment_id}/finalize`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ object_key, sha256 })
        }
      );

      if (!finalizeResponse.ok) {
        const data = await finalizeResponse.json();
        let errorMessage = "We couldn't verify your payment. Please try again.";
        
        // Handle expired payment (410 Gone)
        if (finalizeResponse.status === 410 || data.error?.includes("expired")) {
          handleExpiry();
          throw new Error("Payment session has expired. Please create a new payment.");
        }
        
        if (data.error) {
          if (data.error.includes("invalid state")) {
            errorMessage = "This payment has already been processed or has expired. Please start a new payment.";
          } else if (data.error.includes("duplicate")) {
            errorMessage = "This screenshot has already been submitted. Please use a different payment screenshot.";
          } else {
            errorMessage = data.error;
          }
        }
        
        throw new Error(errorMessage);
      }

      // Check payment status after finalize to see if verification passed or failed
      const statusResponse = await fetch(
        getApiUrl(`/payments/${paymentData.payment_id}/status`)
      );
      
      if (statusResponse.ok) {
        const statusData = await statusResponse.json();
        
        if (statusData.status === "rejected_fraud") {
          // Payment was rejected due to fraud detection
          setPaymentStatus("rejected_fraud");
          setVerifying(false);
          // Get failure reasons from verification_details if available
          const reasons = statusData.verification_details?.failure_reasons || [];
          setFailureReasons(reasons);
          // Show specific error messages based on failure reasons
          const specificError = getVerificationErrorMessage(reasons);
          setError(specificError || "Your payment screenshot could not be verified. Please ensure you are using a valid UPI app and the screenshot shows a successful transaction.");
          return;
        }
        
        if (statusData.status === "expired") {
          handleExpiry();
          throw new Error("Payment session has expired. Please create a new payment.");
        }
      }

      setPaymentStatus("success");
      sessionStorage.removeItem("payment_id");
      clearTimerState();
      await onPaymentComplete();
    } catch (err) {
      let errorMessage = err.message || "Payment verification failed. Please try again.";
      
      // Additional error context for upload/finalize failures
      if (err.message.includes("network") || err.message.includes("fetch")) {
        errorMessage = "We're having trouble connecting. Please check your internet connection and try again.";
      }
      
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
    setTimerStarted(false);
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

  // Show expired state
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

  // Show rejected_fraud state
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
        <div className="payment-header-emoji" aria-hidden="true">🎁</div>
        <h2 className="payment-title">Win ₹10</h2>
        <p className="payment-subtitle">Participate → Get a chance to receive ₹10</p>
        <p className="payment-tagline">₹1 entry. Real reward.</p>
      </div>

      {error && (
        <div className="banner warning spaced">
          {error}
        </div>
      )}

      <div className="payment-content">
        <section className="payment-card">
          <h3>
            <span className="payment-card-emoji" aria-hidden="true">💰</span>
            ₹1 Participation
          </h3>
          <p>Your ₹1 entry enters you into the reward pool.</p>
          <ul className="payment-list">
            <li>Entry fee: ₹1</li>
            <li>Chance to win ₹10 via UPI</li>
          </ul>
        </section>

        {paymentData && paymentStatus === "pending" && (
          <section className="payment-card">
            <h3>
              <span className="payment-card-emoji" aria-hidden="true">📱</span>
              {isMobile ? "Pay with UPI" : "Scan QR Code"}
            </h3>

            <div className="payment-qr-container">
              {isMobile ? (
                <a
                  href={paymentData.upi_link}
                  className="payment-upi-button"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={handleUpiLinkClick}
                  style={getButtonStyle()}
                >
                  <span>💳</span>
                  <span>Pay ₹1 with UPI</span>
                  {timerStarted && (
                    <span className="payment-upi-timer">
                      {paymentStatus === "expired" ? 'Expired' : formatTime(timeRemaining)}
                    </span>
                  )}
                </a>
              ) : (
                <>
                  <img
                    src={`data:image/png;base64,${paymentData.qr_base64}`}
                    alt="Payment QR Code"
                    className="payment-qr-code"
                  />
                  <p className="payment-note">Scan with any UPI app to pay ₹1</p>
                  {timerStarted && (
                    <p className="payment-note">
                      Time remaining: {paymentStatus === "expired" ? 'Expired' : formatTime(timeRemaining)}
                    </p>
                  )}
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
              Payment pending - upload screenshot after payment
            </div>
          </section>
        )}

        {paymentStatus === "pending" && (
          <section className="payment-card">
            <h3>
              <span className="payment-card-emoji" aria-hidden="true">📤</span>
              Upload Payment Screenshot
            </h3>
            <p>After completing the payment, please upload a screenshot of the transaction.</p>
            
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
            <span className="payment-card-emoji" aria-hidden="true">⚡</span>
            How It Works
          </h3>
          <ol className="payment-steps">
            <li><span className="payment-step-emoji" aria-hidden="true">1️⃣</span> Pay ₹1 via UPI</li>
            <li><span className="payment-step-emoji" aria-hidden="true">2️⃣</span> Upload payment screenshot</li>
            <li><span className="payment-step-emoji" aria-hidden="true">3️⃣</span> Your entry is added to the pool</li>
            <li><span className="payment-step-emoji" aria-hidden="true">4️⃣</span> Winners receive ₹10 (24–48 hours)</li>
          </ol>
          <p className="payment-note">Clean. Direct. Transparent.</p>
        </section>

        <section className="payment-card">
          <h3>
            <span className="payment-card-emoji" aria-hidden="true">🔥</span>
            Increase Your Odds
          </h3>
          <p>Participants who engage more receive higher selection priority.</p>
          <p className="payment-callout">Unlock Priority Status by:</p>
          <ul className="payment-checklist">
            <li><span aria-hidden="true">✔</span> Writing 120+ total words</li>
            <li><span aria-hidden="true">✔</span> Completing 3+ rounds</li>
          </ul>
          <p className="payment-note">More contribution → Higher probability.</p>
        </section>

        <section className="payment-card highlight">
          <h3>
            <span className="payment-card-emoji" aria-hidden="true">🎯</span>
            Reward Details
          </h3>
          <ul className="payment-list">
            <li>₹10 per selected entry</li>
            <li>Direct UPI transfer</li>
            <li>Processed within 24–48 hours</li>
            <li>No minimum withdrawal</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
