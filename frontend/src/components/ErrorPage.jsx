import React from 'react';
import { getErrorMessage } from '../utils/errorRegistry.js';

export default function ErrorPage({ error, resetError }) {
  const redirectToConsent = () => {
    sessionStorage.setItem("stage", JSON.stringify("consent"));
    sessionStorage.setItem("paymentSubStage", JSON.stringify("content"));
    sessionStorage.setItem("consentGiven", JSON.stringify(false));
    sessionStorage.setItem("paymentVerified", JSON.stringify(false));
    window.location.assign("/");
  };

  const handleReset = () => {
    if (resetError) {
      resetError();
    }
    redirectToConsent();
  };

  return (
    <div className="app error-page-centered">
      <div className="panel">
        <div className="page-hero">
          <h1 className="hero-title warning">Oops!</h1>
          <h2 className="hero-subtitle">Something went wrong</h2>
          <p className="hero-message">
            {error?.message || getErrorMessage('SYS_002_0017')}
          </p>

          {error?.stack && import.meta.env.DEV && (
            <details className="error-details">
              <summary className="error-details-summary">Error Details</summary>
              <pre className="error-details-pre">
                {error.stack}
              </pre>
            </details>
          )}

          <div className="page-actions">
            <button className="primary" onClick={handleReset}>
              Reload
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
