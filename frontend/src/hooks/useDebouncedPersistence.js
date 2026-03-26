import { useEffect, useRef } from "react";
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
  const lastSavedSerializedRef = useRef(null);
  const latestValueRef = useRef(value);
  const latestEnabledRef = useRef(enabled);
  const latestOnWriteRef = useRef(onWrite);
  const latestOnErrorRef = useRef(onError);

  latestValueRef.current = value;
  latestEnabledRef.current = enabled;
  latestOnWriteRef.current = onWrite;
  latestOnErrorRef.current = onError;

  const flushPendingWrite = () => {
    if (!timeoutRef.current || !latestEnabledRef.current) {
      return;
    }

    const latestValue = latestValueRef.current;
    const serializedValue = serializeValue(latestValue);
    if (serializedValue === lastSavedSerializedRef.current) {
      clearScheduledTimeout(timeoutRef.current);
      timeoutRef.current = null;
      return;
    }

    clearScheduledTimeout(timeoutRef.current);
    timeoutRef.current = null;

    try {
      latestOnWriteRef.current?.(latestValue);
      lastSavedSerializedRef.current = serializedValue;
    } catch (error) {
      latestOnErrorRef.current?.(error);
    }
  };

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        flushPendingWrite();
      }
    };

    const handleBeforeUnload = () => {
      flushPendingWrite();
    };

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }
    if (typeof window !== "undefined") {
      window.addEventListener("beforeunload", handleBeforeUnload);
      window.addEventListener("pagehide", handleBeforeUnload);
    }

    return () => {
      flushPendingWrite();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("beforeunload", handleBeforeUnload);
        window.removeEventListener("pagehide", handleBeforeUnload);
      }
      if (timeoutRef.current) {
        clearScheduledTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      if (timeoutRef.current) {
        clearScheduledTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      return;
    }

    const serializedValue = serializeValue(value);
    if (serializedValue === lastSavedSerializedRef.current) {
      return;
    }

    onSchedule?.();

    if (timeoutRef.current) {
      clearScheduledTimeout(timeoutRef.current);
    }

    timeoutRef.current = scheduleTimeout(() => {
      try {
        onWrite(value);
        lastSavedSerializedRef.current = serializedValue;
      } catch (error) {
        onError?.(error);
      } finally {
        timeoutRef.current = null;
      }
    }, delayMs);

    return () => {
      if (timeoutRef.current) {
        clearScheduledTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [delayMs, enabled, onError, onSchedule, onWrite, value]);

  const markValueSaved = (savedValue) => {
    lastSavedSerializedRef.current = serializeValue(savedValue);
  };

  const resetSavedValue = () => {
    if (timeoutRef.current) {
      clearScheduledTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    lastSavedSerializedRef.current = null;
  };

  return {
    markValueSaved,
    resetSavedValue,
  };
}
