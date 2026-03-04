import { useEffect, useRef } from "react";

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
    window.addEventListener("beforeunload", preventUnload);
    window.addEventListener("popstate", preventBack);

    return () => {
      window.removeEventListener("beforeunload", preventUnload);
      window.removeEventListener("popstate", preventBack);
    };
  }, [enabled, message, onBlocked]);
}

