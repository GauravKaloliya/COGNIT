import React, { useState, useEffect, useRef, useCallback } from "react";
import { endpoints } from "../utils/api.js";
import { getErrorMessage } from "../utils/errorRegistry.js";
import { uiText } from "../utils/uiText.js";
import { runtimeConfig } from "../config/runtime";
import PanelState from "../components/PanelState.jsx";
import PageSkeleton from "../components/PageSkeleton.jsx";
import { useNavigationBlocker } from "../hooks/useNavigationBlocker";

const VERIFICATION_REASON_CODES = {
  unrecognized_app: 'FRAUD_001_0003',
  invalid_banking_name: 'FRAUD_001_0004',
  invalid_amount: 'FRAUD_002_0003',
  time_out_of_range: 'FRAUD_001_0006',
  invalid_datetime_format_gpay: 'FRAUD_001_0007',
  invalid_datetime_format_paytm: 'FRAUD_001_0007',
  invalid_datetime_format_bhim: 'FRAUD_001_0007',
  missing_paid_to_cognit: 'FRAUD_002_0005',
  missing_paytm_label: 'FRAUD_002_0005',
  missing_bhim_label: 'FRAUD_002_0005',
  ocr_unavailable: 'SYS_001_0004',
  missing_paid_bhim: 'FRAUD_002_0005',
  ocr_signature_replay_self: 'FRAUD_003_0004',
  ocr_signature_replay_other: 'FRAUD_003_0001',
  max_attempts_exceeded: 'PAY_001_0008',
};
const MAX_UPLOAD_MB = runtimeConfig.paymentUploadMaxMb;
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
const PAYMENT_STATE_KEY = "payment_link_state_v1";
const PAYMENT_STATE_SCHEMA_VERSION = runtimeConfig.paymentStateSchemaVersion;
const PAYMENT_STATE_TTL_MS = runtimeConfig.paymentStateTtlMs;
const MIN_SCREENSHOT_WIDTH = runtimeConfig.minScreenshotWidth;
const MIN_SCREENSHOT_HEIGHT = runtimeConfig.minScreenshotHeight;
const MIN_LAPLACIAN_VARIANCE = runtimeConfig.minLaplacianVariance;

export default function PaymentLinkPage({ 
  onNext, 
  onBack,
  publicId
}) {
  const [paymentData, setPaymentData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState("pending");
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadPreviewUrl, setUploadPreviewUrl] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState(null);
  const [retryInSeconds, setRetryInSeconds] = useState(0);
  const [failureReasons, setFailureReasons] = useState([]);
  const fileInputRef = useRef(null);
  const opVersionRef = useRef(0);
  const isMountedRef = useRef(true);
  const statusAbortRef = useRef(null);
  const createAbortRef = useRef(null);
  const verifyAbortRef = useRef(null);
  const qrAbortRef = useRef(null);

  // Timer state
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [timerProgress, setTimerProgress] = useState(100);
  const timerIntervalRef = useRef(null);
  const timerTotalMsRef = useRef(runtimeConfig.paymentTimerDurationMs);

  const detectMobileClient = useCallback(() => {
    if (typeof window === "undefined") return false;
    const ua = navigator.userAgent || "";
    const byUa = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
    const byViewport = window.matchMedia("(max-width: 768px)").matches;
    const byTouch = window.matchMedia("(pointer: coarse)").matches;
    return byUa || (byViewport && byTouch);
  }, []);
  const [isMobile, setIsMobile] = useState(detectMobileClient);
  const isCriticalAction = verifying || isLoading;
  const retryBlocked = retryInSeconds > 0;
  const retryButtonLabel = retryBlocked
    ? uiText("payment.tryAgainIn", { seconds: retryInSeconds })
    : "Retry";

  const beginOperation = useCallback(() => {
    opVersionRef.current += 1;
    return opVersionRef.current;
  }, []);

  const isOperationCurrent = useCallback((operationId) => {
    return isMountedRef.current && opVersionRef.current === operationId;
  }, []);

  const showRetryHintError = useCallback((message) => {
    setError(message);
    setRetryInSeconds(runtimeConfig.paymentRetrySeconds);
  }, []);

  const getVerificationErrorMessage = useCallback((reasons = []) => {
    if (!reasons.length) return "";
    return reasons
      .map((reason) => {
        const errorCode = VERIFICATION_REASON_CODES[reason];
        return errorCode ? getErrorMessage(errorCode) : reason;
      })
      .join('. ');
  }, []);

  const getPaymentRecoverySteps = useCallback((reasons = [], err = null) => {
    const steps = [];
    const reasonSet = new Set(Array.isArray(reasons) ? reasons : []);
    const code = err?.code || "";

    if (reasonSet.has("missing_paid_to_cognit") || reasonSet.has("invalid_banking_name")) {
      steps.push("Use Google Pay, Paytm, or BHIM, and ensure the recipient shows COGNIT.");
    }
    if (reasonSet.has("invalid_amount")) {
      steps.push("Pay exactly ₹1 and upload the success screenshot.");
    }
    if (reasonSet.has("time_out_of_range")) {
      steps.push("Upload the screenshot immediately after payment, within the active timer.");
    }
    if (reasonSet.has("ocr_unavailable") || reasonSet.has("invalid_datetime_format_gpay") || reasonSet.has("invalid_datetime_format_paytm") || reasonSet.has("invalid_datetime_format_bhim")) {
      steps.push("Upload a clearer screenshot with time and success status fully visible.");
    }
    if (code === "DUP_003_0001" || code === "FRAUD_003_0001") {
      steps.push("This screenshot was already used. Complete a fresh ₹1 payment and upload a new screenshot.");
    }
    if (code === "FRAUD_003_0004") {
      steps.push("You already used this screenshot. Do a fresh payment and upload a new screenshot.");
    }
    if (code === "FRAUD_003_0002") {
      steps.push("Previously rejected screenshots cannot be reused. Upload a new successful payment screenshot.");
    }
    if (steps.length === 0) {
      steps.push("Retry with a fresh screenshot that clearly shows app name, amount ₹1, recipient, and success status.");
      steps.push("If it still fails, tap Retry to create a new payment session.");
    }
    return steps;
  }, []);

  const calculateBlurVariance = (image) => {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return 999;

    const maxDim = 320;
    const scale = Math.min(1, maxDim / Math.max(image.width, image.height));
    const w = Math.max(32, Math.floor(image.width * scale));
    const h = Math.max(32, Math.floor(image.height * scale));
    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(image, 0, 0, w, h);

    const { data } = ctx.getImageData(0, 0, w, h);
    const gray = new Float32Array(w * h);
    for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
      gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }

    const lap = [];
    for (let y = 1; y < h - 1; y += 1) {
      for (let x = 1; x < w - 1; x += 1) {
        const c = gray[y * w + x] * -4;
        const n = gray[(y - 1) * w + x];
        const s = gray[(y + 1) * w + x];
        const e = gray[y * w + (x + 1)];
        const west = gray[y * w + (x - 1)];
        lap.push(c + n + s + e + west);
      }
    }

    if (!lap.length) return 0;
    const mean = lap.reduce((a, b) => a + b, 0) / lap.length;
    const variance = lap.reduce((a, b) => a + (b - mean) ** 2, 0) / lap.length;
    return variance;
  };

  const validateScreenshotQuality = (file) =>
    new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const width = img.naturalWidth || img.width;
        const height = img.naturalHeight || img.height;
        const blurVariance = calculateBlurVariance(img);
        URL.revokeObjectURL(url);

        if (width < MIN_SCREENSHOT_WIDTH || height < MIN_SCREENSHOT_HEIGHT) {
          resolve({
            ok: false,
            message: `Screenshot resolution is too low (${width}x${height}). Minimum is ${MIN_SCREENSHOT_WIDTH}x${MIN_SCREENSHOT_HEIGHT}.`
          });
          return;
        }
        if (blurVariance < MIN_LAPLACIAN_VARIANCE) {
          resolve({
            ok: false,
            message: "Screenshot appears blurry. Please upload a clearer screenshot."
          });
          return;
        }
        resolve({ ok: true, width, height, blurVariance });
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve({ ok: false, message: "Unable to read screenshot. Please upload a valid image." });
      };
      img.src = url;
    });

  const savePaymentViewState = useCallback((state) => {
    try {
      const now = Date.now();
      sessionStorage.setItem(PAYMENT_STATE_KEY, JSON.stringify({
        __schema_version: PAYMENT_STATE_SCHEMA_VERSION,
        saved_at: now,
        expires_at: now + PAYMENT_STATE_TTL_MS,
        data: state
      }));
    } catch {
      // Ignore storage failures
    }
  }, []);

  const clearPaymentViewState = useCallback(() => {
    try {
      sessionStorage.removeItem(PAYMENT_STATE_KEY);
    } catch {
      // Ignore storage failures
    }
  }, []);

  const loadPaymentViewState = useCallback(() => {
    try {
      const raw = sessionStorage.getItem(PAYMENT_STATE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (
        !parsed ||
        parsed.__schema_version !== PAYMENT_STATE_SCHEMA_VERSION ||
        typeof parsed.expires_at !== "number"
      ) {
        return null;
      }
      if (Date.now() > parsed.expires_at) {
        sessionStorage.removeItem(PAYMENT_STATE_KEY);
        return null;
      }
      const data = parsed.data;
      if (!data || data.publicId !== publicId) return null;
      return data;
    } catch {
      return null;
    }
  }, [publicId]);

  // Timer state persistence helpers
  const saveTimerState = useCallback((expiresAt) => {
    try {
      const now = Date.now();
      sessionStorage.setItem("payment_timer_expires_at", JSON.stringify({
        __schema_version: PAYMENT_STATE_SCHEMA_VERSION,
        saved_at: now,
        expires_at: now + PAYMENT_STATE_TTL_MS,
        data: expiresAt
      }));
    } catch {
      // Ignore storage failures
    }
  }, []);

  const clearTimerState = useCallback(() => {
    sessionStorage.removeItem("payment_timer_expires_at");
  }, []);

  const getTimerState = useCallback(() => {
    try {
      const raw = sessionStorage.getItem("payment_timer_expires_at");
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (
        !parsed ||
        parsed.__schema_version !== PAYMENT_STATE_SCHEMA_VERSION ||
        typeof parsed.expires_at !== "number"
      ) {
        return null;
      }
      if (Date.now() > parsed.expires_at) {
        sessionStorage.removeItem("payment_timer_expires_at");
        return null;
      }
      return typeof parsed.data === "string" ? parsed.data : null;
    } catch {
      return null;
    }
  }, []);

  const stopTimer = useCallback((clearPersisted = false) => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    if (clearPersisted) {
      clearTimerState();
    }
  }, [clearTimerState]);

  const getServerRemainingMs = useCallback((payload) => {
    const seconds = Number(payload?.time_remaining_seconds);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.max(0, Math.floor(seconds * 1000));
    }
    const expiresAt = payload?.expires_at;
    if (expiresAt) {
      const diff = new Date(expiresAt).getTime() - Date.now();
      return Math.max(0, diff);
    }
    return 0;
  }, []);

  // Calculate timer values based on expiry
  const calculateTimerValues = useCallback((expiresAt) => {
    const now = new Date().getTime();
    const expiry = new Date(expiresAt).getTime();
    const totalDuration = Math.max(1000, timerTotalMsRef.current || 1000);
    const remaining = Math.max(0, expiry - now);
    const progress = Math.max(0, (remaining / totalDuration) * 100);
    return { remaining, progress };
  }, []);

  // Format time remaining into MM:SS
  const formatTime = (ms) => {
    const totalSeconds = Math.ceil(ms / runtimeConfig.msPerSecond);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  // Get timer color based on progress
  const getTimerColor = () => {
    if (timerProgress > 60) return '#27ae60';
    if (timerProgress > 30) return '#f39c12';
    return '#e74c3c';
  };

  // Get border animation style for UPI button
  const getButtonStyle = () => {
    const color = getTimerColor();
    return {
      border: `3px solid ${color}`,
      boxShadow: `0 0 10px ${color}40, 0 0 20px ${color}20`,
      animation: timerProgress <= 15 ? 'timer-pulse 1s ease-in-out infinite' : 'none',
    };
  };

  // Get QR code container style with animated border and glow
  const getQrContainerStyle = () => {
    const color = getTimerColor();
    const progressAngle = Math.max(0, Math.min(360, (timerProgress / 100) * 360));
    return {
      borderRadius: '16px',
      background: 'var(--panel)',
      width: '100%',
      position: 'relative',
      backgroundImage: `linear-gradient(var(--panel), var(--panel)), conic-gradient(from -90deg, ${color} 0deg ${progressAngle}deg, var(--border-light) ${progressAngle}deg 360deg)`,
      backgroundOrigin: 'border-box',
      backgroundClip: 'padding-box, border-box',
      border: '3px solid transparent',
      boxShadow: `0 0 20px ${color}30, 0 4px 12px rgba(0,0,0,0.1)`,
      transition: 'box-shadow 0.5s ease, background 0.5s ease',
      animation: timerProgress <= 30 ? `qr-glow 1.5s ease-in-out infinite${timerProgress <= 15 ? ', timer-pulse 1s ease-in-out infinite' : ''}` : 'none',
      overflow: 'hidden',
    };
  };

  // Handle payment expiry
  const handleExpiry = useCallback(() => {
    setPaymentStatus("expired");
    showRetryHintError(getErrorMessage('PAY_001_0001'));
    sessionStorage.removeItem("payment_id");
    stopTimer(true);
    clearPaymentViewState();
  }, [clearPaymentViewState, showRetryHintError, stopTimer]);

  // Start the countdown timer
  const startTimer = useCallback((expiresAt) => {
    stopTimer();

    saveTimerState(expiresAt);

    const updateTimer = () => {
      const { remaining, progress } = calculateTimerValues(expiresAt);
      setTimeRemaining(remaining);
      setTimerProgress(progress);

      if (remaining <= 0) {
        clearInterval(timerIntervalRef.current);
        handleExpiry();
      }
    };

    updateTimer();
    timerIntervalRef.current = setInterval(updateTimer, runtimeConfig.paymentTimerTickMs);
  }, [calculateTimerValues, saveTimerState, handleExpiry, stopTimer]);

  const resumeTimerFromCurrentPayment = useCallback(() => {
    const expiresAt = paymentData?.expires_at;
    if (!expiresAt) return;
    const { remaining } = calculateTimerValues(expiresAt);
    if (remaining > 0) {
      startTimer(expiresAt);
      return;
    }
    handleExpiry();
  }, [paymentData, calculateTimerValues, startTimer, handleExpiry]);

  const fetchPaymentQr = useCallback(async (paymentId, operationId) => {
    if (!paymentId) return;
    try {
      if (qrAbortRef.current) qrAbortRef.current.abort();
      const controller = new AbortController();
      qrAbortRef.current = controller;
      const qrData = await endpoints.getPaymentQr(paymentId, { signal: controller.signal });
      if (!isOperationCurrent(operationId)) return;
      const qrBase64 = qrData?.qr_base64;
      if (!qrBase64) return;
      setPaymentData((prev) => {
        if (!prev || prev.payment_id !== paymentId) return prev;
        return { ...prev, qr_base64: qrBase64 };
      });
    } catch (err) {
      if (err?.code !== "REQ_ABORTED") {
        // Keep UI functional via upi_link even when QR fetch fails.
      }
    } finally {
      qrAbortRef.current = null;
    }
  }, [isOperationCurrent]);

  const createPayment = useCallback(async () => {
    const operationId = beginOperation();

    if (!publicId) {
      setError(getErrorMessage('SYS_002_0010'));
      return;
    }

    setIsLoading(true);
    setError(null);
    setRetryInSeconds(0);

    try {
      if (createAbortRef.current) createAbortRef.current.abort();
      const controller = new AbortController();
      createAbortRef.current = controller;
      const data = await endpoints.createPayment(publicId, 1, { signal: controller.signal });
      if (!isOperationCurrent(operationId)) return;
      sessionStorage.setItem("payment_id", data.payment_id);

      const expiresAt = new Date(data.expires_at);
      const now = new Date();
      if (expiresAt <= now) {
        throw new Error(getErrorMessage('PAY_001_0001'));
      }

      const serverRemainingMs = getServerRemainingMs(data);
      timerTotalMsRef.current = Math.max(
        1000,
        serverRemainingMs || Math.max(0, expiresAt.getTime() - now.getTime())
      );
      setPaymentData(data);
      startTimer(data.expires_at);
      savePaymentViewState({
        publicId,
        paymentData: data,
        paymentStatus: "pending",
        failureReasons: [],
        error: null
      });
      if (!isMobile && !data?.qr_base64) {
        fetchPaymentQr(data.payment_id, operationId);
      }
    } catch (err) {
      if (err?.code === "REQ_ABORTED") {
        return;
      }
      if (!isOperationCurrent(operationId)) return;
      const errorMessage = err.code
        ? (err.message || getErrorMessage(err.code))
        : err.message || getErrorMessage('SYS_002_0009');
      showRetryHintError(errorMessage);
      sessionStorage.removeItem("payment_id");
      savePaymentViewState({
        publicId,
        paymentData: null,
        paymentStatus: "failed",
        failureReasons: [],
        error: errorMessage
      });
    } finally {
      createAbortRef.current = null;
      if (isOperationCurrent(operationId)) {
        setIsLoading(false);
      }
    }
  }, [beginOperation, fetchPaymentQr, getServerRemainingMs, isMobile, isOperationCurrent, publicId, savePaymentViewState, showRetryHintError, startTimer]);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      opVersionRef.current += 1;
      if (statusAbortRef.current) statusAbortRef.current.abort();
      if (createAbortRef.current) createAbortRef.current.abort();
      if (verifyAbortRef.current) verifyAbortRef.current.abort();
      if (qrAbortRef.current) qrAbortRef.current.abort();
    };
  }, []);

  useEffect(() => {
    const updateMobileState = () => {
      setIsMobile(detectMobileClient());
    };
    updateMobileState();
    window.addEventListener("resize", updateMobileState);
    window.addEventListener("orientationchange", updateMobileState);
    return () => {
      window.removeEventListener("resize", updateMobileState);
      window.removeEventListener("orientationchange", updateMobileState);
    };
  }, [detectMobileClient]);

  useEffect(() => {
    document.title = "Payment - C.O.G.N.I.T.";
    let cancelled = false;

    const initialize = async () => {
      const restored = loadPaymentViewState();
      const restoredPaymentData = restored?.paymentData;
      const restoredStatus = restored?.paymentStatus || "pending";

      if (restoredPaymentData?.payment_id && restoredPaymentData?.expires_at) {
        try {
          if (statusAbortRef.current) statusAbortRef.current.abort();
          const statusController = new AbortController();
          statusAbortRef.current = statusController;
          const statusData = await endpoints.getPaymentStatus(restoredPaymentData.payment_id, { signal: statusController.signal });
          const serverStatus = statusData?.status;

          if (serverStatus === "success") {
            clearPaymentViewState();
            if (!cancelled) onNext?.({ skipVerification: true });
            return;
          }

          if (serverStatus === "expired") {
            if (!cancelled) handleExpiry();
            return;
          }

          if (serverStatus === "rejected_fraud") {
            if (!cancelled) {
              const reasons = statusData?.verification_details?.failure_reasons || restored?.failureReasons || [];
              const specificError = getVerificationErrorMessage(reasons);
              setPaymentData(restoredPaymentData);
              setPaymentStatus("rejected_fraud");
              setFailureReasons(reasons);
              setError(specificError || getErrorMessage('FRAUD_002_0009'));
            }
            return;
          }

          if (serverStatus === "pending" || serverStatus === "processing") {
            const mergedPaymentData = {
              ...restoredPaymentData,
              expires_at: statusData?.expires_at || restoredPaymentData.expires_at,
              time_remaining_seconds: statusData?.time_remaining_seconds ?? restoredPaymentData?.time_remaining_seconds,
              payment_token: statusData?.payment_token || restoredPaymentData?.payment_token || "",
            };
            const serverRemainingMs = getServerRemainingMs(statusData || mergedPaymentData);
            timerTotalMsRef.current = Math.max(1000, serverRemainingMs || timerTotalMsRef.current);
            const { remaining, progress } = calculateTimerValues(mergedPaymentData.expires_at);
            if (remaining > 0 && restoredStatus !== "success") {
              if (cancelled) return;
              setPaymentData(mergedPaymentData);
              setPaymentStatus(restoredStatus);
              setFailureReasons(Array.isArray(restored?.failureReasons) ? restored.failureReasons : []);
              setError(restored?.error || null);
              setTimeRemaining(remaining);
              setTimerProgress(progress);
              startTimer(mergedPaymentData.expires_at);
              if (!isMobile && !mergedPaymentData?.qr_base64) {
                fetchPaymentQr(mergedPaymentData.payment_id, opVersionRef.current);
              }
              return;
            }
          }
        } catch {
          // If status check fails, fall through and create a new payment.
        } finally {
          statusAbortRef.current = null;
        }
      }

      if (!cancelled) {
        await createPayment();
      }
    };

    initialize();
    return () => {
      cancelled = true;
      stopTimer();
    };
  }, [calculateTimerValues, clearPaymentViewState, createPayment, fetchPaymentQr, getServerRemainingMs, getVerificationErrorMessage, handleExpiry, isMobile, loadPaymentViewState, onNext, startTimer, stopTimer]);

  // Restore timer state from sessionStorage on page refresh
  useEffect(() => {
    if (!paymentData || timerIntervalRef.current) return;

    const expiresAt = getTimerState();
    if (expiresAt) {
      const { remaining } = calculateTimerValues(expiresAt);
      if (remaining > 0) {
        startTimer(expiresAt);
      } else {
        clearTimerState();
        handleExpiry();
      }
    }

    return () => {
      stopTimer();
    };
  }, [paymentData, getTimerState, clearTimerState, calculateTimerValues, startTimer, handleExpiry, stopTimer]);

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (!file.type.startsWith('image/')) {
        showRetryHintError(getErrorMessage('VAL_003_0004'));
        return;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        const actualMb = (file.size / (1024 * 1024)).toFixed(2);
        showRetryHintError(`File size is ${actualMb}MB. Max allowed is ${MAX_UPLOAD_MB}MB.`);
        return;
      }
      if (uploadPreviewUrl) {
        URL.revokeObjectURL(uploadPreviewUrl);
      }
      setUploadFile(file);
      setUploadPreviewUrl(URL.createObjectURL(file));
      setError(null);
      setRetryInSeconds(0);
    }
  };

  const clearSelectedFile = () => {
    if (uploadPreviewUrl) {
      URL.revokeObjectURL(uploadPreviewUrl);
    }
    setUploadFile(null);
    setUploadPreviewUrl("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const calculateSha256 = async (file) => {
    const arrayBuffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  };

  const fileToBase64 = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result);
      reader.onerror = (error) => reject(error);
    });
  };

  const restartPayment = async () => {
    opVersionRef.current += 1;
    if (statusAbortRef.current) statusAbortRef.current.abort();
    if (createAbortRef.current) createAbortRef.current.abort();
    if (verifyAbortRef.current) verifyAbortRef.current.abort();
    if (qrAbortRef.current) qrAbortRef.current.abort();
    stopTimer(true);
    sessionStorage.removeItem("payment_id");
    sessionStorage.removeItem("payment_timer_expires_at");
    clearPaymentViewState();
    setPaymentData(null);
    setPaymentStatus("pending");
    setUploadFile(null);
    if (uploadPreviewUrl) {
      URL.revokeObjectURL(uploadPreviewUrl);
      setUploadPreviewUrl("");
    }
    setFailureReasons([]);
    setError(null);
    setRetryInSeconds(0);
    await createPayment();
  };

  const handleUploadAndFinalize = async () => {
    const operationId = beginOperation();

    if (!uploadFile) {
      showRetryHintError(getErrorMessage('VAL_003_0006'));
      return;
    }

    if (!paymentData?.payment_id) {
      showRetryHintError(getErrorMessage('SYS_002_0011'));
      return;
    }

    // Pause timer while verification is running; keep persisted expiry to resume on errors.
    stopTimer();
    setVerifying(true);
    setError(null);
    setRetryInSeconds(0);

    try {
      // Server-authoritative pre-check before upload/verify.
      if (statusAbortRef.current) statusAbortRef.current.abort();
      const precheckController = new AbortController();
      statusAbortRef.current = precheckController;
      const precheckStatus = await endpoints.getPaymentStatus(paymentData.payment_id, { signal: precheckController.signal });
      if (!isOperationCurrent(operationId)) return;

      if (precheckStatus.status === "expired" || precheckStatus.is_expired) {
        handleExpiry();
        return;
      }
      if (precheckStatus.status === "success") {
        setPaymentStatus("success");
        sessionStorage.removeItem("payment_id");
        clearTimerState();
        clearPaymentViewState();
        onNext?.({ skipVerification: true });
        return;
      }
      if (precheckStatus.status === "rejected_fraud") {
        const reasons = precheckStatus.verification_details?.failure_reasons || [];
        const specificError = getVerificationErrorMessage(reasons);
        setPaymentStatus("rejected_fraud");
        setFailureReasons(reasons);
        showRetryHintError(specificError || getErrorMessage('FRAUD_002_0009'));
        savePaymentViewState({
          publicId,
          paymentData,
          paymentStatus: "rejected_fraud",
          failureReasons: reasons,
          error: specificError || getErrorMessage('FRAUD_002_0009')
        });
        return;
      }
      if (precheckStatus.status !== "pending" && precheckStatus.status !== "processing") {
        showRetryHintError(getErrorMessage('PAY_001_0002'));
        resumeTimerFromCurrentPayment();
        return;
      }
      const serverRemainingMs = getServerRemainingMs(precheckStatus);
      if (serverRemainingMs > 0) {
        timerTotalMsRef.current = Math.max(1000, serverRemainingMs);
      }
      if (precheckStatus.expires_at) {
        setPaymentData((prev) => prev
          ? {
              ...prev,
              expires_at: precheckStatus.expires_at,
              time_remaining_seconds: precheckStatus.time_remaining_seconds ?? prev.time_remaining_seconds,
              payment_token: precheckStatus.payment_token || prev.payment_token || "",
            }
          : prev);
      }

      const qualityCheck = await validateScreenshotQuality(uploadFile);
      if (!isOperationCurrent(operationId)) return;
      if (!qualityCheck.ok) {
        showRetryHintError(qualityCheck.message || getErrorMessage('VAL_003_0004'));
        resumeTimerFromCurrentPayment();
        setVerifying(false);
        return;
      }

      // Extract file extension from uploaded file
      const fileExtension = uploadFile.name.split('.').pop().toLowerCase();
      const sha256 = await calculateSha256(uploadFile);
      if (!isOperationCurrent(operationId)) return;

      const paymentWriteToken = precheckStatus.payment_token || paymentData.payment_token || "";
      if (!paymentWriteToken) {
        showRetryHintError(getErrorMessage('AUTH_002_0002'));
        resumeTimerFromCurrentPayment();
        return;
      }

      // Step 1: Convert file to base64 and verify. Backend uploads to S3 only on success.
      const imageBase64 = await fileToBase64(uploadFile);
      if (!isOperationCurrent(operationId)) return;

      // Step 2: Trigger verification with inline image payload
      if (verifyAbortRef.current) verifyAbortRef.current.abort();
      const verifyController = new AbortController();
      verifyAbortRef.current = verifyController;
      const verifyData = await endpoints.verifyUpload(
        paymentData.payment_id,
        imageBase64,
        fileExtension,
        sha256,
        {
          mime_type: uploadFile.type || "",
          file_size: uploadFile.size || 0,
          original_filename: uploadFile.name || "",
        },
        {
          signal: verifyController.signal,
          headers: {
            Authorization: `Bearer ${paymentWriteToken}`,
          },
        }
      );
      if (!isOperationCurrent(operationId)) return;

      // Check verification result
      const verification = verifyData.verification;

      if (verification?.verified && verification.status === "rejected_fraud") {
        setPaymentStatus("rejected_fraud");
        setVerifying(false);
        const reasons = verification.failure_reasons || [];
        setFailureReasons(reasons);
        const specificError = getVerificationErrorMessage(reasons);
        showRetryHintError(specificError || getErrorMessage('FRAUD_002_0009'));
        savePaymentViewState({
          publicId,
          paymentData,
          paymentStatus: "rejected_fraud",
          failureReasons: reasons,
          error: specificError || getErrorMessage('FRAUD_002_0009')
        });
        return;
      }

      if (verification?.verified && verification.status === "success") {
        setPaymentStatus("success");
        sessionStorage.removeItem("payment_id");
        clearTimerState();
        clearPaymentViewState();
        onNext?.({ skipVerification: true });
        return;
      }

      // Fall back to polling status endpoint for async processing
      if (statusAbortRef.current) statusAbortRef.current.abort();
      const statusController = new AbortController();
      statusAbortRef.current = statusController;
      const statusData = await endpoints.getPaymentStatus(paymentData.payment_id, { signal: statusController.signal });
      if (!isOperationCurrent(operationId)) return;

      if (statusData.status === "rejected_fraud") {
        setPaymentStatus("rejected_fraud");
        setVerifying(false);
        const reasons = statusData.verification_details?.failure_reasons || [];
        setFailureReasons(reasons);
        const specificError = getVerificationErrorMessage(reasons);
        showRetryHintError(specificError || getErrorMessage('FRAUD_002_0009'));
        savePaymentViewState({
          publicId,
          paymentData,
          paymentStatus: "rejected_fraud",
          failureReasons: reasons,
          error: specificError || getErrorMessage('FRAUD_002_0009')
        });
        return;
      }

      if (statusData.status === "expired") {
        handleExpiry();
        return;
      }

      if (statusData.status === "success") {
        setPaymentStatus("success");
        sessionStorage.removeItem("payment_id");
        clearTimerState();
        clearPaymentViewState();
        onNext?.({ skipVerification: true });
        return;
      }

      if (verification?.status === "error") {
        setVerifying(false);
        showRetryHintError(getErrorMessage('SYS_002_0012'));
        resumeTimerFromCurrentPayment();
        return;
      }

      setVerifying(false);
      showRetryHintError(getErrorMessage('SYS_002_0013'));
      resumeTimerFromCurrentPayment();
    } catch (err) {
      if (err?.code === "REQ_ABORTED") {
        return;
      }
      if (!isOperationCurrent(operationId)) return;
      // Handle specific error codes with better messaging
      if (err.code === 'PAY_001_0001' || err.code === 'ERR_PAYMENT_EXPIRED') {
        handleExpiry();
        return;
      }
      if (err.code === 'PAY_001_0008') {
        showRetryHintError(err.message || getErrorMessage('PAY_001_0008'));
        setPaymentStatus("failed");
        return;
      }

      if (err.code === "VAL_003_0005" || err.status === 413) {
        const actualMb = (uploadFile?.size || 0) / (1024 * 1024);
        const sizeLabel = Number.isFinite(actualMb) ? actualMb.toFixed(2) : "unknown";
        showRetryHintError(`File size is ${sizeLabel}MB. Max allowed is ${MAX_UPLOAD_MB}MB.`);
      } else if (err.code) {
        showRetryHintError(err.message || getErrorMessage(err.code));
      } else if (err.message && err.message.toLowerCase().includes('timeout')) {
        showRetryHintError(getErrorMessage('SYS_002_0008'));
      } else if (err.message && err.message.toLowerCase().includes('fetch')) {
        showRetryHintError(getErrorMessage('SYS_002_0007'));
      } else {
        showRetryHintError(getErrorMessage('SYS_002_0013'));
      }
      resumeTimerFromCurrentPayment();

    } finally {
      verifyAbortRef.current = null;
      statusAbortRef.current = null;
      if (isOperationCurrent(operationId)) {
        setVerifying(false);
      }
    }
  };

  const handleBackClick = useCallback(() => {
    if (isCriticalAction) return;
    opVersionRef.current += 1;
    if (statusAbortRef.current) statusAbortRef.current.abort();
    if (createAbortRef.current) createAbortRef.current.abort();
    if (verifyAbortRef.current) verifyAbortRef.current.abort();
    onBack?.();
  }, [isCriticalAction, onBack]);

  useEffect(() => {
    savePaymentViewState({
      publicId,
      paymentData,
      paymentStatus,
      failureReasons,
      error
    });
  }, [publicId, paymentData, paymentStatus, failureReasons, error, savePaymentViewState]);

  useNavigationBlocker({
    enabled: isCriticalAction,
    message: "Action in progress. Please wait for completion before leaving this page.",
    onBlocked: (msg) => {
      if (!error) setError(msg);
    },
  });

  useEffect(() => {
    if (retryInSeconds <= 0) return;
    const t = setTimeout(
      () => setRetryInSeconds((prev) => Math.max(0, prev - 1)),
      runtimeConfig.countdownTickMs
    );
    return () => clearTimeout(t);
  }, [retryInSeconds]);

  useEffect(() => {
    return () => {
      if (uploadPreviewUrl) {
        URL.revokeObjectURL(uploadPreviewUrl);
      }
    };
  }, [uploadPreviewUrl]);

  if (isLoading) {
    return (
      <PageSkeleton
        title={uiText("payment.creating")}
        subtitle={uiText("payment.pleaseWait")}
        variant="payment"
      />
    );
  }

  if (error && !paymentData) {
    return (
      <div className="panel payment-panel">
        <div className="page-top-actions">
          {onBack && (
            <button className="ghost back-button" onClick={handleBackClick} disabled={isCriticalAction}>
              ← Back
            </button>
          )}
        </div>
        <PanelState
          variant="error"
          title="Payment panel unavailable"
          message={`${error} You can retry in the same session or create a fresh payment panel.`}
          actionLabel="Reload Payment"
          onAction={createPayment}
        />
        <div className="payment-next-steps">
          <p><strong>Next steps:</strong></p>
          <ul>
            {getPaymentRecoverySteps(failureReasons).map((step, idx) => (
              <li key={`err-step-${idx}`}>{step}</li>
            ))}
          </ul>
        </div>
        <div className="page-actions">
          <button className="primary" onClick={restartPayment} disabled={retryBlocked}>
            {retryButtonLabel}
          </button>
        </div>
      </div>
    );
  }

  if (paymentStatus === "expired") {
    return (
      <div className="panel payment-panel">
        <div className="page-top-actions">
          {onBack && (
            <button className="ghost back-button" onClick={handleBackClick} disabled={isCriticalAction}>
              ← Back
            </button>
          )}
        </div>
        <div className="payment-header">
          <div className="payment-header-emoji" aria-hidden="true">⏰</div>
          <h2 className="payment-title">Payment Expired</h2>
          <p className="payment-subtitle">Your payment session has timed out</p>
        </div>
        <div className="banner warning spaced">
          {error || getErrorMessage('PAY_001_0001')}
        </div>
        <div className="page-actions">
          <button className="primary" onClick={restartPayment} disabled={retryBlocked}>
            {retryButtonLabel}
          </button>
        </div>
      </div>
    );
  }

  if (paymentStatus === "rejected_fraud") {
    return (
      <div className="panel payment-panel">
        <div className="page-top-actions">
          {onBack && (
            <button className="ghost back-button" onClick={handleBackClick} disabled={isCriticalAction}>
              ← Back
            </button>
          )}
        </div>
        <div className="payment-header">
          <div className="payment-header-emoji" aria-hidden="true">❌</div>
          <h2 className="payment-title">Payment Verification Failed</h2>
          <p className="payment-subtitle">We could not verify your payment screenshot</p>
        </div>
        <div className="banner warning spaced">
          {error || getErrorMessage('FRAUD_002_0009')}
        </div>
        {failureReasons.length > 0 && (
          <div className="payment-failure-details">
            <p><strong>Verification issues:</strong></p>
            <ul>
              {failureReasons.map((reason, index) => (
                <li key={index}>{getVerificationErrorMessage([reason])}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="payment-next-steps">
          <p><strong>How to fix:</strong></p>
          <ul>
            {getPaymentRecoverySteps(failureReasons).map((step, idx) => (
              <li key={`fraud-step-${idx}`}>{step}</li>
            ))}
          </ul>
        </div>
        <div className="page-actions">
          <button className="primary" onClick={restartPayment} disabled={retryBlocked}>
            {retryButtonLabel}
          </button>
        </div>
      </div>
    );
  }

  if (!paymentData && paymentStatus === "pending") {
    return (
      <div className="panel payment-panel">
        <div className="page-top-actions">
          {onBack && (
            <button className="ghost back-button" onClick={handleBackClick} disabled={isCriticalAction}>
              ← Back
            </button>
          )}
        </div>
        <div className="status-panel">
          <PanelState
            variant="warning"
            title="Payment session needs refresh"
            message="No active payment data was found. Reload to create a fresh payment session."
            actionLabel="Reload Payment"
            onAction={createPayment}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="panel payment-panel">
      <div className="page-top-actions">
        {onBack && (
          <button className="ghost back-button" onClick={handleBackClick} disabled={isCriticalAction}>
            ← Back
          </button>
        )}
      </div>

      <div className="payment-header">
        <div className="payment-header-emoji" aria-hidden="true">📱</div>
        <h2 className="payment-title">{isMobile ? "Pay with UPI" : "Scan & Verify Payment"}</h2>
        <p className="payment-subtitle">
          {timeRemaining > 0
            ? `Time remaining: ${formatTime(timeRemaining)}`
            : "Complete payment and upload screenshot"}
        </p>
      </div>

      <div className="payment-content">
        {paymentStatus === "pending" && (
          <div className="payment-qr-instructions-grid">
            {paymentData && (
              <section className="payment-card payment-card-qr">
                <h3>
                  <span className="payment-card-emoji" aria-hidden="true">💳</span>
                  {isMobile ? "Pay with UPI" : "Scan QR Code"}
                </h3>

                <div className="payment-qr-container" style={!isMobile ? getQrContainerStyle() : undefined}>
                  {isMobile ? (
                    <a
                      href={paymentData.upi_link}
                      className="payment-upi-button"
                      onClick={(event) => {
                        event.preventDefault();
                        window.location.href = paymentData.upi_link;
                      }}
                      style={getButtonStyle()}
                    >
                      <span>💳</span>
                      <span>Pay ₹1 with UPI</span>
                      <span className="payment-upi-timer">
                        {paymentStatus === "expired" ? 'Expired' : formatTime(timeRemaining)}
                      </span>
                    </a>
                  ) : (
                    <>
                      {paymentData.qr_base64 ? (
                        <img
                          src={`data:image/png;base64,${paymentData.qr_base64}`}
                          alt="Payment QR Code"
                          className="payment-qr-code"
                        />
                      ) : (
                        <div className="payment-qr-code" style={{ display: "grid", placeItems: "center", color: "var(--muted)" }}>
                          Loading QR...
                        </div>
                      )}
                      <p className="payment-note">Scan with any UPI app to pay ₹1</p>
                      <p className="payment-note" style={{ fontWeight: 600, color: getTimerColor() }}>
                        {paymentStatus === "expired" ? 'Expired' : formatTime(timeRemaining)}
                      </p>
                    </>
                  )}
                </div>

                <div className="payment-status-badge pending">
                  <span>⏱️</span>
                  Payment pending — upload screenshot after paying
                </div>
              </section>
            )}

            <section className="payment-card highlight payment-card-instructions">
              <h3>
                <span className="payment-card-emoji" aria-hidden="true">⚠️</span>
                Important Instructions
              </h3>
              <ul className="payment-steps">
                <li>Pay exactly ₹1 using a UPI app</li>
                <li><strong>Use only: Google Pay, Paytm, or BHIM</strong></li>
                <li>Take a screenshot immediately after payment</li>
                <li>Upload the screenshot below to verify</li>
                <li>Payment session expires in {formatTime(timeRemaining)}</li>
              </ul>
            </section>
          </div>
        )}

        {error && (
          <div className="banner warning spaced">
            {error}
          </div>
        )}
        {error && (
          <div className="payment-next-steps">
            <p><strong>Next steps:</strong></p>
            <ul>
              {getPaymentRecoverySteps(failureReasons).map((step, idx) => (
                <li key={`live-step-${idx}`}>{step}</li>
              ))}
            </ul>
          </div>
        )}

        {paymentStatus === "pending" && (
          <section className="payment-card">
            <h3>
              <span className="payment-card-emoji" aria-hidden="true">📤</span>
              Upload Payment Screenshot
            </h3>
            <p>After completing the payment, upload a screenshot from Google Pay, Paytm, or BHIM.</p>
            {verifying && (
              <div className="payment-verifying-text">
                Verifying screenshot and confirming payment...
              </div>
            )}
            <div className={`payment-upload-stack${verifying ? " is-verifying" : ""}`}>
              <div
                className="payment-upload-preview-box"
                onClick={() => {
                  if (!verifying) {
                    fileInputRef.current?.click();
                  }
                }}
                role="button"
                tabIndex={verifying ? -1 : 0}
                aria-disabled={verifying}
                onKeyDown={(event) => {
                  if (verifying) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
              >
                {uploadPreviewUrl ? (
                  <img src={uploadPreviewUrl} alt="Payment screenshot preview" className="payment-upload-preview" />
                ) : (
                  <div className="payment-upload-placeholder">
                    <p>📷</p>
                    <p>Click to upload payment screenshot</p>
                  </div>
                )}
              </div>

              <div className="payment-upload-meta-box">
                <div className="payment-upload-meta-head">
                  <p className="payment-upload-file-name">
                    {uploadFile ? `✅ ${uploadFile.name}` : "No image selected"}
                  </p>
                  <p className="payment-upload-file-meta">
                    {uploadFile
                      ? (
                        <>
                          <span className="payment-upload-meta-line">
                            <strong>Size:</strong> {(uploadFile.size / (1024 * 1024)).toFixed(2)}MB | Max: {MAX_UPLOAD_MB}MB
                          </span>
                          <span className="payment-upload-meta-line">
                            <strong>Type:</strong> {uploadFile.type || "Unknown"}
                          </span>
                        </>
                      )
                      : `Allowed formats: JPG, JPEG, PNG, WEBP | Max: ${MAX_UPLOAD_MB}MB`}
                  </p>
                </div>

                <div className="payment-upload-guidance">
                  <p className="payment-upload-guidance-title">Quick checklist</p>
                  <ul>
                    <li>Payment status is visible</li>
                    <li>Recipient shows COGNIT / Gaurav</li>
                    <li>Amount shows exactly ₹1</li>
                    <li>Date and time are clearly readable</li>
                  </ul>
                </div>

                <div className="payment-upload-verification-note">
                  Verification usually takes a few seconds. Keep this tab open.
                </div>

                <div className="payment-upload-actions">
                  <button
                    className={`ghost${uploadFile ? " danger" : ""}`}
                    type="button"
                    disabled={verifying}
                    onClick={() => {
                      if (uploadFile) {
                        clearSelectedFile();
                        return;
                      }
                      fileInputRef.current?.click();
                    }}
                  >
                    {uploadFile ? "Remove Image" : "Select Image"}
                  </button>
                  <button
                    className="primary"
                    onClick={handleUploadAndFinalize}
                    disabled={!uploadFile || verifying}
                  >
                    {verifying ? "Verifying..." : "Confirm Payment"}
                  </button>
                </div>
              </div>

              <input
                type="file"
                ref={fileInputRef}
                accept="image/*"
                onChange={handleFileChange}
                style={{ display: "none" }}
              />
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
