import React from "react";

export default function SubmitStatusBanner({ message = "", visible = false }) {
  if (!visible || !String(message || "").trim()) return null;
  return <div className="banner info">{message}</div>;
}
