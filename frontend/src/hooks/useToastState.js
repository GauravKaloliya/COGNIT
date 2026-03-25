import { useCallback, useRef, useState } from "react";
import { runtimeConfig } from "../config/runtime";
import { createClientId } from "../utils/appControllerState";
import { scheduleTimeout } from "../utils/timing";

export function useToastState() {
  const [toasts, setToasts] = useState([]);
  const toastRef = useRef(new Map());

  const addToast = useCallback((message, type = "info", action) => {
    const dedupeKey = `${type}:${message}`;
    const now = Date.now();
    const lastShownAt = toastRef.current.get(dedupeKey) || 0;
    if (now - lastShownAt < runtimeConfig.toastDedupeWindowMs) {
      return;
    }
    toastRef.current.set(dedupeKey, now);
    const id = createClientId();
    setToasts((prev) => [...prev, { id, message, type, action }]);
    scheduleTimeout(
      () => setToasts((prev) => prev.filter((toast) => toast.id !== id)),
      runtimeConfig.toastAutoDismissMs
    );
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  return {
    toasts,
    addToast,
    dismissToast,
  };
}
