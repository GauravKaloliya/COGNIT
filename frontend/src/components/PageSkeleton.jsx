import React from "react";
import { uiText } from "../utils/uiText.js";

export default function PageSkeleton({
  title = uiText("skeleton.defaultTitle"),
  subtitle = uiText("skeleton.defaultSubtitle"),
  variant = "generic",
  compact = false,
}) {
  return (
    <div className="skeleton-page-frame" role="status" aria-live="polite">
      <div className={`skeleton-page skeleton-variant-${variant} ${compact ? "compact" : ""}`}>
        <div className="skeleton-orb orb-a" />
        <div className="skeleton-orb orb-b" />
        <div className="skeleton-orb orb-c" />

        <div className="skeleton-shell">
          <div className="skeleton-hero">
            <div className="skeleton-kicker shimmer" />
            <div className="skeleton-title shimmer" />
            <div className="skeleton-subtitle shimmer" />
          </div>

          {!compact && (
            <div className="skeleton-grid">
              <div className="skeleton-block shimmer" />
              <div className="skeleton-block shimmer" />
              <div className="skeleton-block shimmer" />
            </div>
          )}

          <div className="skeleton-footer">
            <div className="skeleton-button shimmer" />
            <div className="skeleton-button ghost shimmer" />
          </div>

          <p className="skeleton-caption">{title}</p>
          <p className="skeleton-caption muted">{subtitle}</p>
        </div>
      </div>
    </div>
  );
}
