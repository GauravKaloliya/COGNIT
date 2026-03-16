import { useEffect, useState } from "react";
import { runtimeConfig } from "../config/runtime";
import { getStoredValue, saveStoredValue } from "../utils/storage";
import { BROWSER_EVENTS, BROWSER_FLAGS } from "../constants/browser";

function readDarkMode() {
  return getStoredValue(runtimeConfig.storageKeys.darkMode, false) === true;
}

export function useMainAppController() {
  const [darkMode, setDarkMode] = useState(() => readDarkMode());
  const [error, setError] = useState(null);

  useEffect(() => {
    document.body.classList.toggle(BROWSER_FLAGS.darkModeClass, darkMode);
    saveStoredValue(runtimeConfig.storageKeys.darkMode, darkMode === true);
  }, [darkMode]);

  useEffect(() => {
    const handleError = (event) => {
      console.error("Application error:", event.error);
      setError(event.error);
    };

    const handleUnhandledRejection = (event) => {
      console.error("Unhandled promise rejection:", event.reason);
      setError(event.reason);
    };

    window.addEventListener(BROWSER_EVENTS.error, handleError);
    window.addEventListener(BROWSER_EVENTS.unhandledRejection, handleUnhandledRejection);
    return () => {
      window.removeEventListener(BROWSER_EVENTS.error, handleError);
      window.removeEventListener(BROWSER_EVENTS.unhandledRejection, handleUnhandledRejection);
    };
  }, []);

  return {
    darkMode,
    error,
    resetError: () => setError(null),
    toggleDarkMode: () => setDarkMode((prev) => !prev),
  };
}
