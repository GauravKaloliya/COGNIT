import React from "react";
import PageSkeleton from "../components/PageSkeleton.jsx";
import DSCard from "../components/design/DSCard.jsx";
import DSButton from "../components/design/DSButton.jsx";
import { usePaymentContentPage } from "../hooks/usePaymentContentPage";
import { uiText } from "../utils/uiText";

export default function PaymentContentPage({ onNext, onBack }) {
  const {
    continuing,
    isOnline,
    paymentAmountLabel,
    rewardAmountLabel,
    handleContinue,
  } = usePaymentContentPage({ onNext });

  if (continuing) {
    return (
      <PageSkeleton
        title={uiText("payment.preparingTitle")}
        subtitle={uiText("payment.preparingSubtitle")}
        variant="payment"
      />
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
      {!isOnline && (
        <div className="banner warning">
          <span>{uiText("payment.offlineCreate")}</span>
        </div>
      )}

      <div className="payment-header">
        <div className="payment-header-emoji" aria-hidden="true">🎁</div>
        <h2 className="payment-title ds-title">Win {rewardAmountLabel}</h2>
        <p className="payment-subtitle">Participate → Get a chance to receive {rewardAmountLabel}</p>
        <p className="payment-tagline ds-subtle">{paymentAmountLabel} entry. Real reward.</p>
      </div>

      <div className="payment-content ds-stack">
        <DSCard className="payment-card">
          <h3>
            <span className="payment-card-emoji" aria-hidden="true">💰</span>
            {paymentAmountLabel} Participation
          </h3>
          <p>Your {paymentAmountLabel} entry enters you into the reward pool.</p>
          <ul className="payment-list">
            <li>Entry fee: {paymentAmountLabel}</li>
            <li>Chance to win {rewardAmountLabel} via UPI</li>
          </ul>
        </DSCard>

        <DSCard className="payment-card">
          <h3>
            <span className="payment-card-emoji" aria-hidden="true">⚡</span>
            How It Works
          </h3>
          <ol className="payment-steps">
            <li><span className="payment-step-emoji" aria-hidden="true">1️⃣</span> Pay {paymentAmountLabel} via UPI</li>
            <li><span className="payment-step-emoji" aria-hidden="true">2️⃣</span> Upload payment screenshot</li>
            <li><span className="payment-step-emoji" aria-hidden="true">3️⃣</span> Your entry is added to the pool</li>
            <li><span className="payment-step-emoji" aria-hidden="true">4️⃣</span> Winners receive {rewardAmountLabel} (24–48 hours)</li>
          </ol>
          <p className="payment-note">{uiText("payment.cleanDirect")}</p>
        </DSCard>

        <DSCard className="payment-card">
          <h3>
            <span className="payment-card-emoji" aria-hidden="true">🔥</span>
            Increase Your Odds
          </h3>
          <p>{uiText("payment.priorityIntro")}</p>
          <p className="payment-callout">{uiText("payment.priorityUnlock")}</p>
          <ul className="payment-checklist">
            <li><span aria-hidden="true">✔</span> Writing 120+ total words</li>
            <li><span aria-hidden="true">✔</span> Completing 3+ rounds</li>
          </ul>
          <p className="payment-note">{uiText("payment.priorityOutcome")}</p>
        </DSCard>

        <DSCard className="payment-card highlight">
          <h3>
            <span className="payment-card-emoji" aria-hidden="true">🎯</span>
            Reward Details
          </h3>
          <ul className="payment-list">
            <li>{rewardAmountLabel} per selected entry</li>
            <li>{uiText("payment.rewardDirectUpi")}</li>
            <li>{uiText("payment.rewardProcessed")}</li>
            <li>{uiText("payment.rewardNoMinimum")}</li>
          </ul>
        </DSCard>
      </div>

      <div className="page-actions sticky-mobile-actions">
        <DSButton variant="primary" onClick={handleContinue} disabled={!isOnline || continuing}>
          {uiText("payment.continueToPayment")}
        </DSButton>
      </div>
    </div>
  );
}
