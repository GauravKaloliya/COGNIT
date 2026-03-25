import { useCallback, useRef, useState } from "react";
import { runtimeConfig } from "../config/runtime";
import { createClientId } from "../utils/appControllerState";
import { scheduleTimeout } from "../utils/timing";

function resolveToastPriority(type) {
  return runtimeConfig.toastPriority?.[type] ?? runtimeConfig.toastPriority?.info ?? 0;
}

export function useToastState() {
  const [toasts, setToasts] = useState([]);
  const toastRef = useRef(new Map()); // dedupeKey -> timestamp

  const addToast = useCallback((message, type = "info", action, options = {}) => {
    const normalizedType = ["error", "warning", "success", "info"].includes(type) ? type : "info";
    const dedupeKey = `${type}:${message}`;
    const now = Date.now();
    const lastShownAt = toastRef.current.get(dedupeKey) || 0;
    if (!options.force && now - lastShownAt < runtimeConfig.toastDedupeWindowMs) {
      return;
    }
    toastRef.current.set(dedupeKey, now);
    const priority = resolveToastPriority(normalizedType);
    const id = createClientId();
    setToasts((prev) => {
      const replaceWindowMs = Math.max(0, Number(runtimeConfig.toastReplaceWindowMs || 0));
      const maxStack = Math.max(1, Number(runtimeConfig.toastMaxStack || 4));
      const base = [...prev];
      const similarIndex = base.findIndex(
        (toast) =>
          toast.type === normalizedType
          && toast.message === message
          && now - Number(toast.createdAt || 0) <= replaceWindowMs
      );
      if (similarIndex >= 0) {
        base[similarIndex] = {
          ...base[similarIndex],
          action: action || base[similarIndex].action,
          createdAt: now,
          priority,
        };
        return base;
      }

      if (base.length >= maxStack) {
        let candidateIndex = -1;
        let candidatePriority = Number.POSITIVE_INFINITY;
        let candidateCreatedAt = Number.POSITIVE_INFINITY;
        base.forEach((toast, index) => {
          const currentPriority = Number(toast.priority ?? resolveToastPriority(toast.type));
          const createdAt = Number(toast.createdAt || 0);
          if (
            currentPriority < candidatePriority
            || (currentPriority === candidatePriority && createdAt < candidateCreatedAt)
          ) {
            candidateIndex = index;
            candidatePriority = currentPriority;
            candidateCreatedAt = createdAt;
          }
        });
        if (candidateIndex >= 0 && priority >= candidatePriority) {
          base.splice(candidateIndex, 1);
        } else {
          return base;
        }
      }

      return [...base, { id, message, type: normalizedType, action, createdAt: now, priority }];
    });
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
