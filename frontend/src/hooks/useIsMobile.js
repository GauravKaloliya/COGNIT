import { useEffect, useState } from "react";

export function useIsMobile(maxWidth = 767) {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(`(max-width: ${maxWidth}px)`).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const media = window.matchMedia(`(max-width: ${maxWidth}px)`);
    const onChange = () => setIsMobile(media.matches);
    if (media.addEventListener) {
      media.addEventListener("change", onChange);
    } else {
      media.addListener(onChange);
    }
    return () => {
      if (media.removeEventListener) {
        media.removeEventListener("change", onChange);
      } else {
        media.removeListener(onChange);
      }
    };
  }, [maxWidth]);

  return isMobile;
}
