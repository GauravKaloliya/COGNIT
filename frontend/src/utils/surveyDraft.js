import { runtimeConfig } from "../config/runtime";
import { readExpiringValue, writeExpiringValue } from "./storage";

export const SURVEY_DRAFT_SCHEMA_VERSION = runtimeConfig.surveyDraftSchemaVersion;
export const SURVEY_DRAFT_TTL_MS = runtimeConfig.uiStateTtlMs;

export const getSurveyDraftKey = (publicId, imageId) => {
  const prefix = runtimeConfig.storageKeys.surveyDraftPrefix;
  return imageId ? `${prefix}_${publicId || "anon"}_${imageId}` : null;
};

export const getActiveSurveyDraftKey = (publicId) => {
  const prefix = runtimeConfig.storageKeys.surveyDraftActivePrefix;
  return `${prefix}_${publicId || "anon"}`;
};

export const readSurveyDraft = (key) => {
  if (!key) return null;
  const value = readExpiringValue(key, null, {
    area: "local",
    schemaVersion: SURVEY_DRAFT_SCHEMA_VERSION,
    ttlMs: SURVEY_DRAFT_TTL_MS,
  });
  return value && typeof value === "object" ? value : null;
};

export const writeSurveyDraft = (key, data) => {
  if (!key) return;
  writeExpiringValue(key, data, {
    area: "local",
    schemaVersion: SURVEY_DRAFT_SCHEMA_VERSION,
    ttlMs: SURVEY_DRAFT_TTL_MS,
  });
};
