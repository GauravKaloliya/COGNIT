import React from "react";

export default function ZoomIcon({ zoomed = false, className = "" }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4 4" />
      <path d="M11 8.5v5" />
      {!zoomed ? <path d="M8.5 11h5" /> : null}
    </svg>
  );
}
