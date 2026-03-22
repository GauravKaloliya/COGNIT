import React from "react";

function ButtonRetryBadge({ seconds }) {
  if (!seconds || seconds <= 0) return null;
  return (
    <span className="button-badge">
      <span className="button-spinner small" />
      {seconds}s
    </span>
  );
}

export default React.memo(ButtonRetryBadge);
