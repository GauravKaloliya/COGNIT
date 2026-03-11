import React from 'react';
import { getErrorMessage } from '../utils/errorRegistry.js';
import { uiText } from '../utils/uiText.js';
import { runtimeConfig } from '../config/runtime';
import PageSkeleton from './PageSkeleton.jsx';
import PanelState from './PanelState.jsx';
import ThemeToggleIcon from './ThemeToggleIcon.jsx';

export default function ServiceUnavailablePage({ error, darkMode = false, onToggleDarkMode, onRetry, isRetrying = false }) {
  const [retryInSeconds, setRetryInSeconds] = React.useState(runtimeConfig.serviceRetrySeconds);

  React.useEffect(() => {
    if (retryInSeconds <= 0 || isRetrying) return;
    const t = setTimeout(
      () => setRetryInSeconds((prev) => Math.max(0, prev - 1)),
      runtimeConfig.countdownTickMs
    );
    return () => clearTimeout(t);
  }, [retryInSeconds, isRetrying]);

  if (isRetrying) {
    return (
      <div className="app">
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
              <ThemeToggleIcon darkMode={darkMode} />
            </button>
          </div>
        </header>
        <div className="panel">
          <PageSkeleton
            title="Retrying service health check"
            subtitle="Reconnecting to backend services"
            variant="service"
            compact
          />
        </div>
      </div>
    );
  }

  const handleRetry = () => {
    setRetryInSeconds(runtimeConfig.serviceRetrySeconds);
    if (onRetry) {
      onRetry();
      return;
    }
    window.location.reload();
  };

  return (
    <div className="app">
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
            <ThemeToggleIcon darkMode={darkMode} />
          </button>
        </div>
      </header>

      <div className="panel">
        <div className="page-hero">
          <PanelState
            variant="warning"
            icon="!"
            title="Service Unavailable"
            message={error || getErrorMessage('SYS_001_0004')}
            actionLabel={
              isRetrying
                ? "Retrying..."
                : (retryInSeconds > 0 ? uiText("common.tryAgainIn", { seconds: retryInSeconds }) : "Reload")
            }
            onAction={handleRetry}
            disabled={isRetrying || retryInSeconds > 0}
          />

          <div className="service-unavailable-card">
            <p className="service-unavailable-card-title">
              What you can try:
            </p>
            <ul className="service-unavailable-list">
              <li>Check your internet connection</li>
              <li>Refresh the page and try again</li>
              <li>Wait a few minutes and retry if the issue persists</li>
              <li>Contact support if the problem continues</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="branding-footer">Created by Gaurav Kaloliya</div>
    </div>
  );
}
