import { useEffect, useState, useCallback, useRef } from "react";
import { apiFetch, endpoints } from "../utils/api";
import { getErrorMessage } from "../utils/errorRegistry";
import { runtimeConfig } from "../config/runtime";

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
  const probeFailCountRef = useRef(0);
  const healthAbortRef = useRef(null);
  const paymentStatusAbortRef = useRef(null);
  const healthBackoffRef = useRef(1);

  const markApiReachable = useCallback(() => {
    probeFailCountRef.current = 0;
    setApiReachable(true);
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
      const timeoutId = setTimeout(() => controller.abort(), runtimeConfig.networkProbeTimeoutMs);
      try {
        await apiFetch("/health", {
          method: "GET",
          cache: "no-store",
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
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
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [probeApiReachability]);

  useEffect(() => {
    if (!isActiveTabOwner) return undefined;
    if (!browserOnline || apiReachable) return undefined;
    probeApiReachability();
    const interval = setInterval(probeApiReachability, runtimeConfig.networkProbeIntervalMs);
    return () => clearInterval(interval);
  }, [browserOnline, apiReachable, probeApiReachability, isActiveTabOwner]);

  useEffect(() => {
    if (!isActiveTabOwner) return undefined;
    let cancelled = false;
    let timeoutId = null;

    const scheduleNext = (baseMs) => {
      const jitter = Math.floor(Math.random() * 1000);
      const delay = Math.max(2000, baseMs + jitter);
      timeoutId = setTimeout(checkHealth, delay);
    };

    const checkHealth = async () => {
      setSystemChecking(true);
      try {
        if (healthAbortRef.current) {
          healthAbortRef.current.abort();
        }
        const controller = new AbortController();
        healthAbortRef.current = controller;
        const timeoutGuard = setTimeout(() => controller.abort(), runtimeConfig.healthCheckTimeoutMs);
        try {
          const data = await apiFetch("/health", { signal: controller.signal });
          if (cancelled) return;
          markApiReachable();

          if (data?.status === "healthy" && data?.database === "connected") {
            setSystemReady(true);
            setSystemError(null);
            healthBackoffRef.current = 1;
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
          clearTimeout(timeoutGuard);
        }
      } catch (err) {
        if (err?.name === "AbortError") {
          return;
        }
        if (cancelled) return;
        markProbeFailure();
        setSystemReady(false);
        setSystemError(err.name === "AbortError" ? getErrorMessage("SYS_002_0008") : getErrorMessage("SYS_002_0001"));
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
      if (timeoutId) clearTimeout(timeoutId);
      if (healthAbortRef.current) {
        healthAbortRef.current.abort();
        healthAbortRef.current = null;
      }
    };
  }, [retryTrigger, markApiReachable, markProbeFailure, isActiveTabOwner]);

  useEffect(() => {
    const verifyPaymentForSurvey = async () => {
      if (stage === "survey" && !paymentVerified && systemReady && !pauseSurveyPaymentGuard) {
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
            addToast(getErrorMessage("PAY_001_0005"), "error");
            setStage("payment");
            setPaymentSubStage("content");
          }
        } catch (err) {
          if (err?.code === "REQ_ABORTED") {
            return;
          }
          if (pauseSurveyPaymentGuard) return;
          addToast(getErrorMessage("PAY_001_0005"), "error");
          setStage("payment");
          setPaymentSubStage("content");
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
    retryHealthCheck: () => setRetryTrigger((prev) => prev + 1),
  };
}
