import { getErrorMessage } from "./errorRegistry.js";

export function getDisplayErrorMessage(error, fallbackCode, params) {
  if (typeof error === "string" && error.trim()) return error;
  if (typeof error?.message === "string" && error.message.trim()) return error.message;
  if (typeof error?.code === "string" && error.code.trim()) {
    return getErrorMessage(error.code, "en", params);
  }
  if (fallbackCode) {
    return getErrorMessage(fallbackCode, "en", params);
  }
  return "";
}
