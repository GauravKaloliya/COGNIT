import { runtimeConfig } from "../config/runtime";
import {
  forEachStorageArea,
  forEachStoredKey,
  readExpiringValue,
  removeStoredKey,
  writeExpiringValue,
} from "./storage";

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

export const clearAllSurveyDraftsForUser = (publicId) => {
  const scope = String(publicId || "anon").trim() || "anon";
  const perImagePrefix = `${runtimeConfig.storageKeys.surveyDraftPrefix}_${scope}_`;
  const activeKey = getActiveSurveyDraftKey(scope);
  forEachStorageArea((area) => {
    removeStoredKey(activeKey, area);
    forEachStoredKey(area, (key) => {
      if (!key) return;
      if (key.startsWith(perImagePrefix)) {
        removeStoredKey(key, area);
      }
    });
  });
};
