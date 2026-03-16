import React from "react";

export default function ThemeToggleIcon({ darkMode }) {
  return (
    <span className="dark-mode-emoji" aria-hidden="true">
      {darkMode ? "☀️" : "🌙"}
    </span>
  );
}
