import React from 'react';
import { useNavigate } from 'react-router-dom';
import PanelState from './PanelState.jsx';
import ThemeToggleIcon from './ThemeToggleIcon.jsx';
import DSButton from './design/DSButton.jsx';
import { uiText } from '../utils/uiText.js';
import { NOT_FOUND_ILLUSTRATION } from '../content/notFoundIllustration.js';
import { APP_ROUTES } from '../constants/routes.js';
import { BUTTON_VARIANTS, PANEL_STATE_ICONS, PANEL_STATE_VARIANTS } from '../constants/componentUi.js';
import { DOM_ROLES } from '../constants/dom.js';

export default function NotFound({ darkMode = false, onToggleDarkMode }) {
  const navigate = useNavigate();

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <h1>{uiText("app.brand")}</h1>
          <p className="subtitle">{uiText("app.subtitle")}</p>
        </div>
        <div className="header-actions">
          <DSButton
            variant={BUTTON_VARIANTS.ghost}
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
            <svg viewBox={NOT_FOUND_ILLUSTRATION.viewBox} role={DOM_ROLES.image} aria-label={NOT_FOUND_ILLUSTRATION.ariaLabel}>
              <defs>
                {NOT_FOUND_ILLUSTRATION.gradients.map((gradient) => (
                  <linearGradient key={gradient.id} id={gradient.id} x1={gradient.x1} y1={gradient.y1} x2={gradient.x2} y2={gradient.y2}>
                    {gradient.stops.map((stop, index) => (
                      <stop key={`${gradient.id}-${index}`} offset={stop.offset} stopColor={stop.stopColor} />
                    ))}
                  </linearGradient>
                ))}
              </defs>
              {NOT_FOUND_ILLUSTRATION.shapes.map((shape, index) => React.createElement(shape.type, {
                key: `${shape.type}-${index}`,
                ...shape.props,
              }))}
            </svg>
          </div>
          <PanelState
            variant={PANEL_STATE_VARIANTS.warning}
            icon={PANEL_STATE_ICONS.notFound}
            title={uiText("notFound.title")}
            message={uiText("notFound.message")}
            actionLabel={uiText("notFound.action")}
            onAction={() => navigate(APP_ROUTES.home)}
          />
        </div>
      </div>
      <div className="branding-footer">
        {uiText("app.footerCredit")}
      </div>
    </div>
  );
}
