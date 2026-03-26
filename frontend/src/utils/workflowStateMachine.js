import { APP_FLOW, normalizeAppStage } from "../config/appFlow";
import { isDemographicsComplete } from "./appControllerState";

export const WORKFLOW_EVENT_TYPES = {
  PATCH: "PATCH",
  HYDRATE_SCOPE: "HYDRATE_SCOPE",
  CONSENT_ACCEPTED: "CONSENT_ACCEPTED",
  PARTICIPANT_CREATED: "PARTICIPANT_CREATED",
  EMAIL_VERIFIED: "EMAIL_VERIFIED",
  ADVANCE_TO_POST_SURVEY: "ADVANCE_TO_POST_SURVEY",
  RESET_TO_CONSENT: "RESET_TO_CONSENT",
  RECONCILE_STAGE: "RECONCILE_STAGE",
};

export const EMPTY_DEMOGRAPHICS = {
  username: "",
  email: "",
  gender_code: "",
  age: "",
  location: "",
  language_code: "",
  prior_experience: "",
};

export function createWorkflowState(snapshot = null) {
  return {
    publicId: snapshot?.publicId || "",
    sessionId: snapshot?.sessionId || "",
    stage: normalizeAppStage(snapshot?.stage || APP_FLOW.stages.consent),
    consentGiven: snapshot?.consentGiven === true,
    userDetailsSubmitted: snapshot?.userDetailsSubmitted === true,
    emailVerified: snapshot?.emailVerified === true,
    demographics: snapshot?.demographics || EMPTY_DEMOGRAPHICS,
  };
}

function resolveWorkflowStage(state, surveyContext = {}) {
  const hasParticipant = Boolean(state.publicId);
  const demographicsComplete = isDemographicsComplete(state.demographics);
  const hasSurveyInProgress = Boolean(surveyContext.hasSurveyInProgress);
  const surveyCompleted = Math.max(0, Number(surveyContext.surveyCompleted) || 0);
  const surveyFeedbackReady = surveyContext.surveyFeedbackReady === true;
  const lastSubmissionSucceeded = surveyContext.lastSubmissionSucceeded === true;

  if (!state.consentGiven) return APP_FLOW.stages.consent;
  if (!hasParticipant || !state.userDetailsSubmitted || !demographicsComplete) return APP_FLOW.stages.userDetails;
  if (!state.emailVerified) return APP_FLOW.stages.userDetails;
  if (surveyFeedbackReady && lastSubmissionSucceeded) return APP_FLOW.stages.postSurvey;
  if (hasSurveyInProgress) return APP_FLOW.stages.survey;
  if (surveyCompleted > 0 && state.stage === APP_FLOW.stages.postSurvey) return APP_FLOW.stages.postSurvey;
  return APP_FLOW.stages.survey;
}

export function workflowStateReducer(state, event) {
  switch (event?.type) {
    case WORKFLOW_EVENT_TYPES.PATCH: {
      const patch = typeof event.patch === "function" ? event.patch(state) : event.patch;
      if (!patch || typeof patch !== "object") return state;
      return {
        ...state,
        ...patch,
        ...(Object.prototype.hasOwnProperty.call(patch, "stage")
          ? { stage: normalizeAppStage(patch.stage) }
          : {}),
      };
    }
    case WORKFLOW_EVENT_TYPES.HYDRATE_SCOPE:
      return createWorkflowState({ ...state, ...(event.snapshot || {}) });
    case WORKFLOW_EVENT_TYPES.CONSENT_ACCEPTED:
      return {
        ...state,
        consentGiven: true,
        stage: APP_FLOW.stages.userDetails,
      };
    case WORKFLOW_EVENT_TYPES.PARTICIPANT_CREATED:
      return {
        ...state,
        ...(event.publicId ? { publicId: String(event.publicId).trim() } : {}),
        ...(event.sessionId ? { sessionId: String(event.sessionId).trim() } : {}),
        userDetailsSubmitted: true,
        emailVerified: false,
        stage: APP_FLOW.stages.userDetails,
      };
    case WORKFLOW_EVENT_TYPES.EMAIL_VERIFIED:
      return {
        ...state,
        emailVerified: true,
        stage: APP_FLOW.stages.survey,
      };
    case WORKFLOW_EVENT_TYPES.ADVANCE_TO_POST_SURVEY:
      return {
        ...state,
        stage: APP_FLOW.stages.postSurvey,
      };
    case WORKFLOW_EVENT_TYPES.RESET_TO_CONSENT:
      return createWorkflowState(event.nextState);
    case WORKFLOW_EVENT_TYPES.RECONCILE_STAGE: {
      const nextStage = resolveWorkflowStage(state, event.surveyContext);
      if (nextStage === state.stage) return state;
      return {
        ...state,
        stage: nextStage,
      };
    }
    default:
      return state;
  }
}
