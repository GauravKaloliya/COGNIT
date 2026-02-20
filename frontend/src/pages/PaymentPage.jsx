import React, { useState, useEffect, useRef } from "react";
import { getApiUrl } from "../utils/apiBase";

export default function PaymentPage({ 
  onPaymentComplete, 
  onBack,
  systemReady,
  publicId
}) {
  const [paymentData, setPaymentData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState("pending");
  const [uploadFile, setUploadFile] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

  useEffect(() => {
    document.title = "Payment - C.O.G.N.I.T.";
    createPayment();
  }, []);

  const createPayment = async () => {
    if (!publicId) {
      setError("Participant details are missing. Please restart the study.");
      return;
    }

    const existingPaymentId = sessionStorage.getItem("payment_id");
    if (existingPaymentId) {
      setError("Payment already in progress. Please complete or refresh.");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(getApiUrl('/payments/create'), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          public_id: publicId,
          amount: 1
        })
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to create payment");
      }

      const data = await response.json();
      setPaymentData(data);
      sessionStorage.setItem("payment_id", data.payment_id);
      
      const expiresAt = new Date(data.expires_at);
      const now = new Date();
      if (expiresAt <= now) {
        throw new Error("Payment session has expired. Please refresh and try again.");
      }
    } catch (err) {
      setError(err.message || "Failed to create payment. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (!file.type.startsWith('image/')) {
        setError("Please select an image file");
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        setError("File size must be less than 5MB");
        return;
      }
      setUploadFile(file);
      setError(null);
    }
  };

  const calculateSha256 = async (file) => {
    const arrayBuffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  };

  const handleUploadAndFinalize = async () => {
    if (!uploadFile) {
      setError("Please upload a payment screenshot");
      return;
    }

    if (!paymentData?.payment_id) {
      setError("Payment data not found. Please refresh.");
      return;
    }

    setVerifying(true);
    setError(null);

    try {
      const uploadUrlResponse = await fetch(
        getApiUrl(`/payments/${paymentData.payment_id}/upload-url`),
        { method: "POST" }
      );

      if (!uploadUrlResponse.ok) {
        const data = await uploadUrlResponse.json();
        throw new Error(data.error || "Failed to get upload URL");
      }

      const { upload_url, object_key } = await uploadUrlResponse.json();

      const uploadResponse = await fetch(upload_url, {
        method: "PUT",
        headers: { "Content-Type": uploadFile.type },
        body: uploadFile
      });

      if (!uploadResponse.ok) {
        throw new Error("Failed to upload image");
      }

      const sha256 = await calculateSha256(uploadFile);

      const finalizeResponse = await fetch(
        getApiUrl(`/payments/${paymentData.payment_id}/finalize`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ object_key, sha256 })
        }
      );

      if (!finalizeResponse.ok) {
        const data = await finalizeResponse.json();
        throw new Error(data.error || "Failed to finalize payment");
      }

      setPaymentStatus("success");
      sessionStorage.removeItem("payment_id");
      await onPaymentComplete();
    } catch (err) {
      setError(err.message || "Payment verification failed. Please try again.");
    } finally {
      setVerifying(false);
    }
  };

  const handleRetry = () => {
    sessionStorage.removeItem("payment_id");
    setPaymentData(null);
    setUploadFile(null);
    setPaymentStatus("pending");
    setError(null);
    createPayment();
  };

  if (isLoading) {
    return (
      <div className="panel payment-panel">
        <div className="page-top-actions">
          {onBack && (
            <button className="ghost back-button" onClick={onBack}>
              ← Back
            </button>
          )}
        </div>
        <div className="status-panel">
          <h2>Creating Payment</h2>
          <p className="status-message">Please wait...</p>
          <div className="spinner" />
        </div>
      </div>
    );
  }

  if (error && !paymentData) {
    return (
      <div className="panel payment-panel">
        <div className="page-top-actions">
          {onBack && (
            <button className="ghost back-button" onClick={onBack}>
              ← Back
            </button>
          )}
        </div>
        <div className="banner warning spaced">{error}</div>
        <div className="page-actions">
          <button className="primary" onClick={handleRetry}>
            Try Again
          </button>
        </div>
      </div>
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

      <div className="payment-header">
        <div className="payment-header-emoji" aria-hidden="true">🎁</div>
        <h2 className="payment-title">Win ₹10</h2>
        <p className="payment-subtitle">Participate → Get a chance to receive ₹10</p>
        <p className="payment-tagline">₹1 entry. Real reward.</p>
      </div>

      {error && (
        <div className="banner warning spaced">
          {error}
        </div>
      )}

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

        {paymentData && paymentStatus === "pending" && (
          <section className="payment-card">
            <h3>
              <span className="payment-card-emoji" aria-hidden="true">📱</span>
              {isMobile ? "Pay with UPI" : "Scan QR Code"}
            </h3>
            
            <div className="payment-qr-container">
              {isMobile ? (
                <a
                  href={paymentData.upi_link}
                  className="payment-upi-button"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span>💳</span>
                  Pay ₹1 with UPI
                </a>
              ) : (
                <>
                  <img
                    src={`data:image/png;base64,${paymentData.qr_base64}`}
                    alt="Payment QR Code"
                    className="payment-qr-code"
                  />
                  <p className="payment-note">Scan with any UPI app to pay ₹1</p>
                </>
              )}
            </div>

            <div className="payment-status-badge pending">
              <span>⏱️</span>
              Payment pending - upload screenshot after payment
            </div>
          </section>
        )}

        {paymentStatus === "pending" && (
          <section className="payment-card">
            <h3>
              <span className="payment-card-emoji" aria-hidden="true">📤</span>
              Upload Payment Screenshot
            </h3>
            <p>After completing the payment, please upload a screenshot of the transaction.</p>
            
            <div 
              className="payment-upload-area"
              onClick={() => fileInputRef.current?.click()}
            >
              {uploadFile ? (
                <div>
                  <p>✅ {uploadFile.name}</p>
                  <p className="payment-note">Click to change</p>
                </div>
              ) : (
                <div>
                  <p>📷</p>
                  <p>Click to upload payment screenshot</p>
                </div>
              )}
              <input
                type="file"
                ref={fileInputRef}
                accept="image/*"
                onChange={handleFileChange}
                style={{ display: 'none' }}
              />
            </div>

            <button
              className="primary"
              onClick={handleUploadAndFinalize}
              disabled={!uploadFile || verifying}
            >
              {verifying ? "Verifying..." : "Confirm Payment"}
            </button>
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
    </div>
  );
}
