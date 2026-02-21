import React, { useState, useEffect, useRef, useCallback } from "react";
import { getApiUrl } from "../utils/apiBase";

export default function PaymentLinkPage({ 
  onNext, 
  onBack,
  publicId
}) {
  const [paymentData, setPaymentData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  
  // Timer state
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [timerProgress, setTimerProgress] = useState(100);
  const timerIntervalRef = useRef(null);
  
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

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
        setError("Payment session has expired. Please go back and create a new payment.");
      }
    };

    updateTimer(); // Initial update
    timerIntervalRef.current = setInterval(updateTimer, 1000);
  }, [calculateTimerValues, saveTimerState]);

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
      // Check if the stored expiry is still valid
      const { remaining, progress } = calculateTimerValues(expiresAt);

      if (remaining > 0 && progress > 0) {
        setTimeRemaining(remaining);
        setTimerProgress(progress);

        // Set up the timer interval directly
        if (timerIntervalRef.current) {
          clearInterval(timerIntervalRef.current);
        }

        const updateTimer = () => {
          const values = calculateTimerValues(expiresAt);
          setTimeRemaining(values.remaining);
          setTimerProgress(values.progress);

          if (values.remaining <= 0) {
            clearInterval(timerIntervalRef.current);
            setError("Payment session has expired. Please go back and create a new payment.");
          }
        };

        updateTimer();
        timerIntervalRef.current = setInterval(updateTimer, 1000);
      } else {
        // Timer has expired, clear state
        clearTimerState();
        setTimeRemaining(0);
        setTimerProgress(100);
      }
    } else if (paymentData?.expires_at) {
      // Start timer on first load
      startTimer(paymentData.expires_at);
    }
  }, [paymentData, getTimerState, clearTimerState, calculateTimerValues, startTimer]);

  const createPayment = async () => {
    if (!publicId) {
      setError("We couldn't find your registration details. Please go back and complete the registration form.");
      return;
    }

    setIsLoading(true);
    setError(null);

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
      
      if (err.message.includes("participant not found")) {
        errorMessage = "We couldn't find your registration. Please go back and complete the registration form first.";
      } else if (err.message.includes("expired")) {
        errorMessage = err.message;
      } else if (err.message.includes("network") || err.message.includes("fetch")) {
        errorMessage = "We're having trouble connecting to our servers. Please check your internet connection and try again.";
      } else if (err.message) {
        errorMessage = err.message;
      }
      
      setError(errorMessage);
      sessionStorage.removeItem("payment_id");
    } finally {
      setIsLoading(false);
    }
  };

  const handleRetry = () => {
    sessionStorage.removeItem("payment_id");
    clearTimerState();
    setPaymentData(null);
    setError(null);
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

  return (
    <div className="panel payment-panel">
      <div className="page-top-actions">
        {onBack && (
          <button className="ghost back-button" onClick={onBack}>
            ← Back
          </button>
        )}
      </div>

      {error && (
        <div className="banner warning spaced">
          {error}
        </div>
      )}

      <div className="payment-header">
        <div className="payment-header-emoji" aria-hidden="true">📱</div>
        <h2 className="payment-title">{isMobile ? "Pay with UPI" : "Scan QR Code"}</h2>
        <p className="payment-subtitle">Time remaining: {formatTime(timeRemaining)}</p>
      </div>

      <div className="payment-content">
        {paymentData && (
          <section className="payment-card">
            <div className="payment-qr-container">
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
                    {formatTime(timeRemaining)}
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
                </>
              )}
            </div>
            {paymentData.upi_note && (
              <p className="payment-note" style={{ marginTop: '10px', fontWeight: 'bold' }}>
                Payment Note: {paymentData.upi_note}
              </p>
            )}
          </section>
        )}

        <section className="payment-card">
          <h3>
            <span className="payment-card-emoji" aria-hidden="true">⚠️</span>
            Important
          </h3>
          <ul className="payment-steps">
            <li>Pay exactly ₹1 using the UPI app</li>
            <li>Keep the payment screenshot ready</li>
            <li>You will upload the screenshot on the next page</li>
            <li>Payment is valid for {formatTime(timeRemaining)}</li>
          </ul>
        </section>

        <div className="page-actions">
          <button className="primary" onClick={onNext}>
            Continue to Upload Screenshot
          </button>
        </div>
      </div>
    </div>
  );
}
