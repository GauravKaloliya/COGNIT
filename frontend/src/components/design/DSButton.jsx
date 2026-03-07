import React from "react";

export default function DSButton({ variant = "primary", className = "", ...props }) {
  return <button className={`${variant} ${className}`.trim()} {...props} />;
}
