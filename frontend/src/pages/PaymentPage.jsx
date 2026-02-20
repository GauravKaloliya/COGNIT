import React, { useState, useEffect } from "react";
import { getApiUrl } from "../utils/apiBase";

export default function PaymentPage({ 
  onPaymentComplete, 
  onBack,
  systemReady,
  publicId
}) {
  const [paymentChecked, setPaymentChecked] = useState(false);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    document.title = "Payment - C.O.G.N.I.T.";
  }, []);

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
      // Note: The new backend API doesn't have a payment confirmation endpoint
      // Payment status is tracked in the schema but not exposed via API
      // For now, we just proceed to the survey
      await onPaymentComplete();
    } catch (err) {
      setError(err.message || "Failed to confirm participation. Please try again.");
    } finally {
      setSubmitting(false);
    }
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
        <h2 className="payment-title">Win ₹10</h2>
        <p className="payment-subtitle">Participate → Get a chance to receive ₹10</p>
        <p className="payment-tagline">Free entry. Real reward.</p>
      </div>

      <div className="payment-content">
        <section className="payment-card">
          <h3>
            <span className="payment-card-emoji" aria-hidden="true">💰</span>
            Free Participation
          </h3>
          <p>Your participation enters you into the reward pool at no cost.</p>
          <ul className="payment-list">
            <li>Instant participation</li>
            <li>No entry fee required</li>
          </ul>
        </section>

        <section className="payment-card">
          <h3>
            <span className="payment-card-emoji" aria-hidden="true">⚡</span>
            How It Works
          </h3>
          <ol className="payment-steps">
            <li><span className="payment-step-emoji" aria-hidden="true">1️⃣</span> Confirm participation</li>
            <li><span className="payment-step-emoji" aria-hidden="true">2️⃣</span> Your entry is added to the active pool</li>
            <li><span className="payment-step-emoji" aria-hidden="true">3️⃣</span> Winners are selected</li>
            <li><span className="payment-step-emoji" aria-hidden="true">4️⃣</span> ₹10 is sent via UPI (24–48 hours)</li>
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
          I understand my participation gives me a chance to receive ₹10 via UPI based on selection.
        </label>
      </div>

      <div className="page-actions payment-actions">
        <button
          className="primary payment-cta"
          onClick={handleSubmit}
          disabled={!systemReady || submitting || !paymentChecked}
        >
          {submitting ? "Processing..." : "🎯 Confirm & Start"}
        </button>
      </div>
    </div>
  );
}
