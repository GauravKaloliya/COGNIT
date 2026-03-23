import { isStorageAvailable } from "../utils/storage";
import { useGlobalAppEvents } from "./useGlobalAppEvents";
import { useThemePreference } from "./useThemePreference";

export function useMainAppController() {
  const { darkMode, toggleDarkMode } = useThemePreference();
  const {
    error,
    resetError,
    rateLimitError,
    resetRateLimit,
    maintenanceError,
    resetMaintenance,
  } = useGlobalAppEvents();

  return {
    darkMode,
    storageOk: isStorageAvailable("local"),
    error,
    resetError,
    rateLimitError,
    resetRateLimit,
    maintenanceError,
    resetMaintenance,
    toggleDarkMode,
  };
}
