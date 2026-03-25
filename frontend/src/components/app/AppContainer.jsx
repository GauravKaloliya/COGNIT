import React from "react";
import ThemeToggleIcon from "../ThemeToggleIcon.jsx";
import FlowStepper from "../FlowStepper.jsx";
import DSButton from "../design/DSButton.jsx";
import { uiText } from "../../utils/uiText.js";

export default function AppContainer({
  darkMode,
  toggleDarkMode,
  isMobile,
  online,
  lastSyncAt,
  storageOk,
  stage,
  children,
}) {
  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <h1>{uiText("app.brand")}</h1>
          {!isMobile && <p className="subtitle">{uiText("app.subtitle")}</p>}
        </div>
        <div className="header-actions">
          <DSButton
            variant="ghost"
            className="dark-mode-toggle"
            onClick={toggleDarkMode}
            title={darkMode ? uiText("app.darkModeLight") : uiText("app.darkModeDark")}
          >
            <ThemeToggleIcon darkMode={darkMode} />
          </DSButton>
          <div className="header-status">
            <div className={`status-dot ${online ? "online" : "offline"}`}>
              {online ? uiText("status.online") : uiText("status.offline")}
            </div>
            <div className="header-status-text">
              <span className="header-status-line">
                {online ? uiText("status.onlineReady") : uiText("status.offlineSubmissions")}
              </span>
              <span className="header-status-line">
                {lastSyncAt
                  ? uiText("status.lastSync", { time: new Date(lastSyncAt).toLocaleTimeString() })
                  : uiText("status.neverSynced")}
              </span>
            </div>
          </div>
        </div>
      </header>

      {!storageOk && (
        <div className="banner warning">
          <span>{uiText("app.storageUnavailable")}</span>
        </div>
      )}

      <FlowStepper stage={stage} />

      <div className="route-transition">{children}</div>

      <div className="branding-footer">{uiText("app.footerCredit")}</div>
    </div>
  );
}
