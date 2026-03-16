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

    const preventBack = () => {
      window.history.pushState(null, "", window.location.href);
      if (!blockedRef.current) {
        blockedRef.current = true;
        if (onBlocked) onBlocked(message);
      }
    };

    window.history.pushState(null, "", window.location.href);
    window.addEventListener(BROWSER_EVENTS.beforeUnload, preventUnload);
    window.addEventListener(BROWSER_EVENTS.popState, preventBack);

    return () => {
      window.removeEventListener(BROWSER_EVENTS.beforeUnload, preventUnload);
      window.removeEventListener(BROWSER_EVENTS.popState, preventBack);
    };
  }, [enabled, message, onBlocked]);
}
