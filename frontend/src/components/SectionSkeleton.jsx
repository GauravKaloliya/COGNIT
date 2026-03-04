import React from "react";

export default function SectionSkeleton({
  title = "Loading section",
  rows = 3,
  dense = false,
}) {
  return (
    <div className={`section-skeleton ${dense ? "dense" : ""}`} role="status" aria-live="polite">
      <div className="section-skeleton-head shimmer" />
      <div className="section-skeleton-sub shimmer" />
      <div className="section-skeleton-grid">
        {Array.from({ length: Math.max(1, rows) }).map((_, idx) => (
          <div key={idx} className="section-skeleton-line shimmer" />
        ))}
      </div>
      <p className="section-skeleton-caption">{title}</p>
    </div>
  );
}

