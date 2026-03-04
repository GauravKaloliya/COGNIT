import { useEffect, useState, useCallback, useRef } from "react";
import { getApiUrl } from "../utils/apiBase";
import { endpoints } from "../utils/api";
import { getErrorMessage } from "../utils/errorRegistry";
import { runtimeConfig } from "../config/runtime";

export function useSystemHealth({
  publicId,
  stage,
  paymentVerified,
  pauseSurveyPaymentGuard = false,
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
    if (!navigator.onLine) {
      setBrowserOnline(false);
      setApiReachable(false);
      return false;
    }
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), runtimeConfig.networkProbeTimeoutMs);
      try {
        await fetch(getApiUrl("/health"), {
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
  }, [markApiReachable, markProbeFailure]);

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
    if (!browserOnline || apiReachable) return undefined;
    probeApiReachability();
    const interval = setInterval(probeApiReachability, runtimeConfig.networkProbeIntervalMs);
    return () => clearInterval(interval);
  }, [browserOnline, apiReachable, probeApiReachability]);

  useEffect(() => {
    let cancelled = false;

    const checkHealth = async () => {
      setSystemChecking(true);
      try {
        if (healthAbortRef.current) {
          healthAbortRef.current.abort();
        }
        const controller = new AbortController();
        healthAbortRef.current = controller;
        const timeoutId = setTimeout(() => controller.abort(), runtimeConfig.healthCheckTimeoutMs);
        let response;
        try {
          response = await fetch(getApiUrl("/health"), { signal: controller.signal });
        } finally {
          clearTimeout(timeoutId);
        }
        if (cancelled) return;
        markApiReachable();

        if (response.ok) {
          const payload = await response.json();
          const data = payload?.success === true ? (payload.data || {}) : (payload || {});
          if (data.status === "healthy" && data.database === "connected") {
            setSystemReady(true);
            setSystemError(null);
          } else {
            setSystemReady(false);
            setSystemError(
              data.error
                ? getErrorMessage("SYS_002_0020", "en", { error: data.error })
                : getErrorMessage("SYS_002_0021")
            );
          }
        } else {
          let data = null;
          try {
            data = await response.json();
          } catch {
            data = null;
          }
          const serverError =
            typeof data?.error === "string"
              ? data.error
              : data?.error?.message || data?.message || null;
          setSystemReady(false);
          setSystemError(
            serverError
              ? getErrorMessage("SYS_002_0020", "en", { error: serverError })
              : getErrorMessage("SYS_002_0019", "en", { status: response.status })
          );
        }
      } catch (err) {
        if (err?.name === "AbortError") {
          return;
        }
        if (cancelled) return;
        markProbeFailure();
        setSystemReady(false);
        setSystemError(err.name === "AbortError" ? getErrorMessage("SYS_002_0008") : getErrorMessage("SYS_002_0001"));
      } finally {
        healthAbortRef.current = null;
        if (!cancelled) setSystemChecking(false);
      }
    };

    checkHealth();
    const interval = setInterval(checkHealth, runtimeConfig.healthCheckIntervalMs);
    return () => {
      cancelled = true;
      if (healthAbortRef.current) {
        healthAbortRef.current.abort();
        healthAbortRef.current = null;
      }
      clearInterval(interval);
    };
  }, [retryTrigger, markApiReachable, markProbeFailure]);

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
