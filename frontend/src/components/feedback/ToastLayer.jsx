import React from "react";
import DSButton from "../design/DSButton.jsx";
import { uiText } from "../../utils/uiText.js";

export default function ToastLayer({ toasts, onDismiss }) {
  if (!Array.isArray(toasts) || toasts.length === 0) return null;
  return (
    <div className="toast-container">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast ${toast.type}`}>
          <span>{toast.message}</span>
          <div className="toast-actions">
            {toast.action && (
              <DSButton
                variant="ghost"
                className="toast-action"
                onClick={() => {
                  toast.action.onClick();
                  onDismiss(toast.id);
                }}
              >
                {toast.action.label}
              </DSButton>
            )}
            <DSButton variant="ghost" onClick={() => onDismiss(toast.id)} aria-label={uiText("toast.dismiss")}>
              ×
            </DSButton>
          </div>
        </div>
      ))}
    </div>
  );
}
