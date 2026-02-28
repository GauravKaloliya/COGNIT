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
        <div className="payment-header-emoji" aria-hidden="true">💸</div>
        <h2 className="payment-title">Payment Verification</h2>
        <p className="payment-subtitle">A small ₹1 fee verifies your identity</p>
        <p className="payment-tagline">Verified participants get paid for their work.</p>
      </div>

      <div className="payment-content">
        <section className="payment-card">
          <h3>
            <span className="payment-card-emoji" aria-hidden="true">🔐</span>
            Why ₹1?
          </h3>
          <p>The ₹1 payment is used to verify your UPI identity and prevent duplicate or bot submissions.</p>
          <ul className="payment-list">
            <li>Confirms your UPI ID is active</li>
            <li>Links your payment identity to your responses</li>
            <li>Enables us to pay you directly</li>
          </ul>
        </section>

        <section className="payment-card">
          <h3>
            <span className="payment-card-emoji" aria-hidden="true">⚡</span>
            How It Works
          </h3>
          <ol className="payment-steps">
            <li><span className="payment-step-emoji" aria-hidden="true">1️⃣</span> Pay ₹1 via UPI to verify your identity</li>
            <li><span className="payment-step-emoji" aria-hidden="true">2️⃣</span> Upload your payment screenshot</li>
            <li><span className="payment-step-emoji" aria-hidden="true">3️⃣</span> Complete the image description survey</li>
            <li><span className="payment-step-emoji" aria-hidden="true">4️⃣</span> Receive payment directly to your UPI within 24–48 hours</li>
          </ol>
        </section>

        <section className="payment-card highlight">
          <h3>
            <span className="payment-card-emoji" aria-hidden="true">🎯</span>
            Earnings
          </h3>
          <ul className="payment-list">
            <li>₹10 per completed survey round</li>
            <li>Paid directly to your verified UPI ID</li>
            <li>Processed within 24–48 hours of completion</li>
            <li>No minimum withdrawal — instant transfer</li>
          </ul>
        </section>

        <section className="payment-card">
          <h3>
            <span className="payment-card-emoji" aria-hidden="true">✅</span>
            Accepted UPI Apps
          </h3>
          <ul className="payment-checklist">
            <li><span aria-hidden="true">✔</span> Google Pay</li>
            <li><span aria-hidden="true">✔</span> PhonePe</li>
            <li><span aria-hidden="true">✔</span> Paytm</li>
            <li><span aria-hidden="true">✔</span> Amazon Pay</li>
            <li><span aria-hidden="true">✔</span> BHIM</li>
          </ul>
          <p className="payment-note">Only screenshots from approved UPI apps will be accepted.</p>
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
