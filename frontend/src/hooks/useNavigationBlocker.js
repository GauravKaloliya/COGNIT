import { useEffect, useRef } from "react";
import { BROWSER_EVENTS } from "../constants/browser";

export function useNavigationBlocker({ enabled, message, onBlocked }) {
  const blockedRef = useRef(false);

  useEffect(() => {
    blockedRef.current = false;
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return undefined;

    const preventUnload = (e) => {
      e.preventDefault();
      e.returnValue = "";
      return "";
    };

    window.addEventListener(BROWSER_EVENTS.beforeUnload, preventUnload);

    return () => {
      window.removeEventListener(BROWSER_EVENTS.beforeUnload, preventUnload);
    };
  }, [enabled, message, onBlocked]);
}
