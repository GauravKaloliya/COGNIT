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
  const scope = String(publicId || "").trim();
  const prefix = runtimeConfig.storageKeys.surveyDraftPrefix;
  if (!scope || !imageId) return null;
  return `${prefix}_${scope}_${imageId}`;
};

export const getActiveSurveyDraftKey = (publicId) => {
  const scope = String(publicId || "").trim();
  const prefix = runtimeConfig.storageKeys.surveyDraftActivePrefix;
  if (!scope) return null;
  return `${prefix}_${scope}`;
};

export const readSurveyDraft = (key) => {
  if (!key) return null;
  for (const area of ["session", "local"]) {
    const value = readExpiringValue(key, null, {
      area,
      schemaVersion: SURVEY_DRAFT_SCHEMA_VERSION,
      ttlMs: SURVEY_DRAFT_TTL_MS,
    });
    if (value && typeof value === "object") {
      return value;
    }
  }
  return null;
};

export const writeSurveyDraft = (key, data) => {
  if (!key) return;
  for (const area of ["local", "session"]) {
    writeExpiringValue(key, data, {
      area,
      schemaVersion: SURVEY_DRAFT_SCHEMA_VERSION,
      ttlMs: SURVEY_DRAFT_TTL_MS,
    });
  }
};

export const clearAllSurveyDraftsForUser = (publicId) => {
  const scope = String(publicId || "").trim();
  if (!scope) return;
  const perImagePrefix = `${runtimeConfig.storageKeys.surveyDraftPrefix}_${scope}_`;
  const activeKey = getActiveSurveyDraftKey(scope);
  forEachStorageArea((area) => {
    if (activeKey) {
      removeStoredKey(activeKey, area);
    }
    forEachStoredKey(area, (key) => {
      if (!key) return;
      if (key.startsWith(perImagePrefix)) {
        removeStoredKey(key, area);
      }
    });
  });
};
