import React from "react";

export default function ThemeToggleIcon({ darkMode }) {
  if (darkMode) {
    return (
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        focusable="false"
      >
        <path
          d="M12 4.5V2.5M12 21.5v-2M4.5 12H2.5m19 0h-2M5.6 5.6l-1.4-1.4m15.2 15.2-1.4-1.4M18.4 5.6l1.4-1.4M5.6 18.4l-1.4 1.4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <circle cx="12" cy="12" r="4.5" fill="currentColor" />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M20 14.5A8.5 8.5 0 0 1 9.5 4a7.5 7.5 0 1 0 10.5 10.5Z"
        fill="currentColor"
      />
    </svg>
  );
}
