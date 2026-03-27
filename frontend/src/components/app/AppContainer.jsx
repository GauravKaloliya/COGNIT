import React from "react";
import ThemeToggleIcon from "../ThemeToggleIcon.jsx";
import FlowStepper from "../FlowStepper.jsx";
import DSButton from "../design/DSButton.jsx";
import TypewriterSubtitle from "../TypewriterSubtitle.jsx";
import { getApiOriginUrl } from "../../utils/apiBase.js";
import { uiText } from "../../utils/uiText.js";

export default function AppContainer({
  darkMode,
  toggleDarkMode,
  isMobile,
  storageOk,
  stage,
  children,
}) {
  const openApiDocs = React.useCallback(() => {
    window.open(getApiOriginUrl(), "_blank", "noopener,noreferrer");
  }, []);

  return (
    <div className={`app app-stage-${stage || "consent"}`}>
      <header className="header">
        <div className="brand">
          <h1>{uiText("app.brand")}</h1>
          {!isMobile && <TypewriterSubtitle text={uiText("app.subtitle")} />}
        </div>
        <div className="header-actions">
          <DSButton
            variant="ghost"
            className="api-docs-button"
            onClick={openApiDocs}
            title={uiText("app.apiDocs")}
            aria-label={uiText("app.apiDocs")}
          >
            {uiText("app.apiDocs")}
          </DSButton>
          <DSButton
            variant="ghost"
            className="dark-mode-toggle"
            onClick={toggleDarkMode}
            title={darkMode ? uiText("app.darkModeLight") : uiText("app.darkModeDark")}
          >
            <ThemeToggleIcon darkMode={darkMode} />
          </DSButton>
        </div>
      </header>

      {!storageOk && (
        <div className="banner warning">
          <span>{uiText("app.storageUnavailable")}</span>
        </div>
      )}

      <FlowStepper stage={stage} />

      <div className={`route-transition stage-${stage || "consent"}`}>{children}</div>

      <div className="branding-footer">{uiText("app.footerCredit")}</div>
    </div>
  );
}
