import React from "react";

export default function DSCard({ className = "", children }) {
  return <section className={`ds-card card ${className}`.trim()}>{children}</section>;
}
