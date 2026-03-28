import { SURVEY_API_FIELDS } from "../constants/fields";

export const SURVEY_LOAD_STATES = {
  idle: "idle",
  bootstrapping: "bootstrapping",
  awaitingNextImage: "awaiting-next-image",
  ready: "ready",
  error: "error",
};

function normalizeSurveyLoadState(value, fallback = SURVEY_LOAD_STATES.idle) {
  const normalized = String(value || "").trim();
  return Object.values(SURVEY_LOAD_STATES).includes(normalized) ? normalized : fallback;
}

function normalizeSurvey(value) {
  if (!value || typeof value !== "object") return null;
  const imageId = String(value[SURVEY_API_FIELDS.imageId] || value.image_id || value.imageId || "").trim();
  const imageUrl = String(
    value[SURVEY_API_FIELDS.url] || value[SURVEY_API_FIELDS.imageUrl] || value.image_url || value.imageUrl || ""
  ).trim();
  if (!imageId || !imageUrl) return null;
  return {
    ...value,
    [SURVEY_API_FIELDS.imageId]: imageId,
    [SURVEY_API_FIELDS.url]: imageUrl,
  };
}

function appendShownImage(shownImages, survey) {
  const imageId = normalizeSurvey(survey)?.[SURVEY_API_FIELDS.imageId];
  if (!imageId) return Array.isArray(shownImages) ? shownImages : [];
  const safeShownImages = Array.isArray(shownImages) ? shownImages : [];
  return safeShownImages.includes(imageId) ? safeShownImages : [...safeShownImages, imageId];
}

export const SURVEY_EVENT_TYPES = {
  HYDRATE: "HYDRATE",
  FETCH_STARTED: "FETCH_STARTED",
  FETCH_SUCCEEDED: "FETCH_SUCCEEDED",
  FETCH_FAILED: "FETCH_FAILED",
  SUBMIT_SUCCEEDED: "SUBMIT_SUCCEEDED",
  SUBMIT_FAILED: "SUBMIT_FAILED",
  PREPARE_NEXT_SURVEY: "PREPARE_NEXT_SURVEY",
  HIDE_CONFETTI: "HIDE_CONFETTI",
  RESET: "RESET",
};

export function createSurveyState(initial = null) {
  const survey = normalizeSurvey(initial?.survey);
  return {
    survey,
    loadState: survey
      ? SURVEY_LOAD_STATES.ready
      : normalizeSurveyLoadState(initial?.loadState, SURVEY_LOAD_STATES.idle),
    surveyCompleted: Math.max(0, Number(initial?.surveyCompleted) || 0),
    surveyFeedbackReady: initial?.surveyFeedbackReady === true,
    lastSubmissionSucceeded: initial?.lastSubmissionSucceeded === true,
    shownImages: Array.isArray(initial?.shownImages) ? initial.shownImages : [],
    imageError: null,
    showConfetti: false,
    isFetchingImage: false,
    isTransitioningToNext: false,
  };
}

export function areSurveysEqual(left, right) {
  const normalizedLeft = normalizeSurvey(left);
  const normalizedRight = normalizeSurvey(right);
  if (!normalizedLeft && !normalizedRight) return true;
  if (!normalizedLeft || !normalizedRight) return false;
  return (
    normalizedLeft[SURVEY_API_FIELDS.imageId] === normalizedRight[SURVEY_API_FIELDS.imageId]
    && normalizedLeft[SURVEY_API_FIELDS.url] === normalizedRight[SURVEY_API_FIELDS.url]
  );
}

export function surveyStateReducer(state, event) {
  switch (event?.type) {
    case SURVEY_EVENT_TYPES.HYDRATE: {
      const nextSurvey = normalizeSurvey(event.survey);
      const nextLoadState = nextSurvey
        ? SURVEY_LOAD_STATES.ready
        : normalizeSurveyLoadState(event.loadState, state.loadState);
      const nextShownImages = Array.isArray(event.shownImages) && event.shownImages.length > 0
        ? event.shownImages
        : appendShownImage(state.shownImages, nextSurvey);
      return {
        ...state,
        loadState: nextLoadState,
        ...(nextSurvey && !areSurveysEqual(state.survey, nextSurvey)
          ? { survey: nextSurvey, imageError: null }
          : {}),
        ...(!nextSurvey && event.replaceSurvey === true ? { survey: null } : {}),
        ...(Number.isFinite(event.surveyCompleted)
          ? { surveyCompleted: Math.max(state.surveyCompleted, Number(event.surveyCompleted) || 0) }
          : {}),
        ...(event.surveyFeedbackReady === true ? { surveyFeedbackReady: true } : {}),
        ...(event.lastSubmissionSucceeded === true ? { lastSubmissionSucceeded: true } : {}),
        ...(nextShownImages.length > 0 ? { shownImages: nextShownImages } : {}),
        ...((nextSurvey || nextLoadState !== SURVEY_LOAD_STATES.awaitingNextImage)
          ? { isTransitioningToNext: false }
          : {}),
      };
    }
    case SURVEY_EVENT_TYPES.FETCH_STARTED:
      return {
        ...state,
        loadState: event.clearCurrent ? SURVEY_LOAD_STATES.awaitingNextImage : SURVEY_LOAD_STATES.bootstrapping,
        isFetchingImage: true,
        isTransitioningToNext: Boolean(event.clearCurrent),
        surveyFeedbackReady: false,
        lastSubmissionSucceeded: false,
        imageError: null,
        ...(event.clearCurrent ? { survey: null } : {}),
      };
    case SURVEY_EVENT_TYPES.FETCH_SUCCEEDED: {
      const nextSurvey = normalizeSurvey(event.survey);
      return {
        ...state,
        loadState: nextSurvey ? SURVEY_LOAD_STATES.ready : SURVEY_LOAD_STATES.error,
        isFetchingImage: false,
        isTransitioningToNext: false,
        imageError: null,
        survey: nextSurvey,
        shownImages: appendShownImage(state.shownImages, nextSurvey),
      };
    }
    case SURVEY_EVENT_TYPES.FETCH_FAILED:
      return {
        ...state,
        loadState: SURVEY_LOAD_STATES.error,
        isFetchingImage: false,
        isTransitioningToNext: false,
        survey: event.keepSurvey ? state.survey : null,
        imageError: event.imageError || "image_unavailable",
      };
    case SURVEY_EVENT_TYPES.SUBMIT_SUCCEEDED:
      return {
        ...state,
        surveyCompleted: state.surveyCompleted + 1,
        lastSubmissionSucceeded: true,
        surveyFeedbackReady: true,
        showConfetti: true,
      };
    case SURVEY_EVENT_TYPES.SUBMIT_FAILED:
      return {
        ...state,
        lastSubmissionSucceeded: false,
      };
    case SURVEY_EVENT_TYPES.PREPARE_NEXT_SURVEY:
      return {
        ...state,
        loadState: SURVEY_LOAD_STATES.awaitingNextImage,
        survey: null,
        surveyFeedbackReady: false,
        lastSubmissionSucceeded: false,
        imageError: null,
        isTransitioningToNext: true,
      };
    case SURVEY_EVENT_TYPES.HIDE_CONFETTI:
      return {
        ...state,
        showConfetti: false,
      };
    case SURVEY_EVENT_TYPES.RESET:
      return createSurveyState(event.nextState);
    default:
      return state;
  }
}

export { normalizeSurvey };
