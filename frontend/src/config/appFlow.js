export const APP_FLOW = {
  stages: {
    consent: "consent",
    userDetails: "user-details",
    payment: "payment",
    survey: "survey",
    finished: "finished",
  },
  paymentSubStages: {
    content: "content",
    link: "link",
  },
  paymentStatus: {
    pending: "pending",
    expired: "expired",
    rejectedFraud: "rejected_fraud",
    success: "success",
    processing: "processing",
    failed: "failed",
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
  APP_FLOW.stages.payment,
  APP_FLOW.stages.survey,
  APP_FLOW.stages.finished,
];
