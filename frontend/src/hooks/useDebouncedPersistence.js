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

  useEffect(() => () => {
    if (timeoutRef.current) {
      clearScheduledTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
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
    lastSavedSerializedRef.current = null;
  };

  return {
    markValueSaved,
    resetSavedValue,
  };
}
