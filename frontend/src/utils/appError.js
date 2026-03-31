import { getErrorMessage } from "./errorRegistry.js";

function hasTemplatePlaceholders(message) {
  return typeof message === "string" && /\{[a-zA-Z0-9_]+\}/.test(message);
}

export function getDisplayErrorMessage(error, fallbackCode, params) {
  if (typeof error === "string" && error.trim()) return error;
  if (typeof error?.code === "string" && error.code.trim()) {
    return getErrorMessage(error.code, "en", params);
  }
  if (typeof error?.message === "string" && error.message.trim()) {
    if (hasTemplatePlaceholders(error.message) && fallbackCode) {
      return getErrorMessage(fallbackCode, "en", params);
    }
    return error.message;
  }
  if (fallbackCode) {
    return getErrorMessage(fallbackCode, "en", params);
  }
  return "";
}
