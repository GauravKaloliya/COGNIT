export const APP_FLOW = {
  stages: {
    consent: "consent",
    userDetails: "user-details",
    survey: "survey",
    finished: "finished",
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
  APP_FLOW.stages.finished,
];
