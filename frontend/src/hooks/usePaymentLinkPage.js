import { useCallback, useEffect, useRef, useState } from "react";
import { endpoints } from "../utils/api.js";
import { getErrorMessage } from "../utils/errorRegistry.js";
import { getDisplayErrorMessage } from "../utils/appError.js";
import { uiText } from "../utils/uiText.js";
import { runtimeConfig } from "../config/runtime";
import { clearPendingFlag, forEachStorageArea, getPendingFlag, makeScopedKey, removeStoredKey, setPendingFlag } from "../utils/storage";
import { useNavigationBlocker } from "./useNavigationBlocker";
import { useOnlineStatus } from "./useOnlineStatus";
import { usePaymentUploadState } from "./usePaymentUploadState";
import {
  buildPaymentRecoverySteps,
  buildVerificationErrorMessage,
  calculateBlurVariance,
  calculateTimerValues,
  formatCountdown,
  getFailureReasons,
  getPaymentField,
  getQrContainerStyle,
  getServerRemainingMs,
  getTimerButtonStyle,
  getTimerColor,
  isPaymentAmountMismatch,
  validateScreenshotQuality as validateScreenshotQualityFile,
} from "../utils/paymentLinkHelpers";
import {
  clearPaymentScopedState,
  clearScopedTimerState,
  getStoredTimerState,
  loadPaymentViewState as loadStoredPaymentViewState,
  loadScopedPaymentToken,
  loadStoredPaymentId as loadPersistedPaymentId,
  savePaymentViewState as persistPaymentViewState,
  saveScopedPaymentId,
  saveScopedPaymentToken,
  saveTimerState as persistTimerState,
} from "../utils/paymentLinkState";
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
import { requirePublicId } from "../utils/publicId";
const MAX_UPLOAD_MB = runtimeConfig.paymentUploadMaxMb;
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
const PAYMENT_STATE_KEY = runtimeConfig.storageKeys.paymentState;
const PAYMENT_TIMER_KEY = runtimeConfig.storageKeys.paymentTimerExpires;
const PAYMENT_TOKEN_KEY = runtimeConfig.storageKeys.paymentToken;
const PAYMENT_ID_KEY = runtimeConfig.storageKeys.paymentId;
const PAYMENT_STATE_SCHEMA_VERSION = runtimeConfig.paymentStateSchemaVersion;
const PAYMENT_STATE_TTL_MS = runtimeConfig.paymentStateTtlMs;
const MIN_SCREENSHOT_WIDTH = runtimeConfig.minScreenshotWidth;
const MIN_SCREENSHOT_HEIGHT = runtimeConfig.minScreenshotHeight;
const MIN_LAPLACIAN_VARIANCE = runtimeConfig.minLaplacianVariance;
const EXPECTED_PAYMENT_AMOUNT = Number(runtimeConfig.paymentAmount);
const PAYMENT_AMOUNT_LABEL = uiText("common.inrAmount", { amount: EXPECTED_PAYMENT_AMOUNT });
const PAYMENT_PENDING_CREATE_KEY = runtimeConfig.storageKeys.paymentPendingCreate;
const PAYMENT_PENDING_VERIFY_KEY = runtimeConfig.storageKeys.paymentPendingVerify;

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
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState(null);
  const [retryInSeconds, setRetryInSeconds] = useState(0);
  const [failureReasons, setFailureReasons] = useState([]);
  const [refreshNotice, setRefreshNotice] = useState("");
  const [refreshNoticeVariant, setRefreshNoticeVariant] = useState(PAYMENT_NOTICE_VARIANT.info);
  const isOnline = useOnlineStatus();
  const refreshNoticeShownRef = useRef(false);
  const opVersionRef = useRef(0);
  const isMountedRef = useRef(true);
  const statusAbortRef = useRef(null);
  const createAbortRef = useRef(null);
  const createOnceRef = useRef(false);
  const lastInitPublicIdRef = useRef(null);
  const verifyAbortRef = useRef(null);
  const qrAbortRef = useRef(null);
  const lastRejectedShaRef = useRef("");

  // Timer state
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [timerProgress, setTimerProgress] = useState(100);
  const timerIntervalRef = useRef(null);
  const timerTotalMsRef = useRef(runtimeConfig.paymentTimerDurationMs);
  const pendingTimerExpiresAtRef = useRef(null);
  const [qrVisible, setQrVisible] = useState(false);
  const pausedTimerRef = useRef(null);

  const paymentScope = String(publicId || "").trim() || "anon";
  const scopedPaymentStateKey = makeScopedKey(PAYMENT_STATE_KEY, paymentScope);
  const scopedPaymentTimerKey = makeScopedKey(PAYMENT_TIMER_KEY, paymentScope);
  const scopedPaymentIdKey = makeScopedKey(PAYMENT_ID_KEY, paymentScope);
  const scopedPaymentTokenKey = makeScopedKey(PAYMENT_TOKEN_KEY, paymentScope);
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
    ? uiText("common.tryAgainIn", { seconds: retryInSeconds })
    : uiText("payment.confirmPayment");
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

  const getVerificationErrorMessage = useCallback((reasons = []) => buildVerificationErrorMessage({
    reasons,
    reasonCodeMap: PAYMENT_VERIFICATION_REASON_CODES,
    getErrorMessage,
  }), []);

  const getPaymentRecoverySteps = useCallback((reasons = [], err = null) => buildPaymentRecoverySteps({
    reasons,
    err,
    uiText,
    paymentAmountLabel: PAYMENT_AMOUNT_LABEL,
    paymentErrorCodes: PAYMENT_ERROR_CODES,
  }), []);

  const validateScreenshotQuality = useCallback(
    (file) => validateScreenshotQualityFile({
      file,
      calculateVariance: calculateBlurVariance,
      uiText,
      minWidth: MIN_SCREENSHOT_WIDTH,
      minHeight: MIN_SCREENSHOT_HEIGHT,
      minVariance: MIN_LAPLACIAN_VARIANCE,
    }),
    []
  );

  const {
    uploadFile,
    uploadPreviewUrl,
    uploadFileRef,
    fileInputRef,
    handleFileChange: updateUploadState,
    clearSelectedFile: resetSelectedFile,
  } = usePaymentUploadState({
    maxUploadBytes: MAX_UPLOAD_BYTES,
    maxUploadMb: MAX_UPLOAD_MB,
    getInvalidTypeMessage: () => getErrorMessage(PAYMENT_ERROR_CODES.invalidImage),
    getTooLargeMessage: (fileSize) => {
      const actualMb = (fileSize / (1024 * 1024)).toFixed(2);
      return uiText("payment.fileTooLarge", { actual: actualMb, max: MAX_UPLOAD_MB });
    },
  });

  const savePaymentViewState = useCallback((state) => {
    persistPaymentViewState({
      isOnline,
      scopedPaymentStateKey,
      paymentStateKey: PAYMENT_STATE_KEY,
      schemaVersion: PAYMENT_STATE_SCHEMA_VERSION,
      ttlMs: PAYMENT_STATE_TTL_MS,
      state,
    });
  }, [isOnline, scopedPaymentStateKey]);

  const clearPaymentViewState = useCallback(() => {
    clearPaymentScopedState({
      paymentStateKey: PAYMENT_STATE_KEY,
      scopedPaymentStateKey,
      paymentTokenKey: PAYMENT_TOKEN_KEY,
      scopedPaymentTokenKey,
    });
  }, [scopedPaymentStateKey, scopedPaymentTokenKey]);

  const savePaymentToken = useCallback((token, paymentId = null) => {
    saveScopedPaymentToken({
      token,
      paymentId,
      scopedPaymentTokenKey,
      paymentTokenKey: PAYMENT_TOKEN_KEY,
      schemaVersion: PAYMENT_STATE_SCHEMA_VERSION,
      ttlMs: PAYMENT_STATE_TTL_MS,
    });
  }, [scopedPaymentTokenKey]);

  const loadPaymentToken = useCallback((expectedPaymentId = null) => {
    return loadScopedPaymentToken({
      expectedPaymentId,
      scopedPaymentTokenKey,
      paymentTokenKey: PAYMENT_TOKEN_KEY,
      schemaVersion: PAYMENT_STATE_SCHEMA_VERSION,
      ttlMs: PAYMENT_STATE_TTL_MS,
    });
  }, [scopedPaymentTokenKey]);

  const getPaymentStatusWithRetry = useCallback(async ({
    paymentId,
    effectivePublicId,
    sessionId,
    signal,
    initialToken,
  }) => {
    let token = initialToken || loadPaymentToken(paymentId);
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        if (!token) {
          const minted = await endpoints.mintPaymentToken(
            paymentId,
            effectivePublicId,
            sessionId,
            { signal }
          );
          token = getPaymentField(minted, PAYMENT_API_FIELDS.token) || "";
          if (token) savePaymentToken(token, paymentId);
        }
        if (!token) throw new Error("missing_payment_token");
        const statusData = await endpoints.getPaymentStatus(
          paymentId,
          { signal },
          token
        );
        return { statusData, token };
      } catch (err) {
        const isAuthError = err?.status === 403 || err?.code === "AUTH_002_0002";
        if (!isAuthError || attempt === maxAttempts) {
          throw err;
        }
        token = "";
      }
    }
    throw new Error("payment_status_retry_exhausted");
  }, [loadPaymentToken, savePaymentToken]);

  const loadPaymentViewState = useCallback(() => loadStoredPaymentViewState({
    publicId,
    scopedPaymentStateKey,
    paymentStateKey: PAYMENT_STATE_KEY,
    schemaVersion: PAYMENT_STATE_SCHEMA_VERSION,
    ttlMs: PAYMENT_STATE_TTL_MS,
    publicIdField: PAYMENT_STATE_FIELDS.publicId,
  }), [publicId, scopedPaymentStateKey]);

  const loadStoredPaymentId = useCallback(() => loadPersistedPaymentId({
    scopedPaymentIdKey,
    paymentIdKey: PAYMENT_ID_KEY,
    schemaVersion: PAYMENT_STATE_SCHEMA_VERSION,
    ttlMs: PAYMENT_STATE_TTL_MS,
  }), [scopedPaymentIdKey]);

  // Timer state persistence helpers
  const saveTimerState = useCallback((expiresAt, paused = null) => {
    persistTimerState({
      scopedPaymentTimerKey,
      paymentTimerKey: PAYMENT_TIMER_KEY,
      schemaVersion: PAYMENT_STATE_SCHEMA_VERSION,
      ttlMs: PAYMENT_STATE_TTL_MS,
      expiresAt,
      totalDurationMs: timerTotalMsRef.current,
      paused,
    });
  }, [scopedPaymentTimerKey]);

  const clearTimerState = useCallback(() => {
    clearScopedTimerState({
      paymentTimerKey: PAYMENT_TIMER_KEY,
      scopedPaymentTimerKey,
    });
  }, [scopedPaymentTimerKey]);

  const getTimerState = useCallback(() => {
    return getStoredTimerState({
      scopedPaymentTimerKey,
      paymentTimerKey: PAYMENT_TIMER_KEY,
      schemaVersion: PAYMENT_STATE_SCHEMA_VERSION,
      ttlMs: PAYMENT_STATE_TTL_MS,
    });
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

  const getServerRemainingMsValue = useCallback((payload) => getServerRemainingMs(
    payload,
    PAYMENT_API_FIELDS.timeRemainingSeconds,
    PAYMENT_API_FIELDS.expiresAt
  ), []);

  const getTimerValues = useCallback((expiresAt) => calculateTimerValues(expiresAt, timerTotalMsRef.current), []);
  const formatTime = useCallback((ms) => formatCountdown(ms, runtimeConfig.msPerSecond), []);
  const getTimerColorValue = useCallback(() => getTimerColor(timerProgress), [timerProgress]);
  const getButtonStyle = useCallback(() => getTimerButtonStyle(timerProgress), [timerProgress]);
  const getQrContainerStyleValue = useCallback(() => getQrContainerStyle(timerProgress), [timerProgress]);

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
      const { remaining, progress } = getTimerValues(expiresAt);
      setTimeRemaining(remaining);
      setTimerProgress(progress);

      if (remaining <= 0) {
        clearScheduledInterval(timerIntervalRef.current);
        handleExpiry();
      }
    };

    updateTimer();
    timerIntervalRef.current = scheduleInterval(updateTimer, runtimeConfig.paymentTimerTickMs);
  }, [getTimerValues, saveTimerState, handleExpiry, stopTimer]);

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
    const { remaining } = getTimerValues(expiresAt);
    if (remaining > 0) {
      requestStartTimer(expiresAt);
      return;
    }
    handleExpiry();
  }, [paymentData, getTimerValues, requestStartTimer, handleExpiry]);

  const resumePausedTimer = useCallback(() => {
    const paused = pausedTimerRef.current;
    if (!paused || !paused.remainingMs || paused.remainingMs <= 0) {
      resumeTimerFromCurrentPayment();
      return;
    }
    timerTotalMsRef.current = Math.max(1000, paused.totalDurationMs || timerTotalMsRef.current);
    const newExpiresAt = new Date(Date.now() + paused.remainingMs).toISOString();
    requestStartTimer(newExpiresAt);
    pausedTimerRef.current = null;
    saveTimerState(newExpiresAt);
  }, [requestStartTimer, resumeTimerFromCurrentPayment, saveTimerState]);

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

  const createPayment = useCallback(async (_reason = "") => {
    const operationId = beginOperation();
    const effectivePublicId = requirePublicId(publicId);
    if (!effectivePublicId) {
      setError(getErrorMessage(PAYMENT_ERROR_CODES.paymentUnavailable));
      return;
    }
    if (!isOnline) {
      setError(uiText("payment.offlineCreate"));
      setPendingFlag(scopedPendingCreateKey);
      return;
    }

    // Reset any previous timer state before creating a new payment.
    stopTimer(true);
    pendingTimerExpiresAtRef.current = null;
    pausedTimerRef.current = null;
    timerTotalMsRef.current = runtimeConfig.paymentTimerDurationMs;
    setTimeRemaining(0);
    setTimerProgress(100);

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
      const data = await endpoints.createPayment(effectivePublicId, { signal: controller.signal });
      if (!isOperationCurrent(operationId)) return;
      const createdToken = getPaymentField(data, PAYMENT_API_FIELDS.token);
      const createdPaymentId = getPaymentField(data, PAYMENT_API_FIELDS.id);
      if (createdToken) {
        savePaymentToken(createdToken, createdPaymentId);
      }
      saveScopedPaymentId({
        paymentId: getPaymentField(data, PAYMENT_API_FIELDS.id),
        scopedPaymentIdKey,
        paymentIdKey: PAYMENT_ID_KEY,
        schemaVersion: PAYMENT_STATE_SCHEMA_VERSION,
        ttlMs: PAYMENT_STATE_TTL_MS,
      });

      const expiresAt = new Date(getPaymentField(data, PAYMENT_API_FIELDS.expiresAt));
      const now = new Date();
      if (expiresAt <= now) {
        throw new Error(getErrorMessage(PAYMENT_ERROR_CODES.sessionExpired));
      }

      const serverRemainingMs = getServerRemainingMsValue(data);
      timerTotalMsRef.current = Math.max(
        1000,
        serverRemainingMs || Math.max(0, expiresAt.getTime() - now.getTime())
      );
      setPaymentData(data);
      setPaymentStatus(PAYMENT_STATUS.pending);
      setQrVisible(false);
      requestStartTimer(getPaymentField(data, PAYMENT_API_FIELDS.expiresAt));
      savePaymentViewState({
        [PAYMENT_STATE_FIELDS.publicId]: effectivePublicId,
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
        : getDisplayErrorMessage(err, PAYMENT_ERROR_CODES.systemCreate);
      showRetryHintError(errorMessage);
      forEachStorageArea((area) => {
        removeStoredKey(PAYMENT_ID_KEY, area);
        removeStoredKey(scopedPaymentIdKey, area);
      });
      savePaymentViewState({
        [PAYMENT_STATE_FIELDS.publicId]: effectivePublicId,
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
  }, [beginOperation, fetchPaymentQr, getServerRemainingMsValue, isMobile, isOnline, isOperationCurrent, onParticipantNotFound, publicId, requestStartTimer, savePaymentToken, savePaymentViewState, scopedPaymentIdKey, scopedPendingCreateKey, showRetryHintError, stopTimer]);

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
    if (verifying) return;
    if (!isOnline) {
      stopTimer();
      return;
    }
    if (getPaymentField(paymentData, PAYMENT_API_FIELDS.expiresAt)) {
      resumeTimerFromCurrentPayment();
    }
  }, [isOnline, paymentData, resumeTimerFromCurrentPayment, stopTimer, verifying]);

  useEffect(() => {
    document.title = uiText("payment.documentTitle");
    let cancelled = false;

    const initialize = async () => {
      const effectivePublicId = requirePublicId(publicId);
      if (!effectivePublicId) return;
      if (createOnceRef.current && lastInitPublicIdRef.current === effectivePublicId) return;
      createOnceRef.current = true;
      lastInitPublicIdRef.current = effectivePublicId;
      const restored = loadPaymentViewState();
      const restoredPaymentData = restored?.[PAYMENT_STATE_FIELDS.paymentData];
      const restoredStatus = restored?.[PAYMENT_STATE_FIELDS.paymentStatus] || PAYMENT_STATUS.pending;
      const storedTimer = getTimerState();
      if (storedTimer?.totalDurationMs) {
        timerTotalMsRef.current = Math.max(1000, storedTimer.totalDurationMs);
      }
      if (storedTimer?.pausedRemainingMs && storedTimer?.pausedRemainingMs > 0) {
        pausedTimerRef.current = {
          remainingMs: storedTimer.pausedRemainingMs,
          totalDurationMs: storedTimer.totalDurationMs || timerTotalMsRef.current,
          pausedAt: storedTimer.pausedAt || Date.now(),
        };
      }

      if (getPaymentField(restoredPaymentData, PAYMENT_API_FIELDS.id) && getPaymentField(restoredPaymentData, PAYMENT_API_FIELDS.expiresAt)) {
        if (isPaymentAmountMismatch(restoredPaymentData)) {
          clearPaymentViewState();
          notifySessionExpired();
          if (!cancelled) await createPayment("restore_amount_mismatch");
          return;
        }
        if (!effectivePublicId) {
          return;
        }
        if (statusAbortRef.current) statusAbortRef.current.abort();
        const statusController = new AbortController();
        statusAbortRef.current = statusController;
        const restoredPaymentId = getPaymentField(restoredPaymentData, PAYMENT_API_FIELDS.id);
        const storedToken = getPaymentField(restoredPaymentData, PAYMENT_API_FIELDS.token) || loadPaymentToken(restoredPaymentId);
        if (!storedToken && effectivePublicId) {
          notifySessionRefreshing();
          setRefreshNotice("");
        }
        try {
          const { statusData, token } = await getPaymentStatusWithRetry({
            paymentId: getPaymentField(restoredPaymentData, PAYMENT_API_FIELDS.id),
            effectivePublicId,
            sessionId,
            signal: statusController.signal,
            initialToken: storedToken,
          });
          if (token) {
            restoredPaymentData[PAYMENT_API_FIELDS.token] = token;
          }
          const serverStatus = getPaymentField(statusData, PAYMENT_API_FIELDS.status);

          if (serverStatus === PAYMENT_STATUS.success) {
            clearPaymentViewState();
            if (!cancelled) onNext?.({ skipVerification: true });
            return;
          }

        if (serverStatus === PAYMENT_STATUS.expired) {
          clearPaymentViewState();
          notifySessionExpired();
          if (!cancelled) await createPayment("restore_expired");
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
            const serverRemainingMs = getServerRemainingMsValue(statusData || mergedPaymentData);
            if (!storedTimer?.totalDurationMs) {
              timerTotalMsRef.current = Math.max(1000, serverRemainingMs || timerTotalMsRef.current);
            }
            const { remaining, progress } = getTimerValues(getPaymentField(mergedPaymentData, PAYMENT_API_FIELDS.expiresAt));
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
        } catch (err) {
            const expiresAt = getPaymentField(restoredPaymentData, PAYMENT_API_FIELDS.expiresAt);
            if (expiresAt) {
              if (storedTimer?.totalDurationMs) {
                timerTotalMsRef.current = Math.max(1000, storedTimer.totalDurationMs);
              }
              const { remaining, progress } = getTimerValues(expiresAt);
              if (remaining > 0) {
                if (cancelled) return;
              setPaymentData(restoredPaymentData);
              setPaymentStatus(restoredStatus);
              setFailureReasons(Array.isArray(restored?.[PAYMENT_STATE_FIELDS.failureReasons]) ? restored[PAYMENT_STATE_FIELDS.failureReasons] : []);
              setError(restored?.[PAYMENT_STATE_FIELDS.error] || null);
              setTimeRemaining(remaining);
              setTimerProgress(progress);
              requestStartTimer(expiresAt);
              if (!isMobile && !getPaymentField(restoredPaymentData, PAYMENT_API_FIELDS.qrBase64)) {
                fetchPaymentQr(getPaymentField(restoredPaymentData, PAYMENT_API_FIELDS.id), opVersionRef.current);
              }
              return;
            }
          }
          // If status check fails and restore is not usable, fall through and create a new payment.
        } finally {
          statusAbortRef.current = null;
        }
      }

      const storedPaymentId = loadStoredPaymentId();
      if (storedPaymentId) {
        if (statusAbortRef.current) statusAbortRef.current.abort();
        const statusController = new AbortController();
        statusAbortRef.current = statusController;
        notifySessionRefreshing();
        try {
          const { statusData, token } = await getPaymentStatusWithRetry({
            paymentId: storedPaymentId,
            effectivePublicId,
            sessionId,
            signal: statusController.signal,
          });
          if (!token) {
            forEachStorageArea((area) => {
              removeStoredKey(PAYMENT_ID_KEY, area);
              removeStoredKey(scopedPaymentIdKey, area);
            });
            clearPaymentViewState();
            notifySessionExpired();
            await createPayment("stored_token_missing");
            return;
          }
          const serverStatus = getPaymentField(statusData, PAYMENT_API_FIELDS.status);

          if (serverStatus === PAYMENT_STATUS.success) {
            clearPaymentViewState();
            forEachStorageArea((area) => {
              removeStoredKey(PAYMENT_ID_KEY, area);
              removeStoredKey(scopedPaymentIdKey, area);
            });
            if (!cancelled) onNext?.({ skipVerification: true });
            return;
          }

          if (serverStatus === PAYMENT_STATUS.expired) {
            clearPaymentViewState();
            forEachStorageArea((area) => {
              removeStoredKey(PAYMENT_ID_KEY, area);
              removeStoredKey(scopedPaymentIdKey, area);
            });
            notifySessionExpired();
            if (!cancelled) await createPayment("stored_expired");
            return;
          }

          const mergedPaymentData = {
            ...statusData,
            [PAYMENT_API_FIELDS.id]: storedPaymentId,
            [PAYMENT_API_FIELDS.token]: token,
          };

          if (serverStatus === PAYMENT_STATUS.rejectedFraud) {
            if (!cancelled) {
              const reasons = getFailureReasons(statusData) || [];
              const specificError = getVerificationErrorMessage(reasons);
              setPaymentData(mergedPaymentData);
              setPaymentStatus(PAYMENT_STATUS.rejectedFraud);
              setFailureReasons(reasons);
              setError(specificError || getErrorMessage(PAYMENT_ERROR_CODES.screenshotRejected));
              savePaymentViewState({
                [PAYMENT_STATE_FIELDS.publicId]: effectivePublicId,
                [PAYMENT_STATE_FIELDS.paymentData]: mergedPaymentData,
                [PAYMENT_STATE_FIELDS.paymentStatus]: PAYMENT_STATUS.rejectedFraud,
                [PAYMENT_STATE_FIELDS.failureReasons]: reasons,
                [PAYMENT_STATE_FIELDS.error]: specificError || getErrorMessage(PAYMENT_ERROR_CODES.screenshotRejected),
              });
            }
            return;
          }

          if (serverStatus === PAYMENT_STATUS.pending || serverStatus === PAYMENT_STATUS.processing) {
            const serverRemainingMs = getServerRemainingMsValue(statusData || mergedPaymentData);
            if (!storedTimer?.totalDurationMs) {
              timerTotalMsRef.current = Math.max(1000, serverRemainingMs || timerTotalMsRef.current);
            }
            const { remaining, progress } = getTimerValues(getPaymentField(mergedPaymentData, PAYMENT_API_FIELDS.expiresAt));
            if (remaining > 0) {
              if (cancelled) return;
              setPaymentData(mergedPaymentData);
              setPaymentStatus(PAYMENT_STATUS.pending);
              setFailureReasons([]);
              setError(null);
              setTimeRemaining(remaining);
              setTimerProgress(progress);
              requestStartTimer(getPaymentField(mergedPaymentData, PAYMENT_API_FIELDS.expiresAt));
              savePaymentViewState({
                [PAYMENT_STATE_FIELDS.publicId]: effectivePublicId,
                [PAYMENT_STATE_FIELDS.paymentData]: mergedPaymentData,
                [PAYMENT_STATE_FIELDS.paymentStatus]: PAYMENT_STATUS.pending,
                [PAYMENT_STATE_FIELDS.failureReasons]: [],
                [PAYMENT_STATE_FIELDS.error]: null,
              });
              if (!isMobile && !getPaymentField(mergedPaymentData, PAYMENT_API_FIELDS.qrBase64)) {
                fetchPaymentQr(getPaymentField(mergedPaymentData, PAYMENT_API_FIELDS.id), opVersionRef.current);
              }
              if (refreshNoticeVariant === PAYMENT_NOTICE_VARIANT.info) {
                setRefreshNotice("");
              }
              return;
            }
          }
        } catch (err) {
          // Fall through to create a new payment if status check fails.
        } finally {
          statusAbortRef.current = null;
        }
      }

      if (!cancelled) {
        await createPayment("no_restore_state");
      }
    };

    initialize();
    return () => {
      cancelled = true;
      stopTimer();
    };
  }, [
    getTimerValues,
    clearPaymentViewState,
    createPayment,
    fetchPaymentQr,
    getServerRemainingMsValue,
    getVerificationErrorMessage,
    getTimerState,
    handleExpiry,
    isMobile,
    loadStoredPaymentId,
    loadPaymentViewState,
    loadPaymentToken,
    getPaymentStatusWithRetry,
    notifySessionExpired,
    notifySessionRefreshing,
    onNext,
    refreshNoticeVariant,
    startTimer,
    requestStartTimer,
    stopTimer,
    publicId,
    scopedPaymentIdKey,
    sessionId,
    savePaymentToken,
    savePaymentViewState,
  ]);

  useEffect(() => {
    if (paymentData) return;
    if (!isOnline || !error) return;
    // Do not auto-create on refresh; user can retry manually.
  }, [error, isOnline, paymentData]);

  // Restore timer state from sessionStorage on page refresh
  useEffect(() => {
    if (verifying) return;
    if (!paymentData || timerIntervalRef.current) return;

    const timerState = getTimerState();
    const expiresAt = timerState?.expiresAt;
    if (timerState?.totalDurationMs) {
      timerTotalMsRef.current = Math.max(1000, timerState.totalDurationMs);
    }
    if (timerState?.pausedRemainingMs && timerState?.pausedRemainingMs > 0) {
      pausedTimerRef.current = {
        remainingMs: timerState.pausedRemainingMs,
        totalDurationMs: timerState.totalDurationMs || timerTotalMsRef.current,
        pausedAt: timerState.pausedAt || Date.now(),
      };
      setTimeRemaining(timerState.pausedRemainingMs);
      setTimerProgress(Math.max(0, (timerState.pausedRemainingMs / Math.max(1000, timerTotalMsRef.current)) * 100));
      return;
    }
    if (expiresAt) {
      const { remaining } = getTimerValues(expiresAt);
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
  }, [paymentData, getTimerState, clearTimerState, getTimerValues, startTimer, handleExpiry, stopTimer, verifying]);

  const handleFileChange = (event) => {
    updateUploadState(event, {
      onInvalid: showRetryHintError,
      onSelected: () => {
        setError(null);
        setFailureReasons([]);
        setPaymentStatus(PAYMENT_STATUS.pending);
        setRetryInSeconds(0);
      },
    });
  };

  const clearSelectedFile = () => {
    resetSelectedFile();
    setFailureReasons([]);
    setPaymentStatus(PAYMENT_STATUS.pending);
    setError(null);
    setRetryInSeconds(0);
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
    resetSelectedFile();
    setFailureReasons([]);
    setError(null);
    setRetryInSeconds(0);
    setQrVisible(false);
    await createPayment();
  };

  const handleUploadAndFinalize = useCallback(async () => {
    const effectivePublicId = requirePublicId(publicId);
    if (!effectivePublicId) {
      showRetryHintError(getErrorMessage(PAYMENT_ERROR_CODES.paymentUnavailable));
      return;
    }
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
    const currentExpiresAt = getPaymentField(paymentData, PAYMENT_API_FIELDS.expiresAt);
    if (currentExpiresAt) {
      const { remaining } = getTimerValues(currentExpiresAt);
      pausedTimerRef.current = {
        remainingMs: remaining,
        totalDurationMs: timerTotalMsRef.current,
        pausedAt: Date.now(),
      };
      setTimeRemaining(remaining);
      saveTimerState(currentExpiresAt, pausedTimerRef.current);
    }
    stopTimer();
    setVerifying(true);
    setError(null);
    setRetryInSeconds(0);

    try {
      const selectedFileHash = await calculateSha256(selectedFile);
      // Server-authoritative pre-check before upload/verify.
      if (statusAbortRef.current) statusAbortRef.current.abort();
      const precheckController = new AbortController();
      statusAbortRef.current = precheckController;

      const precheckPaymentId = getPaymentField(paymentData, PAYMENT_API_FIELDS.id);
      const ensurePaymentToken = async (forceRefresh = false) => {
        if (!forceRefresh) {
          const existing = getPaymentField(paymentData, PAYMENT_API_FIELDS.token);
          if (existing) return existing;
          const stored = loadPaymentToken(precheckPaymentId);
          if (stored) return stored;
        }
        if (!effectivePublicId) return "";
        const minted = await endpoints.mintPaymentToken(
          precheckPaymentId,
          effectivePublicId,
          sessionId,
          { signal: precheckController.signal }
        );
        const token = getPaymentField(minted, PAYMENT_API_FIELDS.token) || "";
        if (token) {
          setPaymentData((prev) => (prev ? { ...prev, [PAYMENT_API_FIELDS.token]: token } : prev));
          savePaymentToken(token, precheckPaymentId);
        }
        return token;
      };
      let precheckStatus;
      const precheckToken = getPaymentField(paymentData, PAYMENT_API_FIELDS.token) || loadPaymentToken(precheckPaymentId);
      if (precheckToken && !getPaymentField(paymentData, PAYMENT_API_FIELDS.token)) {
        setPaymentData((prev) => (prev ? { ...prev, [PAYMENT_API_FIELDS.token]: precheckToken } : prev));
      }
      try {
        precheckStatus = await endpoints.getPaymentStatus(
          getPaymentField(paymentData, PAYMENT_API_FIELDS.id),
          { signal: precheckController.signal },
          precheckToken || getPaymentField(paymentData, PAYMENT_API_FIELDS.token)
        );
      } catch (err) {
        if (err?.status === 403 || err?.code === "AUTH_002_0002") {
          const freshToken = await ensurePaymentToken(true);
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

      const precheckState = getPaymentField(precheckStatus, PAYMENT_API_FIELDS.status);
      if (precheckState === PAYMENT_STATUS.expired || getPaymentField(precheckStatus, PAYMENT_API_FIELDS.isExpired)) {
        notifySessionExpired();
        await createPayment();
        return;
      }
      if (precheckState === PAYMENT_STATUS.success) {
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
      if (precheckState === PAYMENT_STATUS.rejectedFraud) {
        if (selectedFileHash && lastRejectedShaRef.current && selectedFileHash !== lastRejectedShaRef.current) {
          setFailureReasons([]);
          setPaymentStatus(PAYMENT_STATUS.pending);
          setError(null);
          // Allow re-verify on the same payment with a new screenshot.
        } else {
          const reasons = getFailureReasons(precheckStatus);
          const specificError = getVerificationErrorMessage(reasons);
          setPaymentStatus(PAYMENT_STATUS.rejectedFraud);
          setFailureReasons(reasons);
          showRetryHintError(specificError || getErrorMessage(PAYMENT_ERROR_CODES.screenshotRejected));
          lastRejectedShaRef.current = selectedFileHash || lastRejectedShaRef.current;
          savePaymentViewState({
            [PAYMENT_STATE_FIELDS.publicId]: effectivePublicId,
            [PAYMENT_STATE_FIELDS.paymentData]: paymentData,
            [PAYMENT_STATE_FIELDS.paymentStatus]: PAYMENT_STATUS.rejectedFraud,
            [PAYMENT_STATE_FIELDS.failureReasons]: reasons,
            [PAYMENT_STATE_FIELDS.error]: specificError || getErrorMessage(PAYMENT_ERROR_CODES.screenshotRejected),
          });
          return;
        }
      }
      if (precheckState !== PAYMENT_STATUS.pending && precheckState !== PAYMENT_STATUS.processing) {
        const stateLabel = precheckState || "unknown";
        showRetryHintError(`${getErrorMessage(PAYMENT_ERROR_CODES.invalidState)} (${stateLabel})`);
        resumePausedTimer();
        return;
      }
      const serverRemainingMs = getServerRemainingMsValue(precheckStatus);
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
        resumePausedTimer();
        setVerifying(false);
        return;
      }

      // Extract file extension from uploaded file
      const fileExtension = selectedFile.name.split(".").pop().toLowerCase();
      const sha256 = selectedFileHash;
      if (!isOperationCurrent(operationId)) return;

      let paymentWriteToken = getPaymentField(paymentData, PAYMENT_API_FIELDS.token) || loadPaymentToken(getPaymentField(paymentData, PAYMENT_API_FIELDS.id)) || "";
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
          showRetryHintError(getDisplayErrorMessage(err, PAYMENT_ERROR_CODES.screenshotRejected));
          lastRejectedShaRef.current = selectedFileHash || lastRejectedShaRef.current;
          setVerifying(false);
          resumePausedTimer();
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
        lastRejectedShaRef.current = selectedFileHash || lastRejectedShaRef.current;
        savePaymentViewState({
          [PAYMENT_STATE_FIELDS.publicId]: effectivePublicId,
          [PAYMENT_STATE_FIELDS.paymentData]: paymentData,
          [PAYMENT_STATE_FIELDS.paymentStatus]: PAYMENT_STATUS.rejectedFraud,
          [PAYMENT_STATE_FIELDS.failureReasons]: reasons,
          [PAYMENT_STATE_FIELDS.error]: specificError || getErrorMessage(PAYMENT_ERROR_CODES.screenshotRejected),
        });
        resumePausedTimer();
        return;
      }

      if (verification?.verified && verification.status === PAYMENT_STATUS.success) {
        setPaymentStatus(PAYMENT_STATUS.success);
        pausedTimerRef.current = null;
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
      const statusToken = getPaymentField(paymentData, PAYMENT_API_FIELDS.token) || loadPaymentToken(getPaymentField(paymentData, PAYMENT_API_FIELDS.id));
      const statusData = await endpoints.getPaymentStatus(
        getPaymentField(paymentData, PAYMENT_API_FIELDS.id),
        { signal: statusController.signal },
        statusToken
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
          [PAYMENT_STATE_FIELDS.publicId]: effectivePublicId,
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
        resumePausedTimer();
        return;
      }

      setVerifying(false);
      showRetryHintError(getErrorMessage(PAYMENT_ERROR_CODES.verificationUnknown));
      resumePausedTimer();
    } catch (err) {
      if (err?.code === REQUEST_CODES.aborted) {
        return;
      }
      if (!isOperationCurrent(operationId)) return;
      // Handle specific error codes with better messaging
      if (err.code === PAYMENT_ERROR_CODES.sessionExpired) {
        handleExpiry();
        return;
      }
      if (err.code === PAYMENT_ERROR_CODES.maxAttempts) {
        showRetryHintError(getDisplayErrorMessage(err, PAYMENT_ERROR_CODES.maxAttempts));
        setPaymentStatus(PAYMENT_STATUS.failed);
        return;
      }

      if (err.code === PAYMENT_ERROR_CODES.uploadTooLarge || err.status === 413) {
        const actualMb = (uploadFile?.size || 0) / (1024 * 1024);
        const sizeLabel = Number.isFinite(actualMb) ? actualMb.toFixed(2) : "unknown";
        showRetryHintError(uiText("payment.fileTooLarge", { actual: sizeLabel, max: MAX_UPLOAD_MB }));
      } else if (err.code) {
        showRetryHintError(getDisplayErrorMessage(err, err.code));
      } else if (err.message && err.message.toLowerCase().includes(NETWORK_ERROR_HINTS.timeout)) {
        showRetryHintError(getErrorMessage('SYS_002_0008'));
      } else if (err.message && err.message.toLowerCase().includes(NETWORK_ERROR_HINTS.fetch)) {
        showRetryHintError(getErrorMessage('SYS_002_0007'));
      } else {
        showRetryHintError(getErrorMessage(PAYMENT_ERROR_CODES.verificationUnknown));
      }
      resumePausedTimer();

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
    getServerRemainingMsValue,
    handleExpiry,
    resumePausedTimer,
    getTimerValues,
    saveTimerState,
    validateScreenshotQuality,
    loadPaymentToken,
    savePaymentToken,
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
    uploadFileRef,
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
        const hasStoredPaymentId = Boolean(loadStoredPaymentId());
        const hasStoredView = Boolean(loadPaymentViewState());
        if (!hasStoredPaymentId && !hasStoredView) {
          await createPayment("auto_reconnect_no_state");
        }
        return;
      }
      if (getPaymentField(paymentData, PAYMENT_API_FIELDS.id) && !isMobile && !getPaymentField(paymentData, PAYMENT_API_FIELDS.qrBase64)) {
        fetchPaymentQr(getPaymentField(paymentData, PAYMENT_API_FIELDS.id), opVersionRef.current);
      }
      const paymentWriteToken = getPaymentField(paymentData, PAYMENT_API_FIELDS.token) || loadPaymentToken(getPaymentField(paymentData, PAYMENT_API_FIELDS.id));
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
    loadPaymentToken,
    loadPaymentViewState,
    loadStoredPaymentId,
    scopedPendingCreateKey,
    scopedPendingVerifyKey,
  ]);

  useEffect(() => {
    const effectivePublicId = requirePublicId(publicId);
    if (!effectivePublicId) return;
    savePaymentViewState({
      [PAYMENT_STATE_FIELDS.publicId]: effectivePublicId,
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
    getTimerColor: getTimerColorValue,
    getButtonStyle,
    getQrContainerStyle: getQrContainerStyleValue,
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
