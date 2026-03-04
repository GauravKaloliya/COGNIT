import React from "react";

export default function PanelState({
  variant = "info",
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
    (variant === "success"
      ? "✓"
      : variant === "warning"
        ? "!"
        : variant === "error"
          ? "×"
          : "i");

  return (
    <div className={`panel-state panel-state-${variant}`}>
      <div
        className={`panel-state-icon ${String(defaultIcon).length > 2 ? "wide" : ""}`}
        aria-hidden="true"
      >
        {defaultIcon}
      </div>
      {title ? <h3>{title}</h3> : null}
      {message ? <p>{message}</p> : null}
      {children}
      {(actionLabel && onAction) || (secondaryActionLabel && onSecondaryAction) ? (
        <div className="panel-state-actions">
          {actionLabel && onAction ? (
            <button className="primary" onClick={onAction} disabled={disabled}>
              {actionLabel}
            </button>
          ) : null}
          {secondaryActionLabel && onSecondaryAction ? (
            <button className="ghost" onClick={onSecondaryAction} disabled={disabled}>
              {secondaryActionLabel}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
