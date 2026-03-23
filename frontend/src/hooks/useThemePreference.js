import { useEffect, useState } from "react";
import { runtimeConfig } from "../config/runtime";
import { getStoredValue, saveStoredValue } from "../utils/storage";
import { BROWSER_FLAGS } from "../constants/browser";

function readDarkMode() {
  return getStoredValue(runtimeConfig.storageKeys.darkMode, false, { area: "local" }) === true;
}

export function useThemePreference() {
  const [darkMode, setDarkMode] = useState(() => readDarkMode());

  useEffect(() => {
    document.body.classList.toggle(BROWSER_FLAGS.darkModeClass, darkMode);
    saveStoredValue(runtimeConfig.storageKeys.darkMode, darkMode === true, { area: "local" });
  }, [darkMode]);

  return {
    darkMode,
    toggleDarkMode: () => setDarkMode((prev) => !prev),
  };
}
