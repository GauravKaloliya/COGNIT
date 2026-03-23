import { useEffect, useState } from "react";
import { BROWSER_EVENTS } from "../constants/browser";
import { initErrorReporter, reportClientError } from "../utils/errorReporter";
import { uiText } from "../utils/uiText";

const RATE_LIMIT_EVENT = "cognit:rate-limit";
const MAINTENANCE_EVENT = "cognit:maintenance";

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

    const teardownReporter = initErrorReporter();
    window.addEventListener(BROWSER_EVENTS.error, handleError);
    window.addEventListener(BROWSER_EVENTS.unhandledRejection, handleUnhandledRejection);
    window.addEventListener(RATE_LIMIT_EVENT, handleRateLimit);
    window.addEventListener(MAINTENANCE_EVENT, handleMaintenance);

    return () => {
      window.removeEventListener(BROWSER_EVENTS.error, handleError);
      window.removeEventListener(BROWSER_EVENTS.unhandledRejection, handleUnhandledRejection);
      window.removeEventListener(RATE_LIMIT_EVENT, handleRateLimit);
      window.removeEventListener(MAINTENANCE_EVENT, handleMaintenance);
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
