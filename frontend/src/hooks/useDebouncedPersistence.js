import { useCallback, useEffect, useRef } from "react";
import { clearScheduledTimeout, scheduleTimeout } from "../utils/timing";

function serializeValue(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function useDebouncedPersistence({
  enabled,
  value,
  delayMs = 500,
  onWrite,
  onError,
  onSchedule,
}) {
  const timeoutRef = useRef(null);
  const lastSavedValueRef = useRef(null);
  const latestRef = useRef({ enabled, value, onWrite, onError, onSchedule });
  latestRef.current = { enabled, value, onWrite, onError, onSchedule };

  const flushPendingWrite = useCallback(() => {
    if (!timeoutRef.current || !latestRef.current.enabled) return;

    const { value: latestValue, onWrite: latestOnWrite, onError: latestOnError } = latestRef.current;
    const serializedValue = serializeValue(latestValue);
    clearScheduledTimeout(timeoutRef.current);
    timeoutRef.current = null;

    if (serializedValue === lastSavedValueRef.current) return;

    try {
      latestOnWrite?.(latestValue);
      lastSavedValueRef.current = serializedValue;
    } catch (error) {
      latestOnError?.(error);
    }
  }, []);

  useEffect(() => {
    const handlePageHide = () => flushPendingWrite();
    const handleVisibilityChange = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        flushPendingWrite();
      }
    };

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }
    if (typeof window !== "undefined") {
      window.addEventListener("beforeunload", handlePageHide);
      window.addEventListener("pagehide", handlePageHide);
    }

    return () => {
      flushPendingWrite();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("beforeunload", handlePageHide);
        window.removeEventListener("pagehide", handlePageHide);
      }
    };
  }, [flushPendingWrite]);

  useEffect(() => {
    if (timeoutRef.current) {
      clearScheduledTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    if (!enabled) return;

    const serializedValue = serializeValue(value);
    if (serializedValue === lastSavedValueRef.current) return;

    latestRef.current.onSchedule?.();
    timeoutRef.current = scheduleTimeout(() => {
      flushPendingWrite();
    }, delayMs);

    return () => {
      if (timeoutRef.current) {
        clearScheduledTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [delayMs, enabled, flushPendingWrite, value]);

  const markValueSaved = useCallback((savedValue) => {
    lastSavedValueRef.current = serializeValue(savedValue);
  }, []);

  const resetSavedValue = useCallback(() => {
    if (timeoutRef.current) {
      clearScheduledTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    lastSavedValueRef.current = null;
  }, []);

  return {
    markValueSaved,
    resetSavedValue,
  };
}
