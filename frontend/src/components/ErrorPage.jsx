import React from 'react';
import { getErrorMessage } from '../utils/errorRegistry.js';
import { runtimeConfig } from "../config/runtime";
import PageSkeleton from './PageSkeleton.jsx';
import PanelState from './PanelState.jsx';
import ThemeToggleIcon from './ThemeToggleIcon.jsx';
import DSButton from './design/DSButton.jsx';
import { useIsMobile } from "../hooks/useIsMobile.js";
import { forEachStorageArea, makeScopedKey, readExpiringValue, removeStoredKey, writeExpiringValue } from "../utils/storage";
import { APP_FLOW } from "../config/appFlow";
import { APP_ROUTES } from "../constants/routes";
import { uiText } from "../utils/uiText";

export default function ErrorPage({ error, resetError, darkMode = false, onToggleDarkMode }) {
  const isMobile = useIsMobile();
  const [reloading, setReloading] = React.useState(false);

  const redirectToConsent = () => {
    const schemaVersion = runtimeConfig.uiStateSchemaVersion;
    const ttlMs = runtimeConfig.uiStateTtlMs;

    // Preserve dark mode preference across resets.
    const storedDarkMode = readExpiringValue(runtimeConfig.storageKeys.darkMode, null, { area: "local", schemaVersion, ttlMs });

    const existingPublicId =
      readExpiringValue(runtimeConfig.storageKeys.publicId, "", { area: "local", schemaVersion, ttlMs }) || "";
    const scopes = existingPublicId ? [existingPublicId] : [];

    const keysToClear = [
      runtimeConfig.storageKeys.publicId,
      runtimeConfig.storageKeys.stage,
      runtimeConfig.storageKeys.consentGiven,
      runtimeConfig.storageKeys.userDetailsSubmitted,
      runtimeConfig.storageKeys.emailVerified,
      runtimeConfig.storageKeys.demographics,
      runtimeConfig.storageKeys.survey,
      runtimeConfig.storageKeys.surveyCompleted,
      runtimeConfig.storageKeys.surveyFeedbackReady,
      runtimeConfig.storageKeys.lastSubmissionSucceeded,
      runtimeConfig.storageKeys.shownImages,
      runtimeConfig.storageKeys.sessionId,
      runtimeConfig.storageKeys.emailOtpState,
      runtimeConfig.storageKeys.consentDraft,
      runtimeConfig.storageKeys.consentPending,
      runtimeConfig.storageKeys.userDetailsPending,
      runtimeConfig.storageKeys.surveyPendingSubmit,
      runtimeConfig.storageKeys.surveyFeedPendingContinue,
      runtimeConfig.storageKeys.surveyFeedPendingFinish,
      runtimeConfig.storageKeys.participantOptions,
      runtimeConfig.storageKeys.autoLocationPrompt,
      runtimeConfig.storageKeys.autoLocationSuccess,
      runtimeConfig.storageKeys.desktopLocationSession,
      runtimeConfig.storageKeys.reverseGeocodeState,
      runtimeConfig.storageKeys.telemetry,
      runtimeConfig.storageKeys.clientErrorQueue,
      runtimeConfig.storageKeys.telemetryBlocked,
      runtimeConfig.storageKeys.sessionAlive,
    ];

    keysToClear.forEach((key) => {
      forEachStorageArea((area) => {
        removeStoredKey(key, area);
        scopes.forEach((scope) => removeStoredKey(makeScopedKey(key, scope), area));
      });
    });

    // Ensure the app boots into Consent deterministically for an existing scoped participant.
    if (existingPublicId) {
      writeExpiringValue(makeScopedKey(runtimeConfig.storageKeys.stage, existingPublicId), APP_FLOW.stages.consent, { area: "local", schemaVersion, ttlMs });
      writeExpiringValue(makeScopedKey(runtimeConfig.storageKeys.consentGiven, existingPublicId), false, { area: "local", schemaVersion, ttlMs });
    }

    if (typeof storedDarkMode === "boolean") {
      writeExpiringValue(runtimeConfig.storageKeys.darkMode, storedDarkMode, { area: "local", schemaVersion, ttlMs });
    }

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
          <h1>{uiText("app.brand")}</h1>
          {!isMobile && <p className="subtitle">{uiText("app.subtitle")}</p>}
        </div>
        <div className="header-actions">
          <DSButton
            variant="ghost"
            className="dark-mode-toggle"
            onClick={onToggleDarkMode}
            title={darkMode ? uiText("app.darkModeLight") : uiText("app.darkModeDark")}
          >
            <ThemeToggleIcon darkMode={darkMode} />
          </DSButton>
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
