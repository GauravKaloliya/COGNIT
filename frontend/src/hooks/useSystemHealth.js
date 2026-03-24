import { useEffect, useState, useCallback, useRef } from "react";
import { apiFetch } from "../utils/api";
import { getErrorMessage } from "../utils/errorRegistry";
import { runtimeConfig } from "../config/runtime";
import { BROWSER_EVENTS } from "../constants/browser";
import { REQUEST_CACHE, REQUEST_METHODS, ERROR_NAMES } from "../constants/request";
import { API_ROUTES } from "../constants/routes";
import { clearScheduledInterval, clearScheduledTimeout, scheduleInterval, scheduleTimeout } from "../utils/timing";

export function useSystemHealth({ isActiveTabOwner = true }) {
  const [systemReady, setSystemReady] = useState(false);
  const [systemError, setSystemError] = useState(null);
  const [systemChecking, setSystemChecking] = useState(true);
  const [retryTrigger, setRetryTrigger] = useState(0);
  const [browserOnline, setBrowserOnline] = useState(navigator.onLine);
  const [apiReachable, setApiReachable] = useState(navigator.onLine);
  const [lastSyncAt, setLastSyncAt] = useState(null);
  const probeFailCountRef = useRef(0);
  const healthAbortRef = useRef(null);
  const healthBackoffRef = useRef(1);

  const markApiReachable = useCallback(() => {
    probeFailCountRef.current = 0;
    setApiReachable(true);
    setLastSyncAt(Date.now());
  }, []);

  const markProbeFailure = useCallback(() => {
    probeFailCountRef.current += 1;
    if (probeFailCountRef.current >= runtimeConfig.networkProbeFailThreshold) {
      setApiReachable(false);
    }
  }, []);

  const probeApiReachability = useCallback(async () => {
    if (!isActiveTabOwner) return false;
    if (!navigator.onLine) {
      setBrowserOnline(false);
      setApiReachable(false);
      return false;
    }
    try {
      const controller = new AbortController();
      const timeoutId = scheduleTimeout(() => controller.abort(), runtimeConfig.networkProbeTimeoutMs);
      try {
        await apiFetch(API_ROUTES.health, {
          method: REQUEST_METHODS.get,
          cache: REQUEST_CACHE.noStore,
          signal: controller.signal,
        });
      } finally {
        clearScheduledTimeout(timeoutId);
      }
      markApiReachable();
      return true;
    } catch {
      markProbeFailure();
      return false;
    }
  }, [isActiveTabOwner, markApiReachable, markProbeFailure]);

  useEffect(() => {
    const handleOnline = () => {
      setBrowserOnline(true);
      probeApiReachability();
    };
    const handleOffline = () => {
      setBrowserOnline(false);
      setApiReachable(false);
    };
    window.addEventListener(BROWSER_EVENTS.online, handleOnline);
    window.addEventListener(BROWSER_EVENTS.offline, handleOffline);
    return () => {
      window.removeEventListener(BROWSER_EVENTS.online, handleOnline);
      window.removeEventListener(BROWSER_EVENTS.offline, handleOffline);
    };
  }, [probeApiReachability]);

  useEffect(() => {
    if (!isActiveTabOwner) return undefined;
    if (!browserOnline || apiReachable) return undefined;
    probeApiReachability();
    const interval = scheduleInterval(probeApiReachability, runtimeConfig.networkProbeIntervalMs);
    return () => clearScheduledInterval(interval);
  }, [browserOnline, apiReachable, probeApiReachability, isActiveTabOwner]);

  useEffect(() => {
    if (!isActiveTabOwner) return undefined;
    let cancelled = false;
    let timeoutId = null;

    function scheduleNext(callback, baseMs) {
      const jitter = Math.floor(Math.random() * 1000);
      const delay = Math.max(2000, baseMs + jitter);
      timeoutId = scheduleTimeout(callback, delay);
    }

    async function checkHealth() {
      setSystemChecking(true);
      try {
        if (healthAbortRef.current) {
          healthAbortRef.current.abort();
        }
        const controller = new AbortController();
        healthAbortRef.current = controller;
        const timeoutGuard = scheduleTimeout(() => controller.abort(), runtimeConfig.healthCheckTimeoutMs);
        try {
          const data = await apiFetch(API_ROUTES.health, { signal: controller.signal, method: REQUEST_METHODS.get });
          if (cancelled) return;
          markApiReachable();

          if (data?.status === "healthy" && data?.database === "connected") {
            setSystemReady(true);
            setSystemError(null);
            healthBackoffRef.current = 1;
            setLastSyncAt(Date.now());
          } else {
            setSystemReady(false);
            setSystemError(
              data?.error
                ? getErrorMessage("SYS_002_0020", "en", { error: data.error })
                : getErrorMessage("SYS_002_0021")
            );
            healthBackoffRef.current = Math.min(4, healthBackoffRef.current * 2);
          }
        } finally {
          clearScheduledTimeout(timeoutGuard);
        }
      } catch (err) {
        if (err?.name === ERROR_NAMES.abort) return;
        if (cancelled) return;
        markProbeFailure();
        setSystemReady(false);
        setSystemError(err.name === ERROR_NAMES.abort ? getErrorMessage("SYS_002_0008") : getErrorMessage("SYS_002_0001"));
        healthBackoffRef.current = Math.min(4, healthBackoffRef.current * 2);
      } finally {
        healthAbortRef.current = null;
        if (!cancelled) setSystemChecking(false);
        if (!cancelled) scheduleNext(checkHealth, runtimeConfig.healthCheckIntervalMs * healthBackoffRef.current);
      }
    }

    checkHealth();
    return () => {
      cancelled = true;
      if (timeoutId) clearScheduledTimeout(timeoutId);
      if (healthAbortRef.current) {
        healthAbortRef.current.abort();
        healthAbortRef.current = null;
      }
    };
  }, [retryTrigger, markApiReachable, markProbeFailure, isActiveTabOwner]);

  return {
    systemReady,
    systemError,
    systemChecking,
    online: browserOnline && apiReachable,
    lastSyncAt,
    retryHealthCheck: () => setRetryTrigger((prev) => prev + 1),
  };
}
