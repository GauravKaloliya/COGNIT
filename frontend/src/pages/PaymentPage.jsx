import React, { useState, useEffect } from "react";
import { getApiUrl } from "../utils/apiBase";
import QRCode from "react-qr-code";

export default function PaymentPage({ 
  onPaymentComplete, 
  onBack,
  systemReady,
  publicId
}) {
  const [paymentChecked, setPaymentChecked] = useState(false);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [paymentData, setPaymentData] = useState(null);
  const [loadingPayment, setLoadingPayment] = useState(false);

  const UPI_LINK = "upi://pay?pa=iamgaurav225@okaxis&pn=C.O.G.N.I.T.&am=1.00&cu=INR";

  useEffect(() => {
    document.title = "Payment - C.O.G.N.I.T.";
    
    // Detect mobile device
    const checkMobile = () => {
      const userAgent = navigator.userAgent || navigator.vendor || window.opera;
      const mobileRegex = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i;
      const isMobileDevice = mobileRegex.test(userAgent.toLowerCase());
      const isSmallScreen = window.innerWidth <= 768;
      setIsMobile(isMobileDevice || isSmallScreen);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const createPayment = async () => {
    setLoadingPayment(true);
    setError(null);
    
    try {
      const response = await fetch(getApiUrl('/payments/create'), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          public_id: publicId,
          amount: 1.00
        })
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        // If payment endpoint fails (not configured), use fallback
        if (response.status === 500 && data.error?.includes("payment creation failed")) {
          setPaymentData({
            upi_link: UPI_LINK,
            amount: 1.00,
            is_fallback: true
          });
          return;
        }
        throw new Error(data.error || "Failed to create payment");
      }

      const data = await response.json();
      setPaymentData(data);
    } catch (err) {
      // Fallback to basic UPI link if backend fails
      setPaymentData({
        upi_link: UPI_LINK,
        amount: 1.00,
        is_fallback: true
      });
    } finally {
      setLoadingPayment(false);
    }
  };

  useEffect(() => {
    if (systemReady && publicId) {
      createPayment();
    }
  }, [systemReady, publicId]);

  const handleSubmit = async () => {
    if (!systemReady) {
      setError("System is not ready. Please wait for the connection to be established.");
      return;
    }

    if (!paymentChecked) {
      setError("You must agree to the payment terms to continue");
      return;
    }

    if (!publicId) {
      setError("Participant details are missing. Please restart the study.");
      return;
    }

    setError(null);
    setSubmitting(true);

    try {
      await onPaymentComplete();
    } catch (err) {
      setError(err.message || "Failed to confirm participation. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const openUpiLink = () => {
    window.location.href = UPI_LINK;
  };

  return (
    <div className="panel payment-panel">
      <div className="page-top-actions">
        {onBack && (
          <button
            className="ghost back-button"
            onClick={onBack}
          >
            ← Back
          </button>
        )}
      </div>

      <div className="payment-header">
        <div className="payment-header-emoji" aria-hidden="true">🎁</div>
        <h2 className="payment-title">Pay ₹1 & Win ₹10</h2>
        <p className="payment-subtitle">Pay ₹1 → Participate → Get a chance to receive ₹10</p>
        <p className="payment-tagline">Small payment. Real reward.</p>
      </div>

      <div className="payment-content">
        {loadingPayment ? (
          <div className="payment-loading">
            <div className="spinner"></div>
            <p>Setting up payment...</p>
          </div>
        ) : isMobile ? (
          <section className="payment-card highlight">
            <h3>
              <span className="payment-card-emoji" aria-hidden="true">📱</span>
              Pay ₹1 via UPI
            </h3>
            <p>Click the button below to open your UPI app and pay ₹1.</p>
            <p className="payment-amount">Amount: <strong>₹1.00</strong></p>
            <button 
              className="primary upi-button"
              onClick={openUpiLink}
            >
              Pay ₹1 via UPI
            </button>
            <p className="payment-note">After payment, come back and confirm below.</p>
          </section>
        ) : (
          <section className="payment-card highlight">
            <h3>
              <span className="payment-card-emoji" aria-hidden="true">💻</span>
              Pay ₹1 via QR Code
            </h3>
            <p>Scan the QR code using your UPI app to pay ₹1.</p>
            <div className="qr-container">
              <QRCode 
                value={UPI_LINK} 
                size={200}
                level={"M"}
                includeMargin={true}
              />
            </div>
            <p className="payment-amount">Amount: <strong>₹1.00</strong></p>
            <p className="payment-note">After payment, come back and confirm below.</p>
          </section>
        )}

        <section className="payment-card">
          <h3>
            <span className="payment-card-emoji" aria-hidden="true">⚡</span>
            How It Works
          </h3>
          <ol className="payment-steps">
            <li><span className="payment-step-emoji" aria-hidden="true">1️⃣</span> Pay ₹1 using UPI</li>
            <li><span className="payment-step-emoji" aria-hidden="true">2️⃣</span> Confirm your payment below</li>
            <li><span className="payment-step-emoji" aria-hidden="true">3️⃣</span> Your entry is added to the active pool</li>
            <li><span className="payment-step-emoji" aria-hidden="true">4️⃣</span> Winners are selected</li>
            <li><span className="payment-step-emoji" aria-hidden="true">5️⃣</span> ₹10 is sent via UPI (24–48 hours)</li>
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

        <section className="payment-card">
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

      {error && (
        <div className="banner warning spaced">
          {error}
        </div>
      )}

      <div className={`consent-checkbox payment-checkbox ${error && !paymentChecked ? 'error' : ''}`}>
        <input
          type="checkbox"
          checked={paymentChecked}
          onChange={(e) => {
            setPaymentChecked(e.target.checked);
            if (error) setError(null);
          }}
          id="payment-check"
        />
        <label htmlFor="payment-check" className="consent-text">
          I have paid ₹1 via UPI and understand my participation gives me a chance to receive ₹10 via UPI based on selection.
        </label>
      </div>

      <div className="page-actions payment-actions">
        <button
          className="primary payment-cta"
          onClick={handleSubmit}
          disabled={!systemReady || submitting || !paymentChecked}
        >
          {submitting ? "Processing..." : "✓ I've Paid - Start Survey"}
        </button>
      </div>
    </div>
  );
}
