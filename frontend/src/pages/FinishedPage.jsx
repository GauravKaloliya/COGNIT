import React, { useEffect, useState } from "react";
import { runtimeConfig } from "../config/runtime";
import PageSkeleton from "../components/PageSkeleton.jsx";
import PanelState from "../components/PanelState.jsx";

export default function FinishedPage({ surveyCompleted, publicId }) {
  const [rewardStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = "Thank You - C.O.G.N.I.T.";
    // Note: The new backend API doesn't have reward winner endpoints
    // Reward status would need to be checked via a different mechanism
    // For now, we just stop loading
    setLoading(false);
  }, [publicId]);

  const handleFinish = () => {
    // Preserve dark mode setting before clearing
    let darkMode = null;
    try {
      const stored = sessionStorage.getItem("darkMode");
      if (stored) {
        const parsed = JSON.parse(stored);
        darkMode = parsed?.data;
      }
    } catch {
      darkMode = null;
    }
    // Clear only flow/session keys for this app.
    [
      "stage",
      "paymentSubStage",
      "consentGiven",
      "paymentVerified",
      "demographics",
      "survey",
      "surveyCompleted",
      "surveyFeedbackReady",
      "shownImages",
      "payment_id",
      "payment_timer_expires_at",
      "payment_link_state_v1",
      "consent_checked_draft",
      "engagement_queue_v1"
    ].forEach((k) => {
      try {
        sessionStorage.removeItem(k);
      } catch {
        // Ignore storage remove failures.
      }
    });
    // Restore dark mode setting
    if (typeof darkMode === "boolean") {
      const now = Date.now();
      sessionStorage.setItem(
        "darkMode",
        JSON.stringify({
          __schema_version: runtimeConfig.uiStateSchemaVersion,
          saved_at: now,
          expires_at: now + runtimeConfig.uiStateTtlMs,
          data: darkMode
        })
      );
    }
    window.location.href = "/";
  };

  const isWinner = rewardStatus?.is_winner;
  const totalWords = rewardStatus?.total_words || 0;
  const priorityEligible = rewardStatus?.priority_eligible;

  if (loading) {
    return (
      <PageSkeleton
        title="Finalizing your session"
        subtitle="Wrapping up rewards and completion state"
        variant="finish"
      />
    );
  }

  return (
    <div className="panel finish-panel">
      <div className="finish-wrapper">
        <h2>Thank you for completing the C.O.G.N.I.T. survey</h2>
        <p className="page-subtitle">
          You have completed {surveyCompleted} survey{surveyCompleted !== 1 ? 's' : ''}!
          Your responses have been recorded.
        </p>
        
        {!loading && (
          <PanelState
            variant="success"
            icon={isWinner ? "★" : "✓"}
            title={isWinner ? "Congratulations!" : "Thank You for Participating"}
            message={
              isWinner
                ? "You've been selected as a reward winner. Your reward will be processed shortly."
                : "Your responses were recorded successfully and help improve image-text research quality."
            }
          >
            {totalWords > 0 && (
              <p className="finish-reward-body">
                You wrote <strong>{totalWords} words</strong> across your responses.
                {priorityEligible
                  ? " Your detailed participation puts you in the priority pool for future opportunities!"
                  : " Keep participating in future studies for more chances to win!"}
              </p>
            )}
          </PanelState>
        )}

        <div className="finish-reminder">
          <h4>💰 About the Reward Program</h4>
          <ul>
            <li>Participants are <strong>randomly selected</strong> to receive <strong>₹10 rewards</strong></li>
            <li>Active participants who write detailed descriptions get added to a <strong>priority list</strong></li>
            <li>Priority participants have <strong>higher chances</strong> of being selected</li>
            <li>Rewards are sent via <strong>UPI transfer</strong> within 24-48 hours</li>
            <li>If you&apos;re selected, you&apos;ll receive an email/SMS with payment confirmation</li>
          </ul>
        </div>

        <p className="debrief">
          Debrief: C.O.G.N.I.T. (Cognitive Network for Image & Text Modeling)
          advances our understanding of how humans describe visual content and how AI can better model this cognitive process. Your responses
          contribute to improving image-text understanding and generation systems.
        </p>

        <div className="page-actions sticky-mobile-actions">
          <button className="primary" onClick={handleFinish}>
            Finish
          </button>
        </div>
      </div>
    </div>
  );
}
