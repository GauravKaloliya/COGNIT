import { runtimeConfig } from "../config/runtime";
import { getErrorMessage } from "./errorRegistry";
import { REGEX_PATTERNS } from "../constants/patterns";

export const sanitizeUsername = (value) => value.replace(/[^a-zA-Z0-9_]/g, "");

export function prioritizeEnglishOptions(items = []) {
  const list = Array.isArray(items) ? items : [];
  const isEnglish = (item) => {
    if (!item) return false;
    if (typeof item === "string") return item.trim().toLowerCase() === "english";
    const value = String(item.value || "").trim().toLowerCase();
    const label = String(item.label || "").trim().toLowerCase();
    return value === "english" || label === "english";
  };
  const isOther = (item) => {
    if (!item) return false;
    if (typeof item === "string") return item.trim().toLowerCase() === "other";
    const value = String(item.value || "").trim().toLowerCase();
    const label = String(item.label || "").trim().toLowerCase();
    return value === "other" || label === "other";
  };
  const english = list.filter(isEnglish);
  const otherItems = list.filter(isOther);
  const remaining = list.filter((item) => !isEnglish(item) && !isOther(item));
  return [...english, ...remaining, ...otherItems];
}

export function buildUserDetailsValidators({ usernameMinLength, ageMin, ageMax, locationMinLength }) {
  return {
    validateUsernameInput(rawUsername) {
      const value = String(rawUsername ?? "").trim();
      if (!value || value.length < usernameMinLength) {
        return getErrorMessage("VAL_001_0010", "en", { min: usernameMinLength });
      }
      if (!REGEX_PATTERNS.username.test(value)) {
        return getErrorMessage("VAL_001_0011");
      }
      return "";
    },
    validateEmailInput(rawEmail) {
      const value = String(rawEmail ?? "").trim().toLowerCase();
      if (!value) return getErrorMessage("VAL_001_0012");
      if (!REGEX_PATTERNS.email.test(value)) return getErrorMessage("VAL_001_0013");
      const domain = value.split("@")[1];
      if (!runtimeConfig.allowedEmailDomains.includes(domain)) return getErrorMessage("VAL_001_0014");
      return "";
    },
    validateGenderInput(rawGender) {
      return String(rawGender ?? "").trim() ? "" : getErrorMessage("VAL_001_0017");
    },
    validateAgeInput(rawAge) {
      const trimmed = String(rawAge ?? "").trim();
      if (!trimmed) return getErrorMessage("VAL_001_0018");
      if (!REGEX_PATTERNS.digitsOnly.test(trimmed)) return getErrorMessage("VAL_001_0019", "en", { min: ageMin, max: ageMax });
      const ageNum = Number(trimmed);
      if (!Number.isInteger(ageNum) || ageNum < ageMin || ageNum > ageMax) {
        return getErrorMessage("VAL_001_0019", "en", { min: ageMin, max: ageMax });
      }
      return "";
    },
    validateLocationInput(rawLocation) {
      const value = String(rawLocation ?? "").trim();
      return value.length >= locationMinLength ? "" : getErrorMessage("VAL_001_0020");
    },
    validateLanguageInput(rawLanguage) {
      return String(rawLanguage ?? "").trim() ? "" : getErrorMessage("VAL_001_0021");
    },
    validatePriorExperienceInput(rawPriorExperience) {
      return String(rawPriorExperience ?? "").trim() ? "" : getErrorMessage("VAL_001_0022");
    },
  };
}

export function sanitizeLocationValue(value) {
  const raw = String(value ?? "");
  if (!raw.trim()) return "";
  const trimmed = raw.trim();
  const coordinateOnly = /^\s*[-+]?\d+(\.\d+)?\s*,\s*[-+]?\d+(\.\d+)?(\s*,\s*[-+]?\d+(\.\d+)?)?\s*$/.test(trimmed);
  return coordinateOnly ? "" : raw;
}
