import React, { useState, useEffect, useCallback } from "react";
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
  const [loading, setLoading] = useState(false);

  // UPI Payment State
  const [upiDetails, setUpiDetails] = useState(null);
  const [screenshot, setScreenshot] = useState(null);
  const [screenshotPreview, setScreenshotPreview] = useState(null);
  const [utr, setUtr] = useState("");
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState(null);

  useEffect(() => {
    document.title = "Payment - C.O.G.N.I.T.";
  }, []);

  // Fetch UPI details when component mounts
  useEffect(() => {
    if (systemReady && participantId && !upiDetails && !submitSuccess) {
      fetchUpiDetails();
    }
  }, [systemReady, participantId]);

  const fetchUpiDetails = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(getApiUrl("/payment/upi-details"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participant_id: participantId })
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Failed to get payment details");
      }

      const data = await response.json();
      setUpiDetails(data);
    } catch (err) {
      setError(err.message || "Failed to load payment details");
    } finally {
      setLoading(false);
    }
  };

  const checkPaymentStatus = useCallback(async () => {
    if (!participantId) return;

    try {
      const response = await fetch(getApiUrl(`/payment/status/${participantId}`), {
        method: "GET",
        headers: { "Content-Type": "application/json" }
      });

      if (response.ok) {
        const data = await response.json();
        setPaymentStatus(data);

        // If payment is verified, complete the payment flow
        if (data.participant_status === 'paid' || data.status === 'verified') {
          onPaymentComplete();
        }
      }
    } catch (err) {
      console.error("Failed to check payment status:", err);
    }
  }, [participantId, onPaymentComplete]);

  // Poll for payment status after submission
  useEffect(() => {
    let interval;
    if (submitSuccess) {
      interval = setInterval(checkPaymentStatus, 5000); // Check every 5 seconds
    }
    return () => clearInterval(interval);
  }, [submitSuccess, checkPaymentStatus]);

  const handleScreenshotChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Validate file type
    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg'];
    if (!allowedTypes.includes(file.type)) {
      setError("Please upload a PNG or JPG image");
      return;
    }

    // Validate file size (5MB max)
    if (file.size > 5 * 1024 * 1024) {
      setError("Image too large. Maximum size is 5MB");
      return;
    }

    setScreenshot(file);
    setError(null);

    // Create preview
    const reader = new FileReader();
    reader.onload = (e) => setScreenshotPreview(e.target.result);
    reader.readAsDataURL(file);
  };

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

    if (!screenshot) {
      setError("Please upload a screenshot of your payment");
      return;
    }

    setError(null);
    setSubmitting(true);

    try {
      const formData = new FormData();
      formData.append("participant_id", participantId);
      formData.append("screenshot", screenshot);
      if (utr.trim()) {
        formData.append("utr", utr.trim());
      }

      const response = await fetch(getApiUrl("/payment/submit"), {
        method: "POST",
        body: formData
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Failed to submit payment proof");
      }

      const data = await response.json();
      setSubmitSuccess(true);
      setPaymentStatus({
        status: 'submitted',
        utr: data.utr,
        payment_reference: data.payment_reference,
        ocr_confidence: data.ocr_confidence
      });
    } catch (err) {
      setError(err.message || "Payment submission failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text).then(() => {
      // Could show a toast here
    });
  };

  // Render success state after submission
  if (submitSuccess) {
    return (
      <div className="panel payment-panel">
        <div className="payment-header">
          <div className="payment-header-emoji" aria-hidden="true">✅</div>
          <h2 className="payment-title">Payment Submitted!</h2>
          <p className="payment-subtitle">Your payment proof has been received</p>
        </div>

        <div className="payment-content">
          <section className="payment-card highlight">
            <h3>📋 Submission Details</h3>
            <div className="payment-detail-row">
              <span>Reference:</span>
              <strong>{paymentStatus?.payment_reference || upiDetails?.payment_reference}</strong>
            </div>
            {paymentStatus?.utr && (
              <div className="payment-detail-row">
                <span>UTR Number:</span>
                <strong>{paymentStatus.utr}</strong>
              </div>
            )}
            <div className="payment-status-badge pending">
              ⏳ Awaiting Verification
            </div>
          </section>

          <section className="payment-card">
            <h3>⏱️ What happens next?</h3>
            <ol className="payment-steps">
              <li>Our team will verify your payment within a few minutes</li>
              <li>You&apos;ll be automatically redirected to the survey once verified</li>
              <li>If there are any issues, we&apos;ll notify you</li>
            </ol>
          </section>

          <section className="payment-card">
            <h3>🔄 Checking status...</h3>
            <p>Please wait while we verify your payment. This page will update automatically.</p>
            <div className="spinner-container">
              <div className="spinner" />
            </div>
          </section>
        </div>

        <div className="page-actions payment-actions">
          <button
            className="secondary"
            onClick={checkPaymentStatus}
          >
            Check Status Now
          </button>
        </div>
      </div>
    );
  }

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
            <li>Secure UPI payment</li>
          </ul>
        </section>

        {/* UPI Payment Section */}
        <section className="payment-card highlight">
          <h3>
            <span className="payment-card-emoji" aria-hidden="true">📱</span>
            Pay via UPI
          </h3>

          {loading ? (
            <div className="loading-container">
              <div className="spinner" />
              <p>Loading payment details...</p>
            </div>
          ) : upiDetails ? (
            <div className="upi-payment-container">
              {/* UPI ID Display */}
              <div className="upi-id-section">
                <label>UPI ID:</label>
                <div className="upi-id-box">
                  <code>{upiDetails.upi_id}</code>
                  <button
                    className="copy-button"
                    onClick={() => copyToClipboard(upiDetails.upi_id)}
                    title="Copy UPI ID"
                  >
                    📋
                  </button>
                </div>
              </div>

              {/* Amount */}
              <div className="upi-amount-section">
                <label>Amount:</label>
                <div className="upi-amount">{upiDetails.amount_display}</div>
              </div>

              {/* Reference */}
              <div className="upi-reference-section">
                <label>Reference (Required):</label>
                <div className="upi-reference-box">
                  <code>{upiDetails.payment_reference}</code>
                  <button
                    className="copy-button"
                    onClick={() => copyToClipboard(upiDetails.payment_reference)}
                    title="Copy Reference"
                  >
                    📋
                  </button>
                </div>
                <small>Add this reference when making payment</small>
              </div>

              {/* QR Code URL */}
              <div className="upi-qr-section">
                <label>Or scan QR code:</label>
                <div className="qr-placeholder">
                  <a
                    href={upiDetails.qr_url}
                    className="upi-pay-button"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    📲 Open in UPI App
                  </a>
                </div>
              </div>

              {/* Instructions */}
              <div className="upi-instructions">
                <h4>How to pay:</h4>
                <ol>
                  {upiDetails.instructions.map((step, index) => (
                    <li key={index}>{step}</li>
                  ))}
                </ol>
              </div>
            </div>
          ) : (
            <div className="error-container">
              <p>Failed to load payment details</p>
              <button onClick={fetchUpiDetails} className="secondary">
                Retry
              </button>
            </div>
          )}
        </section>

        {/* Screenshot Upload */}
        {upiDetails && (
          <section className="payment-card">
            <h3>
              <span className="payment-card-emoji" aria-hidden="true">📸</span>
              Upload Payment Screenshot
            </h3>

            <div className="screenshot-upload-section">
              <div className="file-input-wrapper">
                <input
                  type="file"
                  id="screenshot"
                  accept="image/png,image/jpeg,image/jpg"
                  onChange={handleScreenshotChange}
                  disabled={submitting}
                />
                <label htmlFor="screenshot" className="file-input-label">
                  {screenshot ? "📷 Change Screenshot" : "📷 Select Screenshot"}
                </label>
              </div>

              {screenshotPreview && (
                <div className="screenshot-preview">
                  <img src={screenshotPreview} alt="Payment screenshot preview" />
                </div>
              )}

              <p className="file-help">
                Accepted formats: PNG, JPG (max 5MB)
              </p>
            </div>
          </section>
        )}

        {/* UTR Input (Optional) */}
        {upiDetails && (
          <section className="payment-card">
            <h3>
              <span className="payment-card-emoji" aria-hidden="true">#️⃣</span>
              UTR Number (Optional)
            </h3>
            <p className="utr-help">
              If you know your UTR/Transaction ID, enter it below.
              Otherwise, we&apos;ll try to extract it from your screenshot.
            </p>
            <input
              type="text"
              className="utr-input"
              placeholder="Enter UTR or Transaction ID"
              value={utr}
              onChange={(e) => setUtr(e.target.value)}
              disabled={submitting}
              maxLength={30}
            />
          </section>
        )}

        <section className="payment-card">
          <h3>
            <span className="payment-card-emoji" aria-hidden="true">⚡</span>
            How It Works
          </h3>
          <ol className="payment-steps">
            <li><span className="payment-step-emoji" aria-hidden="true">1️⃣</span> Pay ₹1 via UPI</li>
            <li><span className="payment-step-emoji" aria-hidden="true">2️⃣</span> Upload payment screenshot</li>
            <li><span className="payment-step-emoji" aria-hidden="true">3️⃣</span> We verify your payment</li>
            <li><span className="payment-step-emoji" aria-hidden="true">4️⃣</span> Winners get ₹10 via UPI (24–48 hours)</li>
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
          disabled={submitting}
        />
        <label htmlFor="payment-check" className="consent-text">
          I understand the ₹1 entry fee is non-refundable and gives me a chance to receive ₹10 via UPI.
        </label>
      </div>

      <div className="page-actions payment-actions">
        <button
          className="primary payment-cta"
          onClick={handleSubmit}
          disabled={!systemReady || submitting || !paymentChecked || !screenshot}
        >
          {submitting ? "Submitting..." : "✅ Submit Payment Proof"}
        </button>
      </div>
    </div>
  );
}
