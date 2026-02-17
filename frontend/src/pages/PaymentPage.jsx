import React, { useState, useEffect } from "react";
import { getApiUrl } from "../utils/apiBase";

export default function PaymentPage({ 
  onPaymentComplete, 
  onBack,
  systemReady,
  participantId
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

    if (!participantId) {
      setError("Participant details are missing. Please restart the study.");
      return;
    }

    setError(null);
    setSubmitting(true);

    try {
      const response = await fetch(getApiUrl("/payment/create-order"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participant_id: participantId })
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Unable to initialize payment");
      }

      const data = await response.json();

      if (!window.Razorpay) {
        throw new Error("Payment gateway failed to load. Please refresh and try again.");
      }

      const options = {
        key: data.key,
        amount: data.amount,
        currency: data.currency || "INR",
        order_id: data.order_id,
        name: "C.O.G.N.I.T.",
        description: "Research participation fee",
        method: {
          upi: true,
          card: false,
          netbanking: false,
          wallet: false
        },
        prefill: {
          vpa: "success@razorpay"
        },
        config: {
          display: {
            preferences: {
              show_default_blocks: true
            }
          }
        },
        handler: async function (paymentResponse) {
          try {
            const verifyResponse = await fetch(getApiUrl("/payment/verify"), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(paymentResponse)
            });

            if (!verifyResponse.ok) {
              const verifyData = await verifyResponse.json().catch(() => ({}));
              throw new Error(verifyData.error || "Payment verification failed");
            }

            await onPaymentComplete();
          } catch (err) {
            setError(err.message || "Payment processing failed. Please try again.");
          } finally {
            setSubmitting(false);
          }
        },
        modal: {
          ondismiss: () => {
            setSubmitting(false);
          }
        }
      };

      const razorpay = new window.Razorpay(options);
      razorpay.on("payment.failed", () => {
        setError("Payment failed. Please try again.");
        setSubmitting(false);
      });
      razorpay.open();
    } catch (err) {
      setError(err.message || "Payment processing failed. Please try again.");
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
        <p className="payment-subtitle">Pay ₹1 → Get a chance to receive ₹10</p>
        <p className="payment-tagline">10X return. Minimal entry.</p>
      </div>

      <div className="payment-content">
        <section className="payment-card">
          <h3>
            <span className="payment-card-emoji" aria-hidden="true">💰</span>
            Entry Fee: ₹1
          </h3>
          <p>₹1 enters you into the reward pool.</p>
          <ul className="payment-list">
            <li>Instant participation</li>
            <li>Secure UPI checkout</li>
          </ul>
        </section>

        <section className="payment-card">
          <h3>
            <span className="payment-card-emoji" aria-hidden="true">⚡</span>
            How It Works
          </h3>
          <ol className="payment-steps">
            <li><span className="payment-step-emoji" aria-hidden="true">1️⃣</span> Pay ₹1</li>
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
          <div className="payment-note-box">
            Note: ₹1 entry fee is non-refundable.
          </div>
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
          I understand the ₹1 entry fee is non-refundable and gives me a chance to receive ₹10 via UPI.
        </label>
      </div>

      <div className="page-actions payment-actions">
        <button
          className="primary payment-cta"
          onClick={handleSubmit}
          disabled={!systemReady || submitting || !paymentChecked}
        >
          {submitting ? "Processing..." : "💰 Pay ₹1 & Start"}
        </button>
      </div>
    </div>
  );
}