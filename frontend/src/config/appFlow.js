export const APP_FLOW = {
  stages: {
    consent: "consent",
    userDetails: "user-details",
    survey: "survey",
    postSurvey: "post-survey",
  },
  toastTypes: {
    info: "info",
    success: "success",
    warning: "warning",
    error: "error",
  },
};

export const APP_STAGE_ORDER = [
  APP_FLOW.stages.consent,
  APP_FLOW.stages.userDetails,
  APP_FLOW.stages.survey,
  APP_FLOW.stages.postSurvey,
];

export function normalizeAppStage(stage) {
  const value = String(stage || "").trim();
  if (APP_STAGE_ORDER.includes(value)) {
    return value;
  }
  return APP_FLOW.stages.consent;
}
