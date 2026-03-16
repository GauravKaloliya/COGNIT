import { useEffect, useState } from "react";
import { BROWSER_EVENTS } from "../constants/browser";

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== "undefined" ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener(BROWSER_EVENTS.online, handleOnline);
    window.addEventListener(BROWSER_EVENTS.offline, handleOffline);
    return () => {
      window.removeEventListener(BROWSER_EVENTS.online, handleOnline);
      window.removeEventListener(BROWSER_EVENTS.offline, handleOffline);
    };
  }, []);

  return isOnline;
}
