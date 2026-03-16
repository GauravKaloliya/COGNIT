import { useEffect, useState, useCallback, useRef } from "react";
import { apiFetch, endpoints } from "../utils/api";
import { getErrorMessage } from "../utils/errorRegistry";
import { runtimeConfig } from "../config/runtime";
import { BROWSER_EVENTS } from "../constants/browser";
import { REQUEST_CACHE, REQUEST_CODES, REQUEST_METHODS, ERROR_NAMES } from "../constants/request";
import { APP_FLOW } from "../config/appFlow";
import { TOAST_VARIANTS } from "../constants/ui";
import { API_ROUTES } from "../constants/routes";
import { clearScheduledInterval, clearScheduledTimeout, scheduleInterval, scheduleTimeout } from "../utils/timing";

export function useSystemHealth({
  publicId,
  stage,
  paymentVerified,
  pauseSurveyPaymentGuard = false,
  isActiveTabOwner = true,
  setPaymentVerified,
  setStage,
  setPaymentSubStage,
  addToast,
}) {
  const [systemReady, setSystemReady] = useState(false);
  const [systemError, setSystemError] = useState(null);
  const [systemChecking, setSystemChecking] = useState(true);
  const [retryTrigger, setRetryTrigger] = useState(0);
  const [browserOnline, setBrowserOnline] = useState(navigator.onLine);
  const [apiReachable, setApiReachable] = useState(navigator.onLine);
  const [lastSyncAt, setLastSyncAt] = useState(null);
  const probeFailCountRef = useRef(0);
  const healthAbortRef = useRef(null);
  const paymentStatusAbortRef = useRef(null);
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
    if (!isActiveTabOwner) {
      return false;
    }
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
  }, [markApiReachable, markProbeFailure, isActiveTabOwner]);

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

    const scheduleNext = (baseMs) => {
      const jitter = Math.floor(Math.random() * 1000);
      const delay = Math.max(2000, baseMs + jitter);
      timeoutId = scheduleTimeout(checkHealth, delay);
    };

    const checkHealth = async () => {
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
        if (err?.name === ERROR_NAMES.abort) {
          return;
        }
        if (cancelled) return;
        markProbeFailure();
        setSystemReady(false);
        setSystemError(err.name === ERROR_NAMES.abort ? getErrorMessage("SYS_002_0008") : getErrorMessage("SYS_002_0001"));
        healthBackoffRef.current = Math.min(4, healthBackoffRef.current * 2);
      } finally {
        healthAbortRef.current = null;
        if (!cancelled) setSystemChecking(false);
        if (!cancelled) {
          scheduleNext(runtimeConfig.healthCheckIntervalMs * healthBackoffRef.current);
        }
      }
    };

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

  useEffect(() => {
    const verifyPaymentForSurvey = async () => {
      if (stage === APP_FLOW.stages.survey && !paymentVerified && systemReady && !pauseSurveyPaymentGuard) {
        try {
          if (paymentStatusAbortRef.current) {
            paymentStatusAbortRef.current.abort();
          }
          const controller = new AbortController();
          paymentStatusAbortRef.current = controller;
          const paymentStatus = await endpoints.getParticipantPaymentStatus(publicId, { signal: controller.signal });
          if (pauseSurveyPaymentGuard) return;
          if (paymentStatus.is_verified) {
            setPaymentVerified(true);
          } else {
            addToast(getErrorMessage("PAY_001_0005"), TOAST_VARIANTS.error);
            setStage(APP_FLOW.stages.payment);
            setPaymentSubStage(APP_FLOW.paymentSubStages.content);
          }
        } catch (err) {
          if (err?.code === REQUEST_CODES.aborted) {
            return;
          }
          if (pauseSurveyPaymentGuard) return;
          addToast(getErrorMessage("PAY_001_0005"), TOAST_VARIANTS.error);
          setStage(APP_FLOW.stages.payment);
          setPaymentSubStage(APP_FLOW.paymentSubStages.content);
        } finally {
          paymentStatusAbortRef.current = null;
        }
      }
    };

    verifyPaymentForSurvey();
    return () => {
      if (paymentStatusAbortRef.current) {
        paymentStatusAbortRef.current.abort();
        paymentStatusAbortRef.current = null;
      }
    };
  }, [stage, systemReady, paymentVerified, publicId, addToast, setPaymentVerified, setStage, setPaymentSubStage, pauseSurveyPaymentGuard]);

  return {
    systemReady,
    systemError,
    systemChecking,
    online: browserOnline && apiReachable,
    lastSyncAt,
    retryHealthCheck: () => setRetryTrigger((prev) => prev + 1),
  };
}
