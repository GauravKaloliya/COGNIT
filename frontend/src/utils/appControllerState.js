import { runtimeConfig } from "../config/runtime";
import { APP_FLOW, APP_STAGE_ORDER, normalizeAppStage } from "../config/appFlow";
import { REGEX_PATTERNS } from "../constants/patterns";
import { createFallbackUuid } from "../constants/ids";
import { makeScopedKey, readExpiringValue, writeExpiringValue } from "./storage";

const CORE_STATE_STORAGE_AREA = "local";
const CORE_STATE_SCHEMA_VERSION = runtimeConfig.uiStateSchemaVersion;
const CORE_STATE_TTL_MS = runtimeConfig.uiStateTtlMs;
const MIN_SURVEYS_BEFORE_FINISH = Math.max(1, Number(runtimeConfig.requiredSurveySubmissions || 2));

export function getScopeId(publicId) {
  return String(publicId || "").trim();
}

export function readCoreValue(baseKey, fallback, scopeId, { ttlMs } = {}) {
  const resolvedScope = getScopeId(scopeId);
  if (!resolvedScope) return fallback;
  const scopedKey = makeScopedKey(baseKey, resolvedScope);
  const options = { schemaVersion: CORE_STATE_SCHEMA_VERSION, ttlMs: ttlMs ?? CORE_STATE_TTL_MS };
  return readExpiringValue(scopedKey, fallback, { area: CORE_STATE_STORAGE_AREA, ...options });
}

export function writeCoreValue(baseKey, value, scopeId, { ttlMs } = {}) {
  const resolvedScope = getScopeId(scopeId);
  if (!resolvedScope) return;
  const scopedKey = makeScopedKey(baseKey, resolvedScope);
  writeExpiringValue(scopedKey, value, {
    area: CORE_STATE_STORAGE_AREA,
    schemaVersion: CORE_STATE_SCHEMA_VERSION,
    ttlMs: ttlMs ?? CORE_STATE_TTL_MS,
  });
}

export function createClientId() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return createFallbackUuid();
}

export function validateStageTransition(currentStage, targetStage) {
  const normalizedCurrent = normalizeAppStage(currentStage);
  const normalizedTarget = normalizeAppStage(targetStage);
  const currentIndex = APP_STAGE_ORDER.indexOf(normalizedCurrent);
  const targetIndex = APP_STAGE_ORDER.indexOf(normalizedTarget);
  if (targetIndex <= currentIndex) return true;
  switch (normalizedCurrent) {
    case APP_FLOW.stages.consent:
      return normalizedTarget === APP_FLOW.stages.userDetails;
    case APP_FLOW.stages.userDetails:
      return normalizedTarget === APP_FLOW.stages.survey;
    case APP_FLOW.stages.survey:
      return normalizedTarget === APP_FLOW.stages.postSurvey;
    default:
      return false;
  }
}

export function isDemographicsComplete(demographics) {
  const username = String(demographics?.username || "").trim();
  const email = String(demographics?.email || "").trim().toLowerCase();
  const gender = String(demographics?.gender_code || "").trim();
  const ageRaw = String(demographics?.age || "").trim();
  const location = String(demographics?.location || "").trim();
  const language = String(demographics?.language_code || "").trim();
  const prior = String(demographics?.prior_experience || "").trim();
  const usernameOk = username.length >= runtimeConfig.usernameMinLength;
  const emailOk = REGEX_PATTERNS.email.test(email);
  const ageNum = Number(ageRaw);
  const ageOk = Number.isFinite(ageNum) && ageNum >= runtimeConfig.ageMin && ageNum <= runtimeConfig.ageMax;
  const locationOk = location.length >= runtimeConfig.locationMinLength;
  return usernameOk && emailOk && gender && ageOk && locationOk && language && prior;
}

export function hasAnyDemographicsValue(demographics) {
  if (!demographics) return false;
  const fields = [
    demographics.username,
    demographics.email,
    demographics.gender_code,
    demographics.age,
    demographics.location,
    demographics.language_code,
    demographics.prior_experience,
  ];
  return fields.some((value) => String(value || "").trim().length > 0);
}

export function deriveMaxAllowedStage({
  currentStage,
  consentGiven,
  hasParticipant,
  userDetailsSubmitted,
  demographicsComplete,
  emailVerified,
  hasSurveyInProgress = false,
  surveyCompleted,
  surveyFeedbackReady,
  lastSubmissionSucceeded,
}) {
  const normalizedCurrent = normalizeAppStage(currentStage);
  if (!consentGiven) return APP_FLOW.stages.consent;
  if (hasSurveyInProgress && hasParticipant && userDetailsSubmitted && emailVerified) {
    if (surveyFeedbackReady && lastSubmissionSucceeded) return APP_FLOW.stages.postSurvey;
    return APP_FLOW.stages.survey;
  }
  if (!hasParticipant || !userDetailsSubmitted || !demographicsComplete) return APP_FLOW.stages.userDetails;
  if (!emailVerified) return APP_FLOW.stages.userDetails;
  if (surveyFeedbackReady && !lastSubmissionSucceeded) return APP_FLOW.stages.survey;
  if (surveyCompleted < MIN_SURVEYS_BEFORE_FINISH) return APP_FLOW.stages.survey;
  if (surveyFeedbackReady && lastSubmissionSucceeded) return APP_FLOW.stages.postSurvey;
  if (normalizedCurrent === APP_FLOW.stages.postSurvey && surveyFeedbackReady) return APP_FLOW.stages.postSurvey;
  return APP_FLOW.stages.survey;
}
