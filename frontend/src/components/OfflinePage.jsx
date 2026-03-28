import React from "react";
import DSButton from "./design/DSButton.jsx";
import { DOG_ILLUSTRATION } from "../content/notFoundIllustration.js";
import { uiText } from "../utils/uiText.js";

export default function OfflinePage({ onRetry, darkMode, onToggleDarkMode }) {
  return (
    <div className={`offline-page ${darkMode ? "dark" : ""}`}>
      <div className="offline-card">
        <div className="offline-illustration" aria-hidden="true">
          <svg viewBox={DOG_ILLUSTRATION.viewBox} role="img" aria-label={DOG_ILLUSTRATION.ariaLabel}>
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
        <h1>{uiText("offline.title")}</h1>
        <p>{uiText("offline.message")}</p>
        <div className="offline-actions">
          <DSButton className="primary" onClick={onRetry}>
            {uiText("common.retry")}
          </DSButton>
          <DSButton variant="ghost" onClick={onToggleDarkMode}>
            {darkMode ? uiText("offline.lightMode") : uiText("offline.darkMode")}
          </DSButton>
        </div>
      </div>
    </div>
  );
}
