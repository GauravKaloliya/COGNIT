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
            <p className="subtitle">{uiText("app.subtitle")}</p>
          </div>
          <div className="header-actions">
            <button
              className="ghost dark-mode-toggle"
              onClick={onToggleDarkMode}
              title={darkMode ? uiText("app.darkModeLight") : uiText("app.darkModeDark")}
            >
              <ThemeToggleIcon darkMode={darkMode} />
            </button>
          </div>
        </header>
        <div className="panel">
          <PageSkeleton
            title={uiText("service.retryingTitle")}
            subtitle={uiText("service.retryingSubtitle")}
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
          <p className="subtitle">{uiText("app.subtitle")}</p>
        </div>
        <div className="header-actions">
          <button
            className="ghost dark-mode-toggle"
            onClick={onToggleDarkMode}
            title={darkMode ? uiText("app.darkModeLight") : uiText("app.darkModeDark")}
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
            title={uiText("service.title")}
            message={error || getErrorMessage('SYS_001_0004')}
            actionLabel={
              isRetrying
                ? uiText("survey.retryingShort")
                : (retryInSeconds > 0 ? uiText("common.tryAgainIn", { seconds: retryInSeconds }) : uiText("common.reload"))
            }
            onAction={handleRetry}
            disabled={isRetrying || retryInSeconds > 0}
          />

          <div className="service-unavailable-card">
            <p className="service-unavailable-card-title">
              What you can try:
            </p>
            <ul className="service-unavailable-list">
              <li>{uiText("service.tipCheckConnection")}</li>
              <li>{uiText("service.tipRefresh")}</li>
              <li>{uiText("service.tipWait")}</li>
              <li>{uiText("service.tipContact")}</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="branding-footer">{uiText("app.footerCredit")}</div>
    </div>
  );
}
