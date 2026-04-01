export const SURVEY_IMAGE_PHASES = {
  idle: "idle",
  loading: "loading",
  recovering: "recovering",
  ready: "ready",
  failed: "failed",
  terminal: "terminal",
};

export const SURVEY_IMAGE_EVENT_TYPES = {
  SURVEY_CHANGED: "SURVEY_CHANGED",
  LOAD_STARTED: "LOAD_STARTED",
  LOAD_SUCCEEDED: "LOAD_SUCCEEDED",
  LOAD_FAILED: "LOAD_FAILED",
  AUTO_RETRY_SCHEDULED: "AUTO_RETRY_SCHEDULED",
  REPLACEMENT_STARTED: "REPLACEMENT_STARTED",
  TERMINAL_FAILURE: "TERMINAL_FAILURE",
  RESET: "RESET",
};

export function createSurveyImageState() {
  return {
    phase: SURVEY_IMAGE_PHASES.idle,
    retryAttempt: 0,
    replacementAttempt: 0,
    lastFailureReason: "",
    lastFailureMeta: null,
  };
}

export function surveyImageStateReducer(state, event) {
  switch (event?.type) {
    case SURVEY_IMAGE_EVENT_TYPES.SURVEY_CHANGED:
      return {
        phase: event.canLoad ? SURVEY_IMAGE_PHASES.loading : SURVEY_IMAGE_PHASES.idle,
        retryAttempt: 0,
        replacementAttempt: 0,
        lastFailureReason: "",
        lastFailureMeta: null,
      };
    case SURVEY_IMAGE_EVENT_TYPES.LOAD_STARTED:
      return {
        ...state,
        phase: SURVEY_IMAGE_PHASES.loading,
      };
    case SURVEY_IMAGE_EVENT_TYPES.LOAD_SUCCEEDED:
      return {
        phase: SURVEY_IMAGE_PHASES.ready,
        retryAttempt: 0,
        replacementAttempt: 0,
        lastFailureReason: "",
        lastFailureMeta: null,
      };
    case SURVEY_IMAGE_EVENT_TYPES.AUTO_RETRY_SCHEDULED:
      return {
        phase: SURVEY_IMAGE_PHASES.recovering,
        retryAttempt: Math.max(1, Number(event.retryAttempt) || 1),
        replacementAttempt: Math.max(0, Number(state.replacementAttempt) || 0),
        lastFailureReason: String(event.reason || "").trim(),
        lastFailureMeta: event.meta || null,
      };
    case SURVEY_IMAGE_EVENT_TYPES.LOAD_FAILED:
      return {
        phase: SURVEY_IMAGE_PHASES.failed,
        retryAttempt: Math.max(1, Number(event.retryAttempt) || state.retryAttempt || 1),
        replacementAttempt: Math.max(0, Number(state.replacementAttempt) || 0),
        lastFailureReason: String(event.reason || state.lastFailureReason || "").trim(),
        lastFailureMeta: event.meta || state.lastFailureMeta || null,
      };
    case SURVEY_IMAGE_EVENT_TYPES.REPLACEMENT_STARTED:
      return {
        phase: SURVEY_IMAGE_PHASES.recovering,
        retryAttempt: 0,
        replacementAttempt: Math.max(1, Number(event.replacementAttempt) || state.replacementAttempt || 1),
        lastFailureReason: String(event.reason || state.lastFailureReason || "").trim(),
        lastFailureMeta: event.meta || state.lastFailureMeta || null,
      };
    case SURVEY_IMAGE_EVENT_TYPES.TERMINAL_FAILURE:
      return {
        phase: SURVEY_IMAGE_PHASES.terminal,
        retryAttempt: Math.max(0, Number(state.retryAttempt) || 0),
        replacementAttempt: Math.max(0, Number(state.replacementAttempt) || 0),
        lastFailureReason: String(event.reason || state.lastFailureReason || "").trim(),
        lastFailureMeta: event.meta || state.lastFailureMeta || null,
      };
    case SURVEY_IMAGE_EVENT_TYPES.RESET:
      return createSurveyImageState();
    default:
      return state;
  }
}

export function buildReloadableSurveyImageSrc(imageSrc, reloadToken) {
  const normalizedImageSrc = String(imageSrc || "").trim();
  if (!normalizedImageSrc) return "";
  if (!Number.isFinite(reloadToken) || reloadToken <= 0) return normalizedImageSrc;
  const separator = normalizedImageSrc.includes("?") ? "&" : "?";
  return `${normalizedImageSrc}${separator}reload=${reloadToken}`;
}
