import { runtimeConfig } from "../config/runtime";
import { APP_FLOW, APP_STAGE_ORDER } from "../config/appFlow";
import { REGEX_PATTERNS } from "../constants/patterns";
import { createFallbackUuid } from "../constants/ids";
import { makeScopedKey, readExpiringValue, writeExpiringValue } from "./storage";

const CORE_STATE_STORAGE_AREA = "local";
const CORE_STATE_STORAGE_AREA_SESSION = "session";
const CORE_STATE_SCHEMA_VERSION = runtimeConfig.uiStateSchemaVersion;
const CORE_STATE_TTL_MS = runtimeConfig.uiStateTtlMs;
const CORE_SCOPE_ANON = "anon";
const MIN_SURVEYS_BEFORE_FINISH = 1;

export function getScopeId(publicId) {
  const value = String(publicId || "").trim();
  return value || CORE_SCOPE_ANON;
}

export function readCoreValue(baseKey, fallback, scopeId, { ttlMs } = {}) {
  const scopedKey = makeScopedKey(baseKey, getScopeId(scopeId));
  const options = { schemaVersion: CORE_STATE_SCHEMA_VERSION, ttlMs: ttlMs ?? CORE_STATE_TTL_MS };
  const localScoped = readExpiringValue(scopedKey, undefined, { area: CORE_STATE_STORAGE_AREA, ...options });
  if (localScoped !== undefined) return localScoped;
  const sessionScoped = readExpiringValue(scopedKey, undefined, { area: CORE_STATE_STORAGE_AREA_SESSION, ...options });
  if (sessionScoped !== undefined) return sessionScoped;
  const localUnscoped = readExpiringValue(baseKey, undefined, { area: CORE_STATE_STORAGE_AREA, ...options });
  if (localUnscoped !== undefined) return localUnscoped;
  const sessionUnscoped = readExpiringValue(baseKey, undefined, { area: CORE_STATE_STORAGE_AREA_SESSION, ...options });
  if (sessionUnscoped !== undefined) return sessionUnscoped;
  return fallback;
}

export function writeCoreValue(baseKey, value, scopeId, { ttlMs } = {}) {
  const scopedKey = makeScopedKey(baseKey, getScopeId(scopeId));
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

export function validateStageTransition(currentStage, targetStage, paymentVerified = false) {
  const currentIndex = APP_STAGE_ORDER.indexOf(currentStage);
  const targetIndex = APP_STAGE_ORDER.indexOf(targetStage);
  if (targetIndex <= currentIndex) return true;
  switch (currentStage) {
    case APP_FLOW.stages.consent:
      return targetStage === APP_FLOW.stages.userDetails;
    case APP_FLOW.stages.userDetails:
      return targetStage === APP_FLOW.stages.payment;
    case APP_FLOW.stages.payment:
      return targetStage === APP_FLOW.stages.survey && paymentVerified;
    case APP_FLOW.stages.survey:
      return targetStage === APP_FLOW.stages.finished;
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
  paymentVerified,
  surveyCompleted,
  surveyFeedbackReady,
  lastSubmissionSucceeded,
}) {
  if (!consentGiven) return APP_FLOW.stages.consent;
  if (!hasParticipant || !userDetailsSubmitted || !demographicsComplete) return APP_FLOW.stages.userDetails;
  if (!emailVerified) return APP_FLOW.stages.userDetails;
  if (!paymentVerified) return APP_FLOW.stages.payment;
  if (surveyFeedbackReady && !lastSubmissionSucceeded) return APP_FLOW.stages.survey;
  if (surveyCompleted < MIN_SURVEYS_BEFORE_FINISH) return APP_FLOW.stages.survey;
  if (currentStage === APP_FLOW.stages.finished) return APP_FLOW.stages.finished;
  return APP_FLOW.stages.survey;
}
