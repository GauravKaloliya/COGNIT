import React from 'react';
import { getErrorMessage } from '../utils/errorRegistry.js';
import { runtimeConfig } from "../config/runtime";
import PageSkeleton from './PageSkeleton.jsx';
import PanelState from './PanelState.jsx';
import ThemeToggleIcon from './ThemeToggleIcon.jsx';
import { writeExpiringValue } from "../utils/storage";
import { APP_FLOW } from "../config/appFlow";
import { APP_ROUTES } from "../constants/routes";
import { uiText } from "../utils/uiText";

export default function ErrorPage({ error, resetError, darkMode = false, onToggleDarkMode }) {
  const [reloading, setReloading] = React.useState(false);

  const redirectToConsent = () => {
    const write = (key, value) => writeExpiringValue(key, value, {
      schemaVersion: runtimeConfig.uiStateSchemaVersion,
      ttlMs: runtimeConfig.uiStateTtlMs,
    });
    write(runtimeConfig.storageKeys.stage, APP_FLOW.stages.consent);
    write(runtimeConfig.storageKeys.paymentSubStage, APP_FLOW.paymentSubStages.content);
    write(runtimeConfig.storageKeys.consentGiven, false);
    write(runtimeConfig.storageKeys.userDetailsSubmitted, false);
    write(runtimeConfig.storageKeys.paymentVerified, false);
    window.location.assign(APP_ROUTES.home);
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
            title={uiText("error.recoveringTitle")}
            subtitle={uiText("error.recoveringSubtitle")}
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
            variant="error"
            icon="!"
            title={uiText("error.title")}
            message={error?.message || getErrorMessage('SYS_002_0017')}
            actionLabel={uiText("common.reload")}
            onAction={handleReset}
          />
          {error?.stack && import.meta.env.DEV && (
            <details className="error-details">
              <summary className="error-details-summary">{uiText("error.details")}</summary>
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
