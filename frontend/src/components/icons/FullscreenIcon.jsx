import React from "react";

export default function FullscreenIcon({ className = "" }) {
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
      <path d="M8 4H4v4" />
      <path d="M16 4h4v4" />
      <path d="M20 16v4h-4" />
      <path d="M8 20H4v-4" />
      <path d="M9 5L4 10" />
      <path d="M15 5l5 5" />
      <path d="M20 14l-5 5" />
      <path d="M9 19l-5-5" />
    </svg>
  );
}
