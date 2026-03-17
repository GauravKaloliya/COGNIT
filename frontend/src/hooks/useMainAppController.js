import { useEffect, useState } from "react";
import { runtimeConfig } from "../config/runtime";
import { getStoredValue, isStorageAvailable, saveStoredValue } from "../utils/storage";
import { BROWSER_EVENTS, BROWSER_FLAGS } from "../constants/browser";
import { initErrorReporter, reportClientError } from "../utils/errorReporter";

function readDarkMode() {
  return getStoredValue(runtimeConfig.storageKeys.darkMode, false, { area: "local" }) === true;
}

export function useMainAppController() {
  const [darkMode, setDarkMode] = useState(() => readDarkMode());
  const [error, setError] = useState(null);
  const [storageOk] = useState(() => isStorageAvailable("local"));

  useEffect(() => {
    document.body.classList.toggle(BROWSER_FLAGS.darkModeClass, darkMode);
    saveStoredValue(runtimeConfig.storageKeys.darkMode, darkMode === true, { area: "local" });
  }, [darkMode]);

  useEffect(() => {
    const deferSetError = (value) => {
      const schedule = typeof queueMicrotask === "function" ? queueMicrotask : (cb) => setTimeout(cb, 0);
      schedule(() => setError(value));
    };

    const handleError = (event) => {
      // No-op: suppress console noise in production.
      deferSetError(event.error);
      reportClientError({
        message: event?.message || event?.error?.message,
        stack: event?.error?.stack,
        context: "window_error",
        route: typeof window !== "undefined" ? window.location.pathname : "",
      });
    };

    const handleUnhandledRejection = (event) => {
      // No-op: suppress console noise in production.
      deferSetError(event.reason);
      reportClientError({
        message: event?.reason?.message || String(event?.reason || ""),
        stack: event?.reason?.stack,
        context: "unhandled_rejection",
        route: typeof window !== "undefined" ? window.location.pathname : "",
      });
    };

    const teardownReporter = initErrorReporter();
    window.addEventListener(BROWSER_EVENTS.error, handleError);
    window.addEventListener(BROWSER_EVENTS.unhandledRejection, handleUnhandledRejection);
    return () => {
      window.removeEventListener(BROWSER_EVENTS.error, handleError);
      window.removeEventListener(BROWSER_EVENTS.unhandledRejection, handleUnhandledRejection);
      teardownReporter();
    };
  }, []);

  return {
    darkMode,
    storageOk,
    error,
    resetError: () => setError(null),
    toggleDarkMode: () => setDarkMode((prev) => !prev),
  };
}
