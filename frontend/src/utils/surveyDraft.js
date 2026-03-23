import { runtimeConfig } from "../config/runtime";
import { readJsonValue, removeStoredKey, writeJsonValue } from "./storage";

export const SURVEY_DRAFT_SCHEMA_VERSION = runtimeConfig.surveyDraftSchemaVersion;

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

  const unwrap = (value) => {
    if (!value || typeof value !== "object") return null;
    if ("__schema_version" in value && "expires_at" in value && "data" in value) return value.data || null;
    return value;
  };

  const local = unwrap(readJsonValue(key, null, "local"));
  if (local) return local;

  const session = unwrap(readJsonValue(key, null, "session"));
  if (session) {
    try {
      writeJsonValue(key, session, "local");
      removeStoredKey(key, "session");
    } catch {
      // Ignore migration failures.
    }
  }
  return session || null;
};

export const writeSurveyDraft = (key, data) => {
  if (!key) return;
  writeJsonValue(key, {
    __schema_version: SURVEY_DRAFT_SCHEMA_VERSION,
    saved_at: Date.now(),
    data,
  }, "local");
};
