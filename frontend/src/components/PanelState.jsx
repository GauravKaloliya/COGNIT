import React from "react";
import DSButton from "./design/DSButton.jsx";
import { BUTTON_VARIANTS, CLASS_NAMES, PANEL_STATE_ICONS, PANEL_STATE_VARIANTS } from "../constants/componentUi";

export default function PanelState({
  variant = PANEL_STATE_VARIANTS.info,
  icon = null,
  title = "",
  message = "",
  actionLabel = "",
  onAction = null,
  secondaryActionLabel = "",
  onSecondaryAction = null,
  disabled = false,
  children = null,
}) {
  const defaultIcon =
    icon ??
    PANEL_STATE_ICONS[variant] ??
    PANEL_STATE_ICONS[PANEL_STATE_VARIANTS.info];

  return (
    <div className={`${CLASS_NAMES.panelState} ${CLASS_NAMES.panelState}-${variant}`}>
      <div
        className={`${CLASS_NAMES.panelStateIcon} ${String(defaultIcon).length > 2 ? CLASS_NAMES.wide : ""}`.trim()}
        aria-hidden="true"
      >
        {defaultIcon}
      </div>
      {title ? <h3>{title}</h3> : null}
      {message ? <p>{message}</p> : null}
      {children}
      {(actionLabel && onAction) || (secondaryActionLabel && onSecondaryAction) ? (
        <div className={CLASS_NAMES.panelStateActions}>
          {actionLabel && onAction ? (
            <DSButton variant={BUTTON_VARIANTS.primary} onClick={onAction} disabled={disabled}>
              {actionLabel}
            </DSButton>
          ) : null}
          {secondaryActionLabel && onSecondaryAction ? (
            <DSButton variant={BUTTON_VARIANTS.ghost} onClick={onSecondaryAction} disabled={disabled}>
              {secondaryActionLabel}
            </DSButton>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
