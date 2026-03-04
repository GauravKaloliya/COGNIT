import React from 'react';
import { getErrorMessage } from '../utils/errorRegistry.js';
import PageSkeleton from './PageSkeleton.jsx';
import PanelState from './PanelState.jsx';

export default function ErrorPage({ error, resetError, darkMode = false, onToggleDarkMode }) {
  const [reloading, setReloading] = React.useState(false);

  const redirectToConsent = () => {
    sessionStorage.setItem("stage", JSON.stringify("consent"));
    sessionStorage.setItem("paymentSubStage", JSON.stringify("content"));
    sessionStorage.setItem("consentGiven", JSON.stringify(false));
    sessionStorage.setItem("paymentVerified", JSON.stringify(false));
    window.location.assign("/");
  };

  const handleReset = () => {
    setReloading(true);
    if (resetError) {
      resetError();
    }
    redirectToConsent();
  };

  if (reloading) {
    return (
      <div className="app error-page-centered">
        <div className="panel">
          <PageSkeleton
            title="Recovering application state"
            subtitle="Resetting to consent step"
            variant="error"
            compact
          />
        </div>
      </div>
    );
  }

  return (
    <div className="app error-page-centered">
      <header className="header">
        <div className="brand">
          <h1>C.O.G.N.I.T.</h1>
          <p className="subtitle">Describe each image with as much detail as possible</p>
        </div>
        <div className="header-actions">
          <button
            className="ghost dark-mode-toggle"
            onClick={onToggleDarkMode}
            title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
          >
            {darkMode ? "☀️" : "🌙"}
          </button>
        </div>
      </header>
      <div className="panel">
        <div className="page-hero">
          <PanelState
            variant="error"
            icon="!"
            title="Something went wrong"
            message={error?.message || getErrorMessage('SYS_002_0017')}
            actionLabel="Reload"
            onAction={handleReset}
          />
          {error?.stack && import.meta.env.DEV && (
            <details className="error-details">
              <summary className="error-details-summary">Error Details</summary>
              <pre className="error-details-pre">
                {error.stack}
              </pre>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
