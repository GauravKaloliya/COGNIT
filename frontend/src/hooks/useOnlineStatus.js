import { useEffect, useState } from "react";
import { BROWSER_EVENTS } from "../constants/browser";

function readOnlineStatus() {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(readOnlineStatus);

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
