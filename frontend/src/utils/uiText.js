const LANG = "en";

const TEXT = {
  en: {
    "status.pleaseWait": "Please wait",
    "status.loadingApp": "Loading C.O.G.N.I.T.",
    "status.checkingConnectivity": "Checking system connectivity...",
    "common.tryAgainIn": "Try again in {seconds}s.",
    "payment.creating": "Creating Payment",
    "payment.pleaseWait": "Please wait...",
    "payment.tryAgainIn": "Try again in {seconds}s.",
    "payment.clearScreenshot": "Remove screenshot",
    "survey.loadingImage": "Loading image...",
    "survey.retrying": "Retrying...",
    "survey.retry": "Retry",
    "survey.submitShortcut": "Tip: Press Ctrl+Enter (Cmd+Enter on Mac) to submit.",
    "survey.autosave": "Your response is auto-saved in this tab."
  }
};

export function uiText(key, params = {}) {
  const pack = TEXT[LANG] || TEXT.en;
  const fallback = TEXT.en[key] || key;
  let value = pack[key] || fallback;
  Object.keys(params).forEach((k) => {
    value = value.replace(`{${k}}`, String(params[k]));
  });
  return value;
}
