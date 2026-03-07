import React from "react";

export default function DSCard({ className = "", children }) {
  return <section className={`ds-card ${className}`.trim()}>{children}</section>;
}
