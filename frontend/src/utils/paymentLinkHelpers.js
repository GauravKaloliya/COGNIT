export const getPaymentField = (payload, field) => payload?.[field];
export const getVerificationDetails = (payload, detailsField) => payload?.[detailsField];
export const getFailureReasons = (payload, detailsField, failureReasonsField) =>
  getVerificationDetails(payload, detailsField)?.[failureReasonsField] || [];

export function buildVerificationErrorMessage({ reasons = [], reasonCodeMap, getErrorMessage }) {
  if (!reasons.length) return "";
  return reasons
    .map((reason) => {
      const errorCode = reasonCodeMap[reason];
      return errorCode ? getErrorMessage(errorCode) : reason;
    })
    .join(". ");
}

export function buildPaymentRecoverySteps({ reasons = [], err = null, uiText, paymentAmountLabel, paymentErrorCodes }) {
  const steps = [];
  const reasonSet = new Set(Array.isArray(reasons) ? reasons : []);
  const code = err?.code || "";

  if (reasonSet.has("missing_paid_to_cognit") || reasonSet.has("invalid_banking_name")) {
    steps.push(uiText("payment.recovery.useSupportedApp"));
  }
  if (reasonSet.has("invalid_amount")) {
    steps.push(uiText("payment.recovery.exactAmount", { amount: paymentAmountLabel }));
  }
  if (reasonSet.has("time_out_of_range")) {
    steps.push(uiText("payment.recovery.withinTimer"));
  }
  if (reasonSet.has("ocr_unavailable") || reasonSet.has("invalid_datetime_format_gpay") || reasonSet.has("invalid_datetime_format_paytm") || reasonSet.has("invalid_datetime_format_bhim")) {
    steps.push(uiText("payment.recovery.clearScreenshot"));
  }
  if (reasonSet.has("missing_success")) {
    steps.push(uiText("payment.recovery.successStatus"));
  }
  if (reasonSet.has("failure_indicator")) {
    steps.push(uiText("payment.recovery.failureStatus"));
  }
  if (code === "DUP_003_0001" || code === paymentErrorCodes.screenshotReusedOther) {
    steps.push(uiText("payment.recovery.reusedOther", { amount: paymentAmountLabel }));
  }
  if (code === paymentErrorCodes.screenshotReusedSelf) {
    steps.push(uiText("payment.recovery.reusedSelf"));
  }
  if (code === paymentErrorCodes.screenshotPreviouslyRejected) {
    steps.push(uiText("payment.recovery.rejectedReuse"));
  }
  if (steps.length === 0) {
    steps.push(uiText("payment.recovery.defaultFresh", { amount: paymentAmountLabel }));
    steps.push(uiText("payment.recovery.defaultRetry"));
  }
  return steps;
}

export function isPaymentAmountMismatch({ paymentData, expectedPaymentAmount, amountField, upiLinkField }) {
  if (!paymentData) return false;
  if (!Number.isFinite(expectedPaymentAmount) || expectedPaymentAmount <= 0) return false;

  const amountValue = Number(paymentData?.[amountField]);
  if (Number.isFinite(amountValue)) {
    return Math.abs(amountValue - expectedPaymentAmount) > 0.001;
  }
  const link = String(paymentData?.[upiLinkField] || "");
  const match = link.match(/[?&]am=([^&]+)/i);
  if (!match) return false;
  const parsed = Number(decodeURIComponent(match[1]));
  if (!Number.isFinite(parsed)) return false;
  return Math.abs(parsed - expectedPaymentAmount) > 0.001;
}

export function calculateBlurVariance(image) {
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
  return lap.reduce((a, b) => a + (b - mean) ** 2, 0) / lap.length;
}

export function validateScreenshotQuality({ file, calculateVariance, uiText, minWidth, minHeight, minVariance }) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const width = img.naturalWidth || img.width;
      const height = img.naturalHeight || img.height;
      const blurVariance = calculateVariance(img);
      URL.revokeObjectURL(url);

      if (width < minWidth || height < minHeight) {
        resolve({
          ok: false,
          message: uiText("payment.resolutionLow", { width, height, minWidth, minHeight }),
        });
        return;
      }
      if (blurVariance < minVariance) {
        resolve({ ok: false, message: uiText("payment.blurry") });
        return;
      }
      resolve({ ok: true, width, height, blurVariance });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ ok: false, message: uiText("payment.invalidImage") });
    };
    img.src = url;
  });
}

export function getServerRemainingMs(payload, timeRemainingField, expiresAtField) {
  const seconds = Number(payload?.[timeRemainingField]);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.max(0, Math.floor(seconds * 1000));
  }
  const expiresAt = payload?.[expiresAtField];
  if (expiresAt) {
    return Math.max(0, new Date(expiresAt).getTime() - Date.now());
  }
  return 0;
}

export function calculateTimerValues(expiresAt, totalDurationMs) {
  const remaining = Math.max(0, new Date(expiresAt).getTime() - Date.now());
  const safeDuration = Math.max(1000, totalDurationMs || 1000);
  return {
    remaining,
    progress: Math.max(0, (remaining / safeDuration) * 100),
  };
}

export function formatCountdown(ms, perSecondMs) {
  const totalSeconds = Math.ceil(ms / perSecondMs);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

export function getTimerColor(timerProgress) {
  if (timerProgress > 60) return "#27ae60";
  if (timerProgress > 30) return "#f39c12";
  return "#e74c3c";
}

export function getTimerButtonStyle(timerProgress) {
  const color = getTimerColor(timerProgress);
  return {
    border: `3px solid ${color}`,
    boxShadow: `0 0 10px ${color}40, 0 0 20px ${color}20`,
    animation: timerProgress <= 15 ? "timer-pulse 1s ease-in-out infinite" : "none",
  };
}

export function getQrContainerStyle(timerProgress) {
  const color = getTimerColor(timerProgress);
  const progressAngle = Math.max(0, Math.min(360, (timerProgress / 100) * 360));
  return {
    borderRadius: "16px",
    background: "var(--panel)",
    width: "100%",
    position: "relative",
    backgroundImage: `linear-gradient(var(--panel), var(--panel)), conic-gradient(from -90deg, ${color} 0deg ${progressAngle}deg, var(--border-light) ${progressAngle}deg 360deg)`,
    backgroundOrigin: "border-box",
    backgroundClip: "padding-box, border-box",
    border: "3px solid transparent",
    boxShadow: `0 0 20px ${color}30, 0 4px 12px rgba(0,0,0,0.1)`,
    transition: "box-shadow 0.5s ease, background 0.5s ease",
    animation: timerProgress <= 30 ? `qr-glow 1.5s ease-in-out infinite${timerProgress <= 15 ? ", timer-pulse 1s ease-in-out infinite" : ""}` : "none",
    overflow: "hidden",
  };
}
