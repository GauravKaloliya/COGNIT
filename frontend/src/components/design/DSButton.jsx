import React from "react";
import { BUTTON_VARIANTS } from "../../constants/componentUi";

export default function DSButton({ variant = BUTTON_VARIANTS.primary, className = "", ...props }) {
  return <button className={`${variant} ${className}`.trim()} {...props} />;
}
