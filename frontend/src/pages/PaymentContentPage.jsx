import React from "react";

export default function PaymentContentPage({ onNext, onBack }) {
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

      <div className="page-actions">
        <button className="primary" onClick={onNext}>
          Continue to Payment
        </button>
      </div>
    </div>
  );
}
