import React from "react";
import PageSkeleton from "../components/PageSkeleton.jsx";
import DSCard from "../components/design/DSCard.jsx";
import DSButton from "../components/design/DSButton.jsx";
import { usePaymentContentPage } from "../hooks/usePaymentContentPage";
import { uiText } from "../utils/uiText";
import { runtimeConfig } from "../config/runtime";
import PageStatusBanners from "../components/PageStatusBanners.jsx";
import ButtonRetryBadge from "../components/ButtonRetryBadge.jsx";
import PageActions from "../components/PageActions.jsx";

export default function PaymentContentPage({ onNext }) {
  const {
    continuing,
    isOnline,
    pendingContinue,
    retryCountdown,
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
      <PageStatusBanners
        isOnline={isOnline}
        offlineMessage={uiText("payment.offlineCreate")}
      />

      <div className="payment-header">
        <div className="icon-badge payment-emoji" aria-hidden="true">🎁</div>
        <h2 className="payment-title ds-title">{uiText("payment.contentTitle", { reward: rewardAmountLabel })}</h2>
        <p className="payment-subtitle">{uiText("payment.contentSubtitle", { reward: rewardAmountLabel })}</p>
        <p className="payment-tagline ds-subtle">{uiText("payment.contentTagline", { fee: paymentAmountLabel })}</p>
      </div>

      <div className="payment-content ds-stack">
        <DSCard className="payment-card tone-1">
          <div className="card-header">
            <h3>
              <span className="icon-badge" aria-hidden="true">💸</span>
              {uiText("payment.contentParticipationHeading", { fee: paymentAmountLabel })}
            </h3>
          </div>
          <div className="card-body">
            <p>{uiText("payment.contentParticipationIntro", { fee: paymentAmountLabel })}</p>
            <ul className="payment-list">
              <li>{uiText("payment.contentParticipationBullet1", { fee: paymentAmountLabel })}</li>
              <li>{uiText("payment.contentParticipationBullet2", { reward: rewardAmountLabel })}</li>
            </ul>
          </div>
        </DSCard>

        <DSCard className="payment-card tone-2">
          <div className="card-header">
            <h3>
              <span className="icon-badge" aria-hidden="true">🧾</span>
              {uiText("payment.contentHowItWorksHeading")}
            </h3>
          </div>
          <div className="card-body">
            <ol className="payment-steps compact">
              <li><span className="icon-badge" aria-hidden="true">1️⃣</span> {uiText("payment.contentStep1", { fee: paymentAmountLabel })}</li>
              <li><span className="icon-badge" aria-hidden="true">2️⃣</span> {uiText("payment.contentStep2")}</li>
              <li><span className="icon-badge" aria-hidden="true">3️⃣</span> {uiText("payment.contentStep3")}</li>
              <li><span className="icon-badge" aria-hidden="true">4️⃣</span> {uiText("payment.contentStep4", { reward: rewardAmountLabel })}</li>
            </ol>
            <p className="payment-note">{uiText("payment.cleanDirect")}</p>
          </div>
        </DSCard>

        <DSCard className="payment-card tone-3">
          <div className="card-header">
            <h3>
              <span className="icon-badge" aria-hidden="true">🚀</span>
              {uiText("payment.contentIncreaseOddsHeading")}
            </h3>
          </div>
          <div className="card-body">
            <p>{uiText("payment.priorityIntro")}</p>
            <p className="payment-callout">{uiText("payment.priorityUnlock")}</p>
            <ul className="payment-checklist">
              <li><span aria-hidden="true">✅</span> {uiText("payment.contentChecklist1", { words: runtimeConfig.priorityDescWordTarget })}</li>
              <li><span aria-hidden="true">✅</span> {uiText("payment.contentChecklist2", { rounds: runtimeConfig.priorityMinRounds })}</li>
            </ul>
            <p className="payment-note">{uiText("payment.priorityOutcome")}</p>
          </div>
        </DSCard>

        <DSCard className="payment-card tone-4">
          <div className="card-header">
            <h3>
              <span className="icon-badge" aria-hidden="true">🏆</span>
              {uiText("payment.contentRewardDetailsHeading")}
            </h3>
          </div>
          <div className="card-body">
            <ul className="payment-list">
              <li>{uiText("payment.contentRewardDetail1", { reward: rewardAmountLabel })}</li>
              <li>{uiText("payment.rewardDirectUpi")}</li>
              <li>{uiText("payment.rewardProcessed")}</li>
              <li>{uiText("payment.rewardNoMinimum")}</li>
            </ul>
          </div>
        </DSCard>
      </div>

      <PageActions sticky>
        <DSButton variant="primary" onClick={handleContinue} disabled={!isOnline || continuing}>
          {!isOnline && pendingContinue && retryCountdown > 0
            ? uiText("common.tryAgainIn", { seconds: retryCountdown })
            : uiText("payment.continueToPayment")}
          {!isOnline && pendingContinue && <ButtonRetryBadge seconds={retryCountdown} />}
        </DSButton>
      </PageActions>
    </div>
  );
}
