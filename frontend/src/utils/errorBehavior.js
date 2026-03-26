import { APP_ROUTES } from "../constants/routes";
import { ERROR_UI_EVENTS } from "../constants/errorUiEvents";
import { getErrorMessage } from "./errorRegistry";

function emitUiEvent(eventName, detail) {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent(eventName, { detail }));
  } catch {
    // Ignore dispatch failures outside browser contexts.
  }
}

export function applyCodeSpecificErrorBehavior(errorLike, options = {}) {
  const { onRedirect } = options;
  const code = String(errorLike?.code || "").trim();
  if (!code) return;

  if (code === "AUTH_003_0002") {
    emitUiEvent(ERROR_UI_EVENTS.otpResendReady, errorLike);
    return;
  }
  if (code === "AUTH_001_0002") {
    emitUiEvent(ERROR_UI_EVENTS.accountFlagged, errorLike);
    return;
  }
  if (code === "RATE_001_0001") {
    emitUiEvent(ERROR_UI_EVENTS.rateLimit, errorLike);
    return;
  }
  if (code === "NF_001_0001") {
    if (typeof onRedirect === "function") {
      onRedirect(errorLike?.message || getErrorMessage(code));
      return;
    }
    if (typeof window !== "undefined") {
      window.location.assign(APP_ROUTES.home);
    }
  }
}

