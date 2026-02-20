import React, { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

const UPI_LINK = "upi://pay?pa=iamgaurav225@okaxis&pn=C.O.G.N.I.T.&am=1.00&cu=INR";

const isDesktop = () => {
  return typeof window !== "undefined" && window.innerWidth > 768;
};

export default function FinishedPage({ surveyCompleted, publicId }) {
  const [rewardStatus, setRewardStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [desktop, setDesktop] = useState(false);

  useEffect(() => {
    document.title = "Thank You - C.O.G.N.I.T.";
    setDesktop(isDesktop());
    // Note: The new backend API doesn't have reward winner endpoints
    // Reward status would need to be checked via a different mechanism
    // For now, we just stop loading
    setLoading(false);
  }, [publicId]);

  const handleFinish = () => {
    // Preserve dark mode setting before clearing
    const darkMode = sessionStorage.getItem("darkMode");
    // Clear session storage and reload
    sessionStorage.clear();
    // Restore dark mode setting
    if (darkMode !== null) {
      sessionStorage.setItem("darkMode", darkMode);
    }
    window.location.href = "/";
  };

  const isWinner = rewardStatus?.is_winner;
  const totalWords = rewardStatus?.total_words || 0;
  const priorityEligible = rewardStatus?.priority_eligible;

  return (
    <div className="panel">
      <div className="finish-wrapper">
        <h2>Thank you for completing the C.O.G.N.I.T. survey</h2>
        <p className="page-subtitle">
          You have completed {surveyCompleted} survey{surveyCompleted !== 1 ? 's' : ''}!
          Your responses have been recorded.
        </p>
        
        {!loading && (
          <div className={`finish-reward ${isWinner ? "winner" : "default"}`}>
            {isWinner ? (
              <>
                <div className="finish-reward-icon">🎉</div>
                <h3 className="finish-reward-title">Congratulations!</h3>
                <p className="finish-reward-lead">
                  You've been selected as a reward winner!
                </p>
                <p className="finish-reward-body">
                  Thank you for your valuable participation. Your reward will be processed shortly.
                </p>
                {desktop ? (
                  <div className="finish-qr-section">
                    <p className="finish-reward-body">Scan the QR code below to receive your ₹10 reward:</p>
                    <div className="finish-qr-code">
                      <QRCodeSVG value={UPI_LINK} size={160} />
                    </div>
                  </div>
                ) : (
                  <div className="finish-upi-section">
                    <p className="finish-reward-body">Click the link below to receive your ₹10 reward:</p>
                    <a href={UPI_LINK} className="finish-upi-link">
                      Pay with UPI
                    </a>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="finish-reward-icon">🎁</div>
                <h3 className="finish-reward-title">Thank You for Participating!</h3>
                <p className="finish-reward-body">
                  Your responses are valuable to our research and contribute to advancing language understanding models.
                </p>
                {totalWords > 0 && (
                  <p className="finish-reward-body">
                    You wrote <strong>{totalWords} words</strong> across your responses.
                    {priorityEligible
                      ? " Your detailed participation puts you in the priority pool for future opportunities!"
                      : " Keep participating in future studies for more chances to win!"}
                  </p>
                )}
              </>
            )}
          </div>
        )}

        <div className="finish-reminder">
          <h4>💰 About the Reward Program</h4>
          <ul>
            <li>Participants are <strong>randomly selected</strong> to receive <strong>₹10 rewards</strong></li>
            <li>Active participants who write detailed descriptions get added to a <strong>priority list</strong></li>
            <li>Priority participants have <strong>higher chances</strong> of being selected</li>
            <li>Rewards are sent via <strong>UPI transfer</strong> within 24-48 hours</li>
            <li>If you're selected, you'll receive an email/SMS with payment confirmation</li>
          </ul>
        </div>

        <p className="debrief">
          Debrief: C.O.G.N.I.T. (Cognitive Network for Image & Text Modeling)
          advances our understanding of how humans describe visual content and how AI can better model this cognitive process. Your responses
          contribute to improving image-text understanding and generation systems.
        </p>

        <div className="page-actions">
          <button className="primary large" onClick={handleFinish}>
            Finish
          </button>
        </div>
      </div>
    </div>
  );
}
