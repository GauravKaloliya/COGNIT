import React from "react";
import { getErrorMessage } from "../utils/errorRegistry.js";
import { getDisplayErrorMessage } from "../utils/appError.js";
import PageSkeleton from "./PageSkeleton.jsx";
import PanelState from "./PanelState.jsx";
import ThemeToggleIcon from "./ThemeToggleIcon.jsx";
import DSButton from "./design/DSButton.jsx";
import TypewriterSubtitle from "./TypewriterSubtitle.jsx";
import { useIsMobile } from "../hooks/useIsMobile.js";
import { uiText } from "../utils/uiText";
import { DOG_ILLUSTRATION } from "../content/notFoundIllustration.js";
import { DOM_ROLES } from "../constants/dom.js";
import { runtimeConfig } from "../config/runtime";

export default function MaintenancePage({
  error,
  onRetry,
  darkMode = false,
  onToggleDarkMode,
  autoRetrySeconds = runtimeConfig.serviceRetrySeconds,
}) {
  const isMobile = useIsMobile();
  const [reloading, setReloading] = React.useState(false);
  const [retryIn, setRetryIn] = React.useState(Math.max(0, Number(autoRetrySeconds) || 0));

  React.useEffect(() => {
    const initial = Math.max(0, Number(autoRetrySeconds) || 0);
    setRetryIn(initial);
  }, [autoRetrySeconds]);

  React.useEffect(() => {
    if (reloading || retryIn <= 0) return;
    const timer = setInterval(() => {
      setRetryIn((prev) => Math.max(0, prev - 1));
    }, runtimeConfig.countdownTickMs);
    return () => clearInterval(timer);
  }, [reloading, retryIn]);

  const handleRetry = () => {
    setReloading(true);
    if (onRetry) onRetry();
  };

  if (reloading) {
    return (
      <div className="app error-page-centered">
        <div className="panel">
          <PageSkeleton
            title={uiText("maintenance.recoveringTitle")}
            subtitle={uiText("maintenance.recoveringSubtitle")}
            variant="warning"
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
          {!isMobile && <TypewriterSubtitle text={uiText("app.subtitle")} />}
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
          <div className="not-found-dog">
            <svg viewBox={DOG_ILLUSTRATION.viewBox} role={DOM_ROLES.image} aria-label={DOG_ILLUSTRATION.ariaLabel}>
              <defs>
                {DOG_ILLUSTRATION.gradients.map((gradient) => (
                  <linearGradient key={gradient.id} id={gradient.id} x1={gradient.x1} y1={gradient.y1} x2={gradient.x2} y2={gradient.y2}>
                    {gradient.stops.map((stop, index) => (
                      <stop key={`${gradient.id}-${index}`} offset={stop.offset} stopColor={stop.stopColor} />
                    ))}
                  </linearGradient>
                ))}
              </defs>
              {DOG_ILLUSTRATION.shapes.map((shape, index) => React.createElement(shape.type, {
                key: `${shape.type}-${index}`,
                ...shape.props,
              }))}
            </svg>
          </div>
          <PanelState
            variant="warning"
            icon="!"
            title={uiText("maintenance.title")}
            message={getDisplayErrorMessage(error, "SYS_002_0021") || getErrorMessage("SYS_002_0021")}
            actionLabel={retryIn > 0 ? uiText("common.tryAgainIn", { seconds: retryIn }) : uiText("common.reload")}
            onAction={handleRetry}
            disabled={retryIn > 0}
          />
        </div>
      </div>
    </div>
  );
}
