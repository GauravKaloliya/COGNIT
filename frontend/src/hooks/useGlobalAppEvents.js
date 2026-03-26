import { useEffect, useState } from "react";
import { BROWSER_EVENTS } from "../constants/browser";
import { ERROR_UI_EVENTS } from "../constants/errorUiEvents";
import { initErrorReporter, reportClientError } from "../utils/errorReporter";
import { uiText } from "../utils/uiText";
import { getErrorMessage } from "../utils/errorRegistry";

export function useGlobalAppEvents() {
  const [error, setError] = useState(null);
  const [rateLimitError, setRateLimitError] = useState(null);
  const [maintenanceError, setMaintenanceError] = useState(null);

  useEffect(() => {
    const deferSetError = (value) => {
      const schedule = typeof queueMicrotask === "function" ? queueMicrotask : (cb) => setTimeout(cb, 0);
      schedule(() => setError(value));
    };

    const reportWindowError = (payload) => {
      reportClientError({
        ...payload,
        route: typeof window !== "undefined" ? window.location.pathname : "",
      });
    };

    const handleError = (event) => {
      deferSetError(event.error);
      reportWindowError({
        message: event?.message || event?.error?.message,
        stack: event?.error?.stack,
        context: "window_error",
      });
    };

    const handleUnhandledRejection = (event) => {
      deferSetError(event.reason);
      reportWindowError({
        message: event?.reason?.message || String(event?.reason || ""),
        stack: event?.reason?.stack,
        context: "unhandled_rejection",
      });
    };

    const handleRateLimit = (event) => {
      const detail = event?.detail || null;
      deferSetError(null);
      setMaintenanceError(null);
      setRateLimitError(detail || { message: uiText("app.rateLimitDefault") });
    };

    const handleMaintenance = (event) => {
      const detail = event?.detail || null;
      deferSetError(null);
      setRateLimitError(null);
      setMaintenanceError(detail || { message: uiText("app.maintenanceDefault") });
    };

    const handleAccountFlagged = (event) => {
      const detail = event?.detail || {};
      setRateLimitError(null);
      setMaintenanceError(null);
      deferSetError({
        ...detail,
        code: detail?.code || "AUTH_001_0002",
        message: detail?.message || getErrorMessage("AUTH_001_0002"),
      });
    };

    const teardownReporter = initErrorReporter();
    window.addEventListener(BROWSER_EVENTS.error, handleError);
    window.addEventListener(BROWSER_EVENTS.unhandledRejection, handleUnhandledRejection);
    window.addEventListener(ERROR_UI_EVENTS.rateLimit, handleRateLimit);
    window.addEventListener(ERROR_UI_EVENTS.maintenance, handleMaintenance);
    window.addEventListener(ERROR_UI_EVENTS.accountFlagged, handleAccountFlagged);

    return () => {
      window.removeEventListener(BROWSER_EVENTS.error, handleError);
      window.removeEventListener(BROWSER_EVENTS.unhandledRejection, handleUnhandledRejection);
      window.removeEventListener(ERROR_UI_EVENTS.rateLimit, handleRateLimit);
      window.removeEventListener(ERROR_UI_EVENTS.maintenance, handleMaintenance);
      window.removeEventListener(ERROR_UI_EVENTS.accountFlagged, handleAccountFlagged);
      teardownReporter();
    };
  }, []);

  return {
    error,
    resetError: () => setError(null),
    rateLimitError,
    resetRateLimit: () => setRateLimitError(null),
    maintenanceError,
    resetMaintenance: () => setMaintenanceError(null),
  };
}
