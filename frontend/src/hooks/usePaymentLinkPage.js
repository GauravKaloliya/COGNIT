import { useCallback, useEffect, useRef, useState } from "react";
import { endpoints } from "../utils/api.js";
import { getErrorMessage } from "../utils/errorRegistry.js";
import { uiText } from "../utils/uiText.js";
import { runtimeConfig } from "../config/runtime";
import { clearPendingFlag, forEachStorageArea, getPendingFlag, makeScopedKey, readExpiringValue, removeStoredKey, setPendingFlag, writeExpiringValue } from "../utils/storage";
import { useNavigationBlocker } from "./useNavigationBlocker";
import { useOnlineStatus } from "./useOnlineStatus";
import { BROWSER_EVENTS } from "../constants/browser";
import { NETWORK_ERROR_HINTS, REQUEST_CODES, REQUEST_HEADERS } from "../constants/request";
import { TOAST_VARIANTS } from "../constants/ui";
import { clearScheduledInterval, clearScheduledTimeout, scheduleInterval, scheduleTimeout } from "../utils/timing";
import {
  PAYMENT_ERROR_CODES,
  PAYMENT_NOTICE_VARIANT,
  PAYMENT_STATE_FIELDS,
  PAYMENT_STATUS,
  PAYMENT_VERIFICATION_REASON_CODES,
} from "../constants/payment";
import { PAYMENT_API_FIELDS } from "../constants/fields";
const MAX_UPLOAD_MB = runtimeConfig.paymentUploadMaxMb;
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
const PAYMENT_STATE_KEY = runtimeConfig.storageKeys.paymentState;
const PAYMENT_TIMER_KEY = runtimeConfig.storageKeys.paymentTimerExpires;
const PAYMENT_ID_KEY = runtimeConfig.storageKeys.paymentId;
const PAYMENT_STATE_SCHEMA_VERSION = runtimeConfig.paymentStateSchemaVersion;
const PAYMENT_STATE_TTL_MS = runtimeConfig.paymentStateTtlMs;
const MIN_SCREENSHOT_WIDTH = runtimeConfig.minScreenshotWidth;
const MIN_SCREENSHOT_HEIGHT = runtimeConfig.minScreenshotHeight;
const MIN_LAPLACIAN_VARIANCE = runtimeConfig.minLaplacianVariance;
const EXPECTED_PAYMENT_AMOUNT = Number(runtimeConfig.paymentAmount);
const PAYMENT_AMOUNT_LABEL = `₹${EXPECTED_PAYMENT_AMOUNT}`;
const PAYMENT_PENDING_CREATE_KEY = runtimeConfig.storageKeys.paymentPendingCreate;
const PAYMENT_PENDING_VERIFY_KEY = runtimeConfig.storageKeys.paymentPendingVerify;

const getPaymentField = (payload, field) => payload?.[field];
const getVerificationDetails = (payload) => payload?.[PAYMENT_API_FIELDS.verificationDetails];
const getFailureReasons = (payload) => getVerificationDetails(payload)?.[PAYMENT_API_FIELDS.failureReasons] || [];

export function usePaymentLinkPage({ 
  onNext, 
  publicId,
  sessionId,
  addToast,
  onParticipantNotFound,
}) {
  const [paymentData, setPaymentData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState(PAYMENT_STATUS.pending);
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadPreviewUrl, setUploadPreviewUrl] = useState("");
  const uploadFileRef = useRef(null);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState(null);
  const [retryInSeconds, setRetryInSeconds] = useState(0);
  const [failureReasons, setFailureReasons] = useState([]);
  const [refreshNotice, setRefreshNotice] = useState("");
  const [refreshNoticeVariant, setRefreshNoticeVariant] = useState(PAYMENT_NOTICE_VARIANT.info);
  const isOnline = useOnlineStatus();
  const refreshNoticeShownRef = useRef(false);
  const fileInputRef = useRef(null);
  const opVersionRef = useRef(0);
  const isMountedRef = useRef(true);
  const statusAbortRef = useRef(null);
  const createAbortRef = useRef(null);
  const createOnceRef = useRef(false);
  const lastInitPublicIdRef = useRef(null);
  const tokenRefreshAttemptedRef = useRef(false);
  const verifyAbortRef = useRef(null);
  const qrAbortRef = useRef(null);

  // Timer state
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [timerProgress, setTimerProgress] = useState(100);
  const timerIntervalRef = useRef(null);
  const timerTotalMsRef = useRef(runtimeConfig.paymentTimerDurationMs);
  const pendingTimerExpiresAtRef = useRef(null);
  const [qrVisible, setQrVisible] = useState(false);

  const paymentScope = String(publicId || "").trim() || "anon";
  const scopedPaymentStateKey = makeScopedKey(PAYMENT_STATE_KEY, paymentScope);
  const scopedPaymentTimerKey = makeScopedKey(PAYMENT_TIMER_KEY, paymentScope);
  const scopedPaymentIdKey = makeScopedKey(PAYMENT_ID_KEY, paymentScope);
  const scopedPendingCreateKey = makeScopedKey(PAYMENT_PENDING_CREATE_KEY, paymentScope);
  const scopedPendingVerifyKey = makeScopedKey(PAYMENT_PENDING_VERIFY_KEY, paymentScope);

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
  const offlineDisabled = !isOnline;
  const retryBlocked = retryInSeconds > 0;
  const retryButtonLabel = retryBlocked
    ? uiText("payment.tryAgainIn", { seconds: retryInSeconds })
    : uiText("survey.retryShort");
  const notifySessionExpired = useCallback(() => {
    if (typeof addToast === "function") {
      addToast(uiText("payment.expiredToast"), TOAST_VARIANTS.warning);
    }
    if (!refreshNoticeShownRef.current) {
      refreshNoticeShownRef.current = true;
      setRefreshNotice(uiText("payment.expiredRefreshNotice"));
      setRefreshNoticeVariant(PAYMENT_NOTICE_VARIANT.warning);
    }
  }, [addToast]);

  const notifySessionRefreshing = useCallback(() => {
    if (refreshNoticeShownRef.current) return;
    setRefreshNotice(uiText("payment.restoringNotice"));
    setRefreshNoticeVariant(PAYMENT_NOTICE_VARIANT.info);
  }, []);

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
        const errorCode = PAYMENT_VERIFICATION_REASON_CODES[reason];
        return errorCode ? getErrorMessage(errorCode) : reason;
      })
      .join('. ');
  }, []);

  const getPaymentRecoverySteps = useCallback((reasons = [], err = null) => {
    const steps = [];
    const reasonSet = new Set(Array.isArray(reasons) ? reasons : []);
    const code = err?.code || "";

    if (reasonSet.has("missing_paid_to_cognit") || reasonSet.has("invalid_banking_name")) {
      steps.push(uiText("payment.recovery.useSupportedApp"));
    }
    if (reasonSet.has("invalid_amount")) {
      steps.push(uiText("payment.recovery.exactAmount", { amount: PAYMENT_AMOUNT_LABEL }));
    }
    if (reasonSet.has("time_out_of_range")) {
      steps.push(uiText("payment.recovery.withinTimer"));
    }
    if (reasonSet.has("ocr_unavailable") || reasonSet.has("invalid_datetime_format_gpay") || reasonSet.has("invalid_datetime_format_paytm") || reasonSet.has("invalid_datetime_format_bhim")) {
      steps.push(uiText("payment.recovery.clearScreenshot"));
    }
    if (code === "DUP_003_0001" || code === PAYMENT_ERROR_CODES.screenshotReusedOther) {
      steps.push(uiText("payment.recovery.reusedOther", { amount: PAYMENT_AMOUNT_LABEL }));
    }
    if (code === PAYMENT_ERROR_CODES.screenshotReusedSelf) {
      steps.push(uiText("payment.recovery.reusedSelf"));
    }
    if (code === PAYMENT_ERROR_CODES.screenshotPreviouslyRejected) {
      steps.push(uiText("payment.recovery.rejectedReuse"));
    }
    if (steps.length === 0) {
      steps.push(uiText("payment.recovery.defaultFresh", { amount: PAYMENT_AMOUNT_LABEL }));
      steps.push(uiText("payment.recovery.defaultRetry"));
    }
    return steps;
  }, []);

  const isPaymentAmountMismatch = useCallback((paymentData) => {
    if (!paymentData) return false;
    if (!Number.isFinite(EXPECTED_PAYMENT_AMOUNT) || EXPECTED_PAYMENT_AMOUNT <= 0) {
      return false;
    }
    const amountValue = Number(paymentData?.amount);
    if (Number.isFinite(amountValue)) {
      return Math.abs(amountValue - EXPECTED_PAYMENT_AMOUNT) > 0.001;
    }
    const link = String(getPaymentField(paymentData, PAYMENT_API_FIELDS.upiLink) || "");
    const match = link.match(/[?&]am=([^&]+)/i);
    if (!match) return false;
    const parsed = Number(decodeURIComponent(match[1]));
    if (!Number.isFinite(parsed)) return false;
    return Math.abs(parsed - EXPECTED_PAYMENT_AMOUNT) > 0.001;
  }, []);

  const calculateBlurVariance = useCallback((image) => {
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
  }, []);

  const validateScreenshotQuality = useCallback(
    (file) =>
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
              message: uiText("payment.resolutionLow", {
                width,
                height,
                minWidth: MIN_SCREENSHOT_WIDTH,
                minHeight: MIN_SCREENSHOT_HEIGHT,
              })
            });
            return;
          }
          if (blurVariance < MIN_LAPLACIAN_VARIANCE) {
            resolve({
              ok: false,
              message: uiText("payment.blurry")
            });
            return;
          }
          resolve({ ok: true, width, height, blurVariance });
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          resolve({ ok: false, message: uiText("payment.invalidImage") });
        };
        img.src = url;
      }),
    [calculateBlurVariance]
  );

  const savePaymentViewState = useCallback((state) => {
    if (!isOnline) return;
    try {
      const safeState = { ...(state || {}) };
      writeExpiringValue(scopedPaymentStateKey, safeState, {
        area: "local",
        schemaVersion: PAYMENT_STATE_SCHEMA_VERSION,
        ttlMs: PAYMENT_STATE_TTL_MS,
      });
      // Clear any legacy/unscoped copies.
      removeStoredKey(PAYMENT_STATE_KEY, "session");
      removeStoredKey(PAYMENT_STATE_KEY, "local");
    } catch {
      // Ignore storage failures
    }
  }, [isOnline, scopedPaymentStateKey]);

  const clearPaymentViewState = useCallback(() => {
    forEachStorageArea((area) => {
      removeStoredKey(PAYMENT_STATE_KEY, area);
      removeStoredKey(scopedPaymentStateKey, area);
    });
    tokenRefreshAttemptedRef.current = false;
  }, [scopedPaymentStateKey]);

  const loadPaymentViewState = useCallback(() => {
    try {
      const readOpts = { schemaVersion: PAYMENT_STATE_SCHEMA_VERSION, ttlMs: PAYMENT_STATE_TTL_MS };
      let data = readExpiringValue(scopedPaymentStateKey, null, { ...readOpts, area: "local" });
      if (!data) {
        const legacy = readExpiringValue(scopedPaymentStateKey, null, { ...readOpts, area: "session" }) ||
          readExpiringValue(PAYMENT_STATE_KEY, null, { ...readOpts, area: "local" }) ||
          readExpiringValue(PAYMENT_STATE_KEY, null, { ...readOpts, area: "session" });
        if (legacy) {
          try {
            writeExpiringValue(scopedPaymentStateKey, legacy, { ...readOpts, area: "local" });
          } catch {
            // Ignore migration failures.
          }
          forEachStorageArea((area) => removeStoredKey(PAYMENT_STATE_KEY, area));
          removeStoredKey(scopedPaymentStateKey, "session");
          data = legacy;
        }
      }
      if (!data || data[PAYMENT_STATE_FIELDS.publicId] !== publicId) return null;
      return data;
    } catch {
      return null;
    }
  }, [publicId, scopedPaymentStateKey]);

  // Timer state persistence helpers
  const saveTimerState = useCallback((expiresAt) => {
    writeExpiringValue(scopedPaymentTimerKey, expiresAt, {
      area: "local",
      schemaVersion: PAYMENT_STATE_SCHEMA_VERSION,
      ttlMs: PAYMENT_STATE_TTL_MS,
    });
    removeStoredKey(PAYMENT_TIMER_KEY, "session");
    removeStoredKey(PAYMENT_TIMER_KEY, "local");
  }, [scopedPaymentTimerKey]);

  const clearTimerState = useCallback(() => {
    forEachStorageArea((area) => {
      removeStoredKey(PAYMENT_TIMER_KEY, area);
      removeStoredKey(scopedPaymentTimerKey, area);
    });
  }, [scopedPaymentTimerKey]);

  const getTimerState = useCallback(() => {
    const readOpts = { schemaVersion: PAYMENT_STATE_SCHEMA_VERSION, ttlMs: PAYMENT_STATE_TTL_MS };
    let value = readExpiringValue(scopedPaymentTimerKey, null, { ...readOpts, area: "local" });
    if (!value) {
      const legacy = readExpiringValue(scopedPaymentTimerKey, null, { ...readOpts, area: "session" }) ||
        readExpiringValue(PAYMENT_TIMER_KEY, null, { ...readOpts, area: "local" }) ||
        readExpiringValue(PAYMENT_TIMER_KEY, null, { ...readOpts, area: "session" });
      if (legacy) {
        try {
          writeExpiringValue(scopedPaymentTimerKey, legacy, { ...readOpts, area: "local" });
        } catch {
          // Ignore migration failures.
        }
        forEachStorageArea((area) => removeStoredKey(PAYMENT_TIMER_KEY, area));
        removeStoredKey(scopedPaymentTimerKey, "session");
        value = legacy;
      }
    }
    return typeof value === "string" ? value : null;
  }, [scopedPaymentTimerKey]);

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
    const seconds = Number(getPaymentField(payload, PAYMENT_API_FIELDS.timeRemainingSeconds));
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.max(0, Math.floor(seconds * 1000));
    }
    const expiresAt = getPaymentField(payload, PAYMENT_API_FIELDS.expiresAt);
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
    setPaymentStatus(PAYMENT_STATUS.expired);
    showRetryHintError(getErrorMessage(PAYMENT_ERROR_CODES.sessionExpired));
    forEachStorageArea((area) => {
      removeStoredKey(PAYMENT_ID_KEY, area);
      removeStoredKey(scopedPaymentIdKey, area);
    });
    stopTimer(true);
    clearPaymentViewState();
  }, [clearPaymentViewState, scopedPaymentIdKey, showRetryHintError, stopTimer]);

  // Start the countdown timer
  const startTimer = useCallback((expiresAt) => {
    stopTimer();

    saveTimerState(expiresAt);

    const updateTimer = () => {
      const { remaining, progress } = calculateTimerValues(expiresAt);
      setTimeRemaining(remaining);
      setTimerProgress(progress);

      if (remaining <= 0) {
        clearScheduledInterval(timerIntervalRef.current);
        handleExpiry();
      }
    };

    updateTimer();
    timerIntervalRef.current = scheduleInterval(updateTimer, runtimeConfig.paymentTimerTickMs);
  }, [calculateTimerValues, saveTimerState, handleExpiry, stopTimer]);

  const requestStartTimer = useCallback((expiresAt) => {
    if (!expiresAt) return;
    if (isMobile || qrVisible) {
      pendingTimerExpiresAtRef.current = null;
      startTimer(expiresAt);
      return;
    }
    pendingTimerExpiresAtRef.current = expiresAt;
    stopTimer();
    setTimeRemaining(0);
    setTimerProgress(100);
  }, [isMobile, qrVisible, startTimer, stopTimer]);

  useEffect(() => {
    if (!qrVisible || !pendingTimerExpiresAtRef.current) return;
    startTimer(pendingTimerExpiresAtRef.current);
    pendingTimerExpiresAtRef.current = null;
  }, [qrVisible, startTimer]);

  const resumeTimerFromCurrentPayment = useCallback(() => {
    const expiresAt = getPaymentField(paymentData, PAYMENT_API_FIELDS.expiresAt);
    if (!expiresAt) return;
    const { remaining } = calculateTimerValues(expiresAt);
    if (remaining > 0) {
      requestStartTimer(expiresAt);
      return;
    }
    handleExpiry();
  }, [paymentData, calculateTimerValues, requestStartTimer, handleExpiry]);

  const fetchPaymentQr = useCallback(async (paymentId, operationId) => {
    if (!paymentId) return;
    try {
      if (qrAbortRef.current) qrAbortRef.current.abort();
      const controller = new AbortController();
      qrAbortRef.current = controller;
      const qrData = await endpoints.getPaymentQr(paymentId, { signal: controller.signal });
      if (!isOperationCurrent(operationId)) return;
      const qrBase64 = getPaymentField(qrData, PAYMENT_API_FIELDS.qrBase64);
      if (!qrBase64) return;
      setPaymentData((prev) => {
        if (!prev || getPaymentField(prev, PAYMENT_API_FIELDS.id) !== paymentId) return prev;
        return { ...prev, [PAYMENT_API_FIELDS.qrBase64]: qrBase64 };
      });
    } catch (err) {
      if (err?.code !== REQUEST_CODES.aborted) {
        // Keep UI functional via the fallback deep link even when QR fetch fails.
      }
    } finally {
      qrAbortRef.current = null;
    }
  }, [isOperationCurrent]);

  const createPayment = useCallback(async () => {
    const operationId = beginOperation();

    if (!publicId) {
      setError(getErrorMessage(PAYMENT_ERROR_CODES.paymentUnavailable));
      return;
    }
    if (!isOnline) {
      setError(uiText("payment.offlineCreate"));
      setPendingFlag(scopedPendingCreateKey);
      return;
    }

    const timeoutMs = Math.max(0, runtimeConfig.paymentCreateTimeoutMs || 0);
    let timedOut = false;
    let timeoutId = null;

    setIsLoading(true);
    setError(null);
    setRetryInSeconds(0);

    try {
      if (createAbortRef.current) createAbortRef.current.abort();
      const controller = new AbortController();
      createAbortRef.current = controller;
      if (timeoutMs > 0) {
        timeoutId = scheduleTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs);
      }
      const data = await endpoints.createPayment(publicId, { signal: controller.signal });
      if (!isOperationCurrent(operationId)) return;
      writeExpiringValue(scopedPaymentIdKey, getPaymentField(data, PAYMENT_API_FIELDS.id), {
        area: "local",
        schemaVersion: PAYMENT_STATE_SCHEMA_VERSION,
        ttlMs: PAYMENT_STATE_TTL_MS,
      });
      removeStoredKey(PAYMENT_ID_KEY, "session");
      removeStoredKey(PAYMENT_ID_KEY, "local");

      const expiresAt = new Date(getPaymentField(data, PAYMENT_API_FIELDS.expiresAt));
      const now = new Date();
      if (expiresAt <= now) {
        throw new Error(getErrorMessage(PAYMENT_ERROR_CODES.sessionExpired));
      }

      const serverRemainingMs = getServerRemainingMs(data);
      timerTotalMsRef.current = Math.max(
        1000,
        serverRemainingMs || Math.max(0, expiresAt.getTime() - now.getTime())
      );
      setPaymentData(data);
      setPaymentStatus(PAYMENT_STATUS.pending);
      setQrVisible(false);
      requestStartTimer(getPaymentField(data, PAYMENT_API_FIELDS.expiresAt));
      savePaymentViewState({
        [PAYMENT_STATE_FIELDS.publicId]: publicId,
        [PAYMENT_STATE_FIELDS.paymentData]: data,
        [PAYMENT_STATE_FIELDS.paymentStatus]: PAYMENT_STATUS.pending,
        [PAYMENT_STATE_FIELDS.failureReasons]: [],
        [PAYMENT_STATE_FIELDS.error]: null,
      });
      if (!isMobile && !getPaymentField(data, PAYMENT_API_FIELDS.qrBase64)) {
        fetchPaymentQr(getPaymentField(data, PAYMENT_API_FIELDS.id), operationId);
      }
    } catch (err) {
      if (err?.code === REQUEST_CODES.aborted && !timedOut) {
        return;
      }
      if (!isOperationCurrent(operationId)) return;
      if (err?.code === "NF_001_0001" || err?.status === 404) {
        onParticipantNotFound?.();
        return;
      }
      const errorMessage = timedOut
        ? uiText("payment.createTimeout")
        : err.code
          ? (err.message || getErrorMessage(err.code))
          : err.message || getErrorMessage(PAYMENT_ERROR_CODES.systemCreate);
      showRetryHintError(errorMessage);
      forEachStorageArea((area) => {
        removeStoredKey(PAYMENT_ID_KEY, area);
        removeStoredKey(scopedPaymentIdKey, area);
      });
      savePaymentViewState({
        [PAYMENT_STATE_FIELDS.publicId]: publicId,
        [PAYMENT_STATE_FIELDS.paymentData]: null,
        [PAYMENT_STATE_FIELDS.paymentStatus]: PAYMENT_STATUS.failed,
        [PAYMENT_STATE_FIELDS.failureReasons]: [],
        [PAYMENT_STATE_FIELDS.error]: errorMessage,
      });
      setPaymentStatus(PAYMENT_STATUS.failed);
    } finally {
      createAbortRef.current = null;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (isOperationCurrent(operationId)) {
        setIsLoading(false);
      }
    }
  }, [beginOperation, fetchPaymentQr, getServerRemainingMs, isMobile, isOnline, isOperationCurrent, onParticipantNotFound, publicId, requestStartTimer, savePaymentViewState, scopedPaymentIdKey, scopedPendingCreateKey, showRetryHintError]);

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
    window.addEventListener(BROWSER_EVENTS.resize, updateMobileState);
    window.addEventListener(BROWSER_EVENTS.orientationChange, updateMobileState);
    return () => {
      window.removeEventListener(BROWSER_EVENTS.resize, updateMobileState);
      window.removeEventListener(BROWSER_EVENTS.orientationChange, updateMobileState);
    };
  }, [detectMobileClient]);

  useEffect(() => {
    if (!isOnline) {
      stopTimer();
      return;
    }
    if (getPaymentField(paymentData, PAYMENT_API_FIELDS.expiresAt)) {
      resumeTimerFromCurrentPayment();
    }
  }, [isOnline, paymentData, resumeTimerFromCurrentPayment, stopTimer]);

  useEffect(() => {
    document.title = uiText("payment.documentTitle");
    let cancelled = false;

    const initialize = async () => {
      if (!publicId) return;
      if (createOnceRef.current && lastInitPublicIdRef.current === publicId) return;
      createOnceRef.current = true;
      lastInitPublicIdRef.current = publicId;
      const restored = loadPaymentViewState();
      const restoredPaymentData = restored?.[PAYMENT_STATE_FIELDS.paymentData];
      const restoredStatus = restored?.[PAYMENT_STATE_FIELDS.paymentStatus] || PAYMENT_STATUS.pending;

      if (getPaymentField(restoredPaymentData, PAYMENT_API_FIELDS.id) && getPaymentField(restoredPaymentData, PAYMENT_API_FIELDS.expiresAt)) {
        if (isPaymentAmountMismatch(restoredPaymentData)) {
          clearPaymentViewState();
          notifySessionExpired();
          if (!cancelled) await createPayment();
          return;
        }
        if (!publicId) {
          return;
        }
        if (statusAbortRef.current) statusAbortRef.current.abort();
        const statusController = new AbortController();
        statusAbortRef.current = statusController;
        if (!getPaymentField(restoredPaymentData, PAYMENT_API_FIELDS.token) && publicId) {
          notifySessionRefreshing();
          try {
            const minted = await endpoints.mintPaymentToken(
              getPaymentField(restoredPaymentData, PAYMENT_API_FIELDS.id),
              publicId,
              sessionId,
              { signal: statusController.signal }
            );
            restoredPaymentData[PAYMENT_API_FIELDS.token] = getPaymentField(minted, PAYMENT_API_FIELDS.token) || "";
            setRefreshNotice("");
          } catch {
            clearPaymentViewState();
            notifySessionExpired();
            await createPayment();
            return;
          }
        }
        if (!getPaymentField(restoredPaymentData, PAYMENT_API_FIELDS.token)) {
          clearPaymentViewState();
          notifySessionExpired();
          await createPayment();
          return;
        }
        try {
          const statusData = await endpoints.getPaymentStatus(
            getPaymentField(restoredPaymentData, PAYMENT_API_FIELDS.id),
            { signal: statusController.signal },
            getPaymentField(restoredPaymentData, PAYMENT_API_FIELDS.token)
          );
          const serverStatus = getPaymentField(statusData, PAYMENT_API_FIELDS.status);

          if (serverStatus === PAYMENT_STATUS.success) {
            clearPaymentViewState();
            if (!cancelled) onNext?.({ skipVerification: true });
            return;
          }

        if (serverStatus === PAYMENT_STATUS.expired) {
          clearPaymentViewState();
          notifySessionExpired();
          if (!cancelled) await createPayment();
          return;
        }

          if (serverStatus === PAYMENT_STATUS.rejectedFraud) {
            if (!cancelled) {
              const reasons = getFailureReasons(statusData) || restored?.[PAYMENT_STATE_FIELDS.failureReasons] || [];
              const specificError = getVerificationErrorMessage(reasons);
              setPaymentData(restoredPaymentData);
              setPaymentStatus(PAYMENT_STATUS.rejectedFraud);
              setFailureReasons(reasons);
              setError(specificError || getErrorMessage(PAYMENT_ERROR_CODES.screenshotRejected));
            }
            return;
          }

          if (serverStatus === PAYMENT_STATUS.pending || serverStatus === PAYMENT_STATUS.processing) {
            const mergedPaymentData = {
              ...restoredPaymentData,
              [PAYMENT_API_FIELDS.expiresAt]: getPaymentField(statusData, PAYMENT_API_FIELDS.expiresAt) || getPaymentField(restoredPaymentData, PAYMENT_API_FIELDS.expiresAt),
              [PAYMENT_API_FIELDS.timeRemainingSeconds]: getPaymentField(statusData, PAYMENT_API_FIELDS.timeRemainingSeconds) ?? getPaymentField(restoredPaymentData, PAYMENT_API_FIELDS.timeRemainingSeconds),
            };
            const serverRemainingMs = getServerRemainingMs(statusData || mergedPaymentData);
            timerTotalMsRef.current = Math.max(1000, serverRemainingMs || timerTotalMsRef.current);
            const { remaining, progress } = calculateTimerValues(getPaymentField(mergedPaymentData, PAYMENT_API_FIELDS.expiresAt));
            if (remaining > 0 && restoredStatus !== PAYMENT_STATUS.success) {
              if (cancelled) return;
              setPaymentData(mergedPaymentData);
              setPaymentStatus(restoredStatus);
              setFailureReasons(Array.isArray(restored?.[PAYMENT_STATE_FIELDS.failureReasons]) ? restored[PAYMENT_STATE_FIELDS.failureReasons] : []);
              setError(restored?.[PAYMENT_STATE_FIELDS.error] || null);
              setTimeRemaining(remaining);
              setTimerProgress(progress);
              requestStartTimer(getPaymentField(mergedPaymentData, PAYMENT_API_FIELDS.expiresAt));
              if (!isMobile && !getPaymentField(mergedPaymentData, PAYMENT_API_FIELDS.qrBase64)) {
                fetchPaymentQr(getPaymentField(mergedPaymentData, PAYMENT_API_FIELDS.id), opVersionRef.current);
              }
              if (refreshNoticeVariant === PAYMENT_NOTICE_VARIANT.info) {
                setRefreshNotice("");
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
  }, [
    calculateTimerValues,
    clearPaymentViewState,
    createPayment,
    fetchPaymentQr,
    getServerRemainingMs,
    getVerificationErrorMessage,
    handleExpiry,
    isMobile,
    isPaymentAmountMismatch,
    loadPaymentViewState,
    notifySessionExpired,
    notifySessionRefreshing,
    onNext,
    refreshNoticeVariant,
    startTimer,
    requestStartTimer,
    stopTimer,
    publicId,
    sessionId,
  ]);

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
      const clearPreviouslySelected = () => {
        if (uploadPreviewUrl) {
          URL.revokeObjectURL(uploadPreviewUrl);
        }
        setUploadFile(null);
        uploadFileRef.current = null;
        setUploadPreviewUrl("");
        setFailureReasons([]);
        setPaymentStatus(PAYMENT_STATUS.pending);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
        if (e?.target) {
          e.target.value = "";
        }
      };
      if (!file.type.startsWith("image/")) {
        clearPreviouslySelected();
        showRetryHintError(getErrorMessage(PAYMENT_ERROR_CODES.invalidImage));
        return;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        const actualMb = (file.size / (1024 * 1024)).toFixed(2);
        clearPreviouslySelected();
        showRetryHintError(uiText("payment.fileTooLarge", { actual: actualMb, max: MAX_UPLOAD_MB }));
        return;
      }
      if (uploadPreviewUrl) {
        URL.revokeObjectURL(uploadPreviewUrl);
      }
      setUploadFile(file);
      uploadFileRef.current = file;
      setUploadPreviewUrl(URL.createObjectURL(file));
      setError(null);
      setFailureReasons([]);
      setPaymentStatus(PAYMENT_STATUS.pending);
      setRetryInSeconds(0);
    }
  };

  const clearSelectedFile = () => {
    if (uploadPreviewUrl) {
      URL.revokeObjectURL(uploadPreviewUrl);
    }
    setUploadFile(null);
    uploadFileRef.current = null;
    setUploadPreviewUrl("");
    setFailureReasons([]);
    setPaymentStatus(PAYMENT_STATUS.pending);
    setError(null);
    setRetryInSeconds(0);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const calculateSha256 = async (file) => {
    const arrayBuffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest("SHA-256", arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((byte) => byte.toString(16).padStart(2, "0")).join("");
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
    if (!isOnline) {
      setError(uiText("payment.offlineRestart"));
      setPendingFlag(scopedPendingCreateKey);
      return;
    }
    opVersionRef.current += 1;
    if (statusAbortRef.current) statusAbortRef.current.abort();
    if (createAbortRef.current) createAbortRef.current.abort();
    if (verifyAbortRef.current) verifyAbortRef.current.abort();
    if (qrAbortRef.current) qrAbortRef.current.abort();
    stopTimer(true);
    forEachStorageArea((area) => {
      removeStoredKey(PAYMENT_ID_KEY, area);
      removeStoredKey(scopedPaymentIdKey, area);
    });
    clearPaymentViewState();
    setPaymentData(null);
    setPaymentStatus(PAYMENT_STATUS.pending);
    setUploadFile(null);
    uploadFileRef.current = null;
    if (uploadPreviewUrl) {
      URL.revokeObjectURL(uploadPreviewUrl);
      setUploadPreviewUrl("");
    }
    setFailureReasons([]);
    setError(null);
    setRetryInSeconds(0);
    setQrVisible(false);
    await createPayment();
  };

  const handleUploadAndFinalize = useCallback(async () => {
    if (!isOnline) {
      showRetryHintError(uiText("payment.offlineVerify"));
      setPendingFlag(scopedPendingVerifyKey);
      return;
    }
    const operationId = beginOperation();

    const selectedFile = uploadFileRef.current || uploadFile;
    if (!selectedFile) {
      showRetryHintError(getErrorMessage(PAYMENT_ERROR_CODES.missingUpload));
      return;
    }

    if (!getPaymentField(paymentData, PAYMENT_API_FIELDS.id)) {
      showRetryHintError(getErrorMessage(PAYMENT_ERROR_CODES.missingPaymentId));
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

      const ensurePaymentToken = async () => {
        const existing = getPaymentField(paymentData, PAYMENT_API_FIELDS.token);
        if (existing) return existing;
        if (!publicId) return "";
        if (tokenRefreshAttemptedRef.current) return "";
        tokenRefreshAttemptedRef.current = true;
        const minted = await endpoints.mintPaymentToken(
          getPaymentField(paymentData, PAYMENT_API_FIELDS.id),
          publicId,
          sessionId,
          { signal: precheckController.signal }
        );
        const token = getPaymentField(minted, PAYMENT_API_FIELDS.token) || "";
        if (token) {
          setPaymentData((prev) => (prev ? { ...prev, [PAYMENT_API_FIELDS.token]: token } : prev));
        }
        return token;
      };
      let precheckStatus;
      try {
        precheckStatus = await endpoints.getPaymentStatus(
          getPaymentField(paymentData, PAYMENT_API_FIELDS.id),
          { signal: precheckController.signal },
          getPaymentField(paymentData, PAYMENT_API_FIELDS.token)
        );
      } catch (err) {
        if (err?.status === 403 || err?.code === "AUTH_002_0002") {
          const freshToken = await ensurePaymentToken();
          if (!freshToken) {
            notifySessionExpired();
            await createPayment();
            return;
          }
          precheckStatus = await endpoints.getPaymentStatus(
            getPaymentField(paymentData, PAYMENT_API_FIELDS.id),
            { signal: precheckController.signal },
            freshToken
          );
        } else {
          throw err;
        }
      }
      if (!isOperationCurrent(operationId)) return;

      if (getPaymentField(precheckStatus, PAYMENT_API_FIELDS.status) === PAYMENT_STATUS.expired || getPaymentField(precheckStatus, PAYMENT_API_FIELDS.isExpired)) {
        handleExpiry();
        return;
      }
      if (getPaymentField(precheckStatus, PAYMENT_API_FIELDS.status) === PAYMENT_STATUS.success) {
        setPaymentStatus(PAYMENT_STATUS.success);
        forEachStorageArea((area) => {
          removeStoredKey(PAYMENT_ID_KEY, area);
          removeStoredKey(scopedPaymentIdKey, area);
        });
        clearTimerState();
        clearPaymentViewState();
        onNext?.({ skipVerification: true });
        return;
      }
      if (getPaymentField(precheckStatus, PAYMENT_API_FIELDS.status) === PAYMENT_STATUS.rejectedFraud) {
        const reasons = getFailureReasons(precheckStatus);
        const specificError = getVerificationErrorMessage(reasons);
        setPaymentStatus(PAYMENT_STATUS.rejectedFraud);
        setFailureReasons(reasons);
        showRetryHintError(specificError || getErrorMessage(PAYMENT_ERROR_CODES.screenshotRejected));
        savePaymentViewState({
          [PAYMENT_STATE_FIELDS.publicId]: publicId,
          [PAYMENT_STATE_FIELDS.paymentData]: paymentData,
          [PAYMENT_STATE_FIELDS.paymentStatus]: PAYMENT_STATUS.rejectedFraud,
          [PAYMENT_STATE_FIELDS.failureReasons]: reasons,
          [PAYMENT_STATE_FIELDS.error]: specificError || getErrorMessage(PAYMENT_ERROR_CODES.screenshotRejected),
        });
        return;
      }
      if (getPaymentField(precheckStatus, PAYMENT_API_FIELDS.status) !== PAYMENT_STATUS.pending && getPaymentField(precheckStatus, PAYMENT_API_FIELDS.status) !== PAYMENT_STATUS.processing) {
        showRetryHintError(getErrorMessage(PAYMENT_ERROR_CODES.invalidState));
        resumeTimerFromCurrentPayment();
        return;
      }
      const serverRemainingMs = getServerRemainingMs(precheckStatus);
      if (serverRemainingMs > 0) {
        timerTotalMsRef.current = Math.max(1000, serverRemainingMs);
      }
      if (getPaymentField(precheckStatus, PAYMENT_API_FIELDS.expiresAt)) {
        setPaymentData((prev) => prev
          ? {
              ...prev,
              [PAYMENT_API_FIELDS.expiresAt]: getPaymentField(precheckStatus, PAYMENT_API_FIELDS.expiresAt),
              [PAYMENT_API_FIELDS.timeRemainingSeconds]: getPaymentField(precheckStatus, PAYMENT_API_FIELDS.timeRemainingSeconds) ?? getPaymentField(prev, PAYMENT_API_FIELDS.timeRemainingSeconds),
            }
          : prev);
      }

      const qualityCheck = await validateScreenshotQuality(selectedFile);
      if (!isOperationCurrent(operationId)) return;
      if (!qualityCheck.ok) {
        showRetryHintError(qualityCheck.message || getErrorMessage(PAYMENT_ERROR_CODES.invalidImage));
        resumeTimerFromCurrentPayment();
        setVerifying(false);
        return;
      }

      // Extract file extension from uploaded file
      const fileExtension = selectedFile.name.split(".").pop().toLowerCase();
      const sha256 = await calculateSha256(selectedFile);
      if (!isOperationCurrent(operationId)) return;

      let paymentWriteToken = getPaymentField(paymentData, PAYMENT_API_FIELDS.token) || "";
      if (!paymentWriteToken) {
        paymentWriteToken = await ensurePaymentToken();
        if (!paymentWriteToken) {
          notifySessionExpired();
          await createPayment();
          return;
        }
      }

      // Step 1: Convert file to base64 and verify. Backend uploads to S3 only on success.
      const imageBase64 = await fileToBase64(selectedFile);
      if (!isOperationCurrent(operationId)) return;

      // Step 2: Trigger verification with inline image payload
      if (verifyAbortRef.current) verifyAbortRef.current.abort();
      const verifyController = new AbortController();
      verifyAbortRef.current = verifyController;
      let verifyData;
      try {
        verifyData = await endpoints.verifyUpload(
          getPaymentField(paymentData, PAYMENT_API_FIELDS.id),
          imageBase64,
          fileExtension,
          sha256,
          {
            mime_type: selectedFile.type || "",
            file_size: selectedFile.size || 0,
            original_filename: selectedFile.name || "",
          },
          {
            signal: verifyController.signal,
            headers: {
              [REQUEST_HEADERS.authorization]: `Bearer ${paymentWriteToken}`,
            },
          }
        );
      } catch (err) {
        if (err?.status === 403 || err?.code === "AUTH_002_0002") {
          const freshToken = await ensurePaymentToken();
          if (!freshToken) {
            notifySessionExpired();
            await createPayment();
            return;
          }
          verifyData = await endpoints.verifyUpload(
            getPaymentField(paymentData, PAYMENT_API_FIELDS.id),
            imageBase64,
            fileExtension,
            sha256,
            {
              mime_type: selectedFile.type || "",
              file_size: selectedFile.size || 0,
              original_filename: selectedFile.name || "",
            },
            {
              signal: verifyController.signal,
              headers: {
                [REQUEST_HEADERS.authorization]: `Bearer ${freshToken}`,
              },
            }
          );
        } else if (err?.status === 409) {
          // Known conflict errors (e.g., reused/rejected screenshot). Show UI message and stop.
          showRetryHintError(err?.message || getErrorMessage(PAYMENT_ERROR_CODES.screenshotRejected));
          setVerifying(false);
          resumeTimerFromCurrentPayment();
          return;
        } else {
          throw err;
        }
      }
      if (!isOperationCurrent(operationId)) return;

      // Check verification result
      const verification = verifyData.verification;

      if (verification?.verified && verification.status === PAYMENT_STATUS.rejectedFraud) {
        setPaymentStatus(PAYMENT_STATUS.rejectedFraud);
        setVerifying(false);
        const reasons = verification.failure_reasons || [];
        setFailureReasons(reasons);
        const specificError = getVerificationErrorMessage(reasons);
        showRetryHintError(specificError || getErrorMessage(PAYMENT_ERROR_CODES.screenshotRejected));
        savePaymentViewState({
          [PAYMENT_STATE_FIELDS.publicId]: publicId,
          [PAYMENT_STATE_FIELDS.paymentData]: paymentData,
          [PAYMENT_STATE_FIELDS.paymentStatus]: PAYMENT_STATUS.rejectedFraud,
          [PAYMENT_STATE_FIELDS.failureReasons]: reasons,
          [PAYMENT_STATE_FIELDS.error]: specificError || getErrorMessage(PAYMENT_ERROR_CODES.screenshotRejected),
        });
        return;
      }

      if (verification?.verified && verification.status === PAYMENT_STATUS.success) {
        setPaymentStatus(PAYMENT_STATUS.success);
        forEachStorageArea((area) => {
          removeStoredKey(PAYMENT_ID_KEY, area);
          removeStoredKey(scopedPaymentIdKey, area);
        });
        clearTimerState();
        clearPaymentViewState();
        onNext?.({ skipVerification: true });
        return;
      }

      // Fall back to polling status endpoint for async processing
      if (statusAbortRef.current) statusAbortRef.current.abort();
      const statusController = new AbortController();
      statusAbortRef.current = statusController;
      const statusData = await endpoints.getPaymentStatus(
        getPaymentField(paymentData, PAYMENT_API_FIELDS.id),
        { signal: statusController.signal },
        getPaymentField(paymentData, PAYMENT_API_FIELDS.token)
      );
      if (!isOperationCurrent(operationId)) return;

      if (getPaymentField(statusData, PAYMENT_API_FIELDS.status) === PAYMENT_STATUS.rejectedFraud) {
        setPaymentStatus(PAYMENT_STATUS.rejectedFraud);
        setVerifying(false);
        const reasons = getFailureReasons(statusData);
        setFailureReasons(reasons);
        const specificError = getVerificationErrorMessage(reasons);
        showRetryHintError(specificError || getErrorMessage(PAYMENT_ERROR_CODES.screenshotRejected));
        savePaymentViewState({
          [PAYMENT_STATE_FIELDS.publicId]: publicId,
          [PAYMENT_STATE_FIELDS.paymentData]: paymentData,
          [PAYMENT_STATE_FIELDS.paymentStatus]: PAYMENT_STATUS.rejectedFraud,
          [PAYMENT_STATE_FIELDS.failureReasons]: reasons,
          [PAYMENT_STATE_FIELDS.error]: specificError || getErrorMessage(PAYMENT_ERROR_CODES.screenshotRejected),
        });
        return;
      }

      if (getPaymentField(statusData, PAYMENT_API_FIELDS.status) === PAYMENT_STATUS.expired) {
        handleExpiry();
        return;
      }

      if (getPaymentField(statusData, PAYMENT_API_FIELDS.status) === PAYMENT_STATUS.success) {
        setPaymentStatus(PAYMENT_STATUS.success);
        forEachStorageArea((area) => {
          removeStoredKey(PAYMENT_ID_KEY, area);
          removeStoredKey(scopedPaymentIdKey, area);
        });
        clearTimerState();
        clearPaymentViewState();
        onNext?.({ skipVerification: true });
        return;
      }

      if (verification?.status === PAYMENT_STATUS.error) {
        setVerifying(false);
        showRetryHintError(getErrorMessage(PAYMENT_ERROR_CODES.verificationFailed));
        resumeTimerFromCurrentPayment();
        return;
      }

      setVerifying(false);
      showRetryHintError(getErrorMessage(PAYMENT_ERROR_CODES.verificationUnknown));
      resumeTimerFromCurrentPayment();
    } catch (err) {
      if (err?.code === REQUEST_CODES.aborted) {
        return;
      }
      if (!isOperationCurrent(operationId)) return;
      // Handle specific error codes with better messaging
      if (err.code === PAYMENT_ERROR_CODES.sessionExpired || err.code === "ERR_PAYMENT_EXPIRED") {
        handleExpiry();
        return;
      }
      if (err.code === PAYMENT_ERROR_CODES.maxAttempts) {
        showRetryHintError(err.message || getErrorMessage(PAYMENT_ERROR_CODES.maxAttempts));
        setPaymentStatus(PAYMENT_STATUS.failed);
        return;
      }

      if (err.code === PAYMENT_ERROR_CODES.uploadTooLarge || err.status === 413) {
        const actualMb = (uploadFile?.size || 0) / (1024 * 1024);
        const sizeLabel = Number.isFinite(actualMb) ? actualMb.toFixed(2) : "unknown";
        showRetryHintError(uiText("payment.fileTooLarge", { actual: sizeLabel, max: MAX_UPLOAD_MB }));
      } else if (err.code) {
        showRetryHintError(err.message || getErrorMessage(err.code));
      } else if (err.message && err.message.toLowerCase().includes(NETWORK_ERROR_HINTS.timeout)) {
        showRetryHintError(getErrorMessage('SYS_002_0008'));
      } else if (err.message && err.message.toLowerCase().includes(NETWORK_ERROR_HINTS.fetch)) {
        showRetryHintError(getErrorMessage('SYS_002_0007'));
      } else {
        showRetryHintError(getErrorMessage(PAYMENT_ERROR_CODES.verificationUnknown));
      }
      resumeTimerFromCurrentPayment();

    } finally {
      verifyAbortRef.current = null;
      statusAbortRef.current = null;
      if (isOperationCurrent(operationId)) {
        setVerifying(false);
      }
    }
  }, [
    isOnline,
    showRetryHintError,
    uploadFile,
    paymentData,
    stopTimer,
    beginOperation,
    isOperationCurrent,
    onNext,
    getVerificationErrorMessage,
    getServerRemainingMs,
    handleExpiry,
    resumeTimerFromCurrentPayment,
    validateScreenshotQuality,
    savePaymentViewState,
    setPaymentStatus,
    setFailureReasons,
    setError,
    setRetryInSeconds,
    setVerifying,
    clearTimerState,
    clearPaymentViewState,
    setPaymentData,
    publicId,
    createPayment,
    notifySessionExpired,
    sessionId,
    scopedPaymentIdKey,
    scopedPendingVerifyKey,
  ]);

  const markQrVisible = useCallback(() => {
    setQrVisible(true);
  }, []);

  useEffect(() => {
    const autoRetryOnReconnect = async () => {
      if (!isOnline || isCriticalAction) return;
      const pendingCreate = getPendingFlag(scopedPendingCreateKey);
      const pendingVerify = getPendingFlag(scopedPendingVerifyKey);
      if (pendingCreate) {
        clearPendingFlag(scopedPendingCreateKey);
        await createPayment();
        return;
      }
      if (pendingVerify && uploadFile) {
        clearPendingFlag(scopedPendingVerifyKey);
        await handleUploadAndFinalize();
        return;
      }
      if (!paymentData && paymentStatus === PAYMENT_STATUS.pending) {
        await createPayment();
        return;
      }
      if (getPaymentField(paymentData, PAYMENT_API_FIELDS.id) && !isMobile && !getPaymentField(paymentData, PAYMENT_API_FIELDS.qrBase64)) {
        fetchPaymentQr(getPaymentField(paymentData, PAYMENT_API_FIELDS.id), opVersionRef.current);
      }
      const paymentWriteToken = getPaymentField(paymentData, PAYMENT_API_FIELDS.token);
      if (getPaymentField(paymentData, PAYMENT_API_FIELDS.id) && paymentWriteToken) {
        try {
          const statusData = await endpoints.getPaymentStatus(
            getPaymentField(paymentData, PAYMENT_API_FIELDS.id),
            {},
            paymentWriteToken
          );
          const serverStatus = getPaymentField(statusData, PAYMENT_API_FIELDS.status);
          if (serverStatus === PAYMENT_STATUS.success) {
            clearPaymentViewState();
            onNext?.({ skipVerification: true });
            return;
          }
          if (serverStatus === PAYMENT_STATUS.expired) {
            clearPaymentViewState();
            notifySessionExpired();
            await createPayment();
          }
        } catch {
          // Ignore reconnect status errors; user can retry manually.
        }
      }
    };
    autoRetryOnReconnect();
  }, [
    isOnline,
    isCriticalAction,
    paymentData,
    paymentStatus,
    isMobile,
    uploadFile,
    createPayment,
    fetchPaymentQr,
    handleUploadAndFinalize,
    clearPaymentViewState,
    notifySessionExpired,
    onNext,
    scopedPendingCreateKey,
    scopedPendingVerifyKey,
  ]);

  useEffect(() => {
    savePaymentViewState({
      [PAYMENT_STATE_FIELDS.publicId]: publicId,
      [PAYMENT_STATE_FIELDS.paymentData]: paymentData,
      [PAYMENT_STATE_FIELDS.paymentStatus]: paymentStatus,
      [PAYMENT_STATE_FIELDS.failureReasons]: failureReasons,
      [PAYMENT_STATE_FIELDS.error]: error,
    });
  }, [publicId, paymentData, paymentStatus, failureReasons, error, savePaymentViewState]);

  useNavigationBlocker({
    enabled: isCriticalAction,
    message: uiText("payment.leaveBlocked"),
    onBlocked: (msg) => {
      if (!error) setError(msg);
    },
  });

  useEffect(() => {
    if (retryInSeconds <= 0) return;
    const t = scheduleTimeout(
      () => setRetryInSeconds((prev) => Math.max(0, prev - 1)),
      runtimeConfig.countdownTickMs
    );
    return () => clearScheduledTimeout(t);
  }, [retryInSeconds]);

  useEffect(() => {
    return () => {
      if (uploadPreviewUrl) {
        URL.revokeObjectURL(uploadPreviewUrl);
      }
    };
  }, [uploadPreviewUrl]);

  return {
    MAX_UPLOAD_MB,
    PAYMENT_AMOUNT_LABEL,
    paymentData,
    isLoading,
    paymentStatus,
    uploadFile,
    uploadPreviewUrl,
    verifying,
    error,
    retryInSeconds,
    failureReasons,
    refreshNotice,
    refreshNoticeVariant,
    isOnline,
    fileInputRef,
    timeRemaining,
    timerProgress,
    isMobile,
    isCriticalAction,
    offlineDisabled,
    retryBlocked,
    retryButtonLabel,
    formatTime,
    getTimerColor,
    getButtonStyle,
    getQrContainerStyle,
    getVerificationErrorMessage,
    getPaymentRecoverySteps,
    createPayment,
    handleFileChange,
    clearSelectedFile,
    restartPayment,
    handleUploadAndFinalize,
    markQrVisible,
  };
}
