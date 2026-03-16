import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { endpoints } from "../utils/api.js";
import { getErrorMessage } from "../utils/errorRegistry.js";
import { runtimeConfig } from "../config/runtime";
import { uiText } from "../utils/uiText";
import { useOnlineStatus } from "./useOnlineStatus";
import { useRetryCountdown } from "./useRetryCountdown";
import { clearScheduledTimeout, scheduleTimeout } from "../utils/timing";
import { ALLOWED_EMAIL_DOMAINS } from "../content/userDetailsOptions";
import { getPendingFlag, readJsonValue, readStoredMeta, removeStoredKey, setPendingFlag, writeJsonValue } from "../utils/storage";
import {
  GEOLOCATION_ERROR_CODES,
  GEOLOCATION_MODES,
  REVERSE_GEOCODE_FIELDS,
  USER_DETAILS_DUPLICATE_ERROR_CODES,
  USER_DETAILS_ERROR_CODE_TO_FIELD,
  USER_DETAIL_FIELDS,
} from "../constants/userDetails";
import { REQUEST_CODES } from "../constants/request";
import { REGEX_PATTERNS, STRING_PREFIXES } from "../constants/patterns";

const USERNAME_MIN_LENGTH = runtimeConfig.usernameMinLength;
const AGE_MIN = runtimeConfig.ageMin;
const AGE_MAX = runtimeConfig.ageMax;
const LOCATION_MIN_LENGTH = runtimeConfig.locationMinLength;
const MAX_AUTO_LOCATION_ATTEMPTS = 2;
const AUTO_LOCATION_PROMPT_KEY = runtimeConfig.storageKeys.autoLocationPrompt;
const AUTO_LOCATION_PROMPT_DEDUPE_MS = 2000;
const REVERSE_GEOCODE_STATE_KEY = runtimeConfig.storageKeys.reverseGeocodeState;
const REVERSE_GEOCODE_MIN_INTERVAL_MS = 10000;
const REVERSE_GEOCODE_MAX_BACKOFF_MS = 60000;
const REVERSE_GEOCODE_TTL_MS = runtimeConfig.reverseGeocodeTtlMs;
const USER_DETAILS_PENDING_KEY = runtimeConfig.storageKeys.userDetailsPending;
const PARTICIPANT_OPTIONS_KEY = runtimeConfig.storageKeys.participantOptions;
const DEMOGRAPHICS_KEY = runtimeConfig.storageKeys.demographics;

export const sanitizeUsername = (value) => value.replace(/[^a-zA-Z0-9_]/g, "");

const normalizePhoneForApi = (rawPhone) => {
  const digits = String(rawPhone ?? "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith(STRING_PREFIXES.countryCode91)) return digits.slice(2);
  return digits;
};

export function useUserDetailsPage({
  demographics,
  setDemographics,
  onSubmit,
}) {
  const isOnline = useOnlineStatus();
  const [optionLists, setOptionLists] = useState(() => {
    const cached = readJsonValue(PARTICIPANT_OPTIONS_KEY, null);
    return {
      genders: Array.isArray(cached?.genders) ? cached.genders : [],
      languages: Array.isArray(cached?.languages) ? cached.languages : [],
    };
  });
  const [optionsLoading, setOptionsLoading] = useState(() => (
    optionLists.genders.length === 0 || optionLists.languages.length === 0
  ));
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [pendingSubmit, setPendingSubmit] = useState(false);
  const [checking, setChecking] = useState({ username: false, email: false, phone: false });
  const [locating, setLocating] = useState(false);
  const [locationStatus, setLocationStatus] = useState("");
  const [locationPermissionDenied, setLocationPermissionDenied] = useState(false);
  const [manualLocationAllowed, setManualLocationAllowed] = useState(false);
  const autoLocationAttemptsRef = useRef(0);
  const autoDetectStartedRef = useRef(false);
  const participantOptionsLoadedRef = useRef(optionLists.genders.length > 0 && optionLists.languages.length > 0);
  const userEditedLocationRef = useRef(false);
  const retryCountdown = useRetryCountdown(!isOnline && pendingSubmit, runtimeConfig.serviceRetrySeconds);
  const debounceTimerRef = useRef({ username: null, email: null, phone: null });
  const reverseGeocodeAbortRef = useRef(null);
  const availabilityAbortRef = useRef({ username: null, email: null, phone: null });
  const saveTimeoutRef = useRef(null);
  const lastSavedAtRef = useRef(null);

  useEffect(() => {
    document.title = uiText("user.documentTitle");
  }, []);

  useEffect(() => {
    const stored = readJsonValue(DEMOGRAPHICS_KEY, null);
    if (stored && typeof stored === "object") {
      setDraftRestored(true);
    }
  }, []);

  useEffect(() => {
    if (participantOptionsLoadedRef.current) {
      setOptionsLoading(false);
      return;
    }
    if (!isOnline) {
      setOptionsLoading(false);
      return;
    }

    let cancelled = false;

    const loadParticipantOptions = async () => {
      setOptionsLoading(true);
      try {
        const data = await endpoints.getParticipantOptions();
        if (cancelled) return;
        const nextOptions = {
          genders: Array.isArray(data?.genders) ? data.genders : [],
          languages: Array.isArray(data?.languages) ? data.languages : [],
        };
        setOptionLists(nextOptions);
        writeJsonValue(PARTICIPANT_OPTIONS_KEY, nextOptions);
        participantOptionsLoadedRef.current = true;
        setErrors((prev) => {
          if (!prev.general) return prev;
          const next = { ...prev };
          delete next.general;
          return next;
        });
      } catch (error) {
        if (cancelled || error?.code === REQUEST_CODES.aborted) return;
        const cached = readJsonValue(PARTICIPANT_OPTIONS_KEY, null);
        const cachedGenders = Array.isArray(cached?.genders) ? cached.genders : [];
        const cachedLanguages = Array.isArray(cached?.languages) ? cached.languages : [];
        if (cachedGenders.length > 0 && cachedLanguages.length > 0) {
          setOptionLists({ genders: cachedGenders, languages: cachedLanguages });
        } else {
          setErrors((prev) => ({
            ...prev,
            general: error?.message || getErrorMessage("SYS_001_0001"),
          }));
        }
      } finally {
        if (!cancelled) {
          setOptionsLoading(false);
        }
      }
    };

    loadParticipantOptions();

    return () => {
      cancelled = true;
    };
  }, [isOnline]);

  const validateUsernameInput = useCallback((rawUsername) => {
    const value = String(rawUsername ?? "").trim();
    if (!value || value.length < USERNAME_MIN_LENGTH) {
      return getErrorMessage("VAL_001_0010", "en", { min: USERNAME_MIN_LENGTH });
    }
    if (!REGEX_PATTERNS.username.test(value)) {
      return getErrorMessage("VAL_001_0011");
    }
    return "";
  }, []);

  const validateEmailInput = useCallback((rawEmail) => {
    const value = String(rawEmail ?? "").trim().toLowerCase();
    if (!value) return getErrorMessage("VAL_001_0012");
    if (!REGEX_PATTERNS.email.test(value)) return getErrorMessage("VAL_001_0013");
    const domain = value.split("@")[1];
    if (!ALLOWED_EMAIL_DOMAINS.includes(domain)) return getErrorMessage("VAL_001_0014");
    return "";
  }, []);

  const validatePhoneInput = useCallback((rawPhone) => {
    const phoneDigits = String(rawPhone ?? "").replace(/\D/g, "");
    if (!phoneDigits) return getErrorMessage("VAL_001_0015");
    const isValidIndian = REGEX_PATTERNS.indianPhone.test(phoneDigits)
      || (phoneDigits.length === 12 && phoneDigits.startsWith(STRING_PREFIXES.countryCode91) && REGEX_PATTERNS.indianPhone.test(phoneDigits.slice(2)));
    if (!isValidIndian) return getErrorMessage("VAL_001_0016");
    return "";
  }, []);

  const validateGenderInput = useCallback((rawGender) => (
    String(rawGender ?? "").trim() ? "" : getErrorMessage("VAL_001_0017")
  ), []);

  const validateAgeInput = useCallback((rawAge) => {
    const trimmed = String(rawAge ?? "").trim();
    if (!trimmed) return getErrorMessage("VAL_001_0018");
    if (!REGEX_PATTERNS.digitsOnly.test(trimmed)) return getErrorMessage("VAL_001_0019", "en", { min: AGE_MIN, max: AGE_MAX });
    const ageNum = Number(trimmed);
    if (!Number.isInteger(ageNum) || ageNum < AGE_MIN || ageNum > AGE_MAX) {
      return getErrorMessage("VAL_001_0019", "en", { min: AGE_MIN, max: AGE_MAX });
    }
    return "";
  }, []);

  const validateLocationInput = useCallback((rawLocation) => {
    const value = String(rawLocation ?? "").trim();
    return value.length >= LOCATION_MIN_LENGTH ? "" : getErrorMessage("VAL_001_0020");
  }, []);

  const validateLanguageInput = useCallback((rawLanguage) => (
    String(rawLanguage ?? "").trim() ? "" : getErrorMessage("VAL_001_0021")
  ), []);

  const validatePriorExperienceInput = useCallback((rawPriorExperience) => (
    String(rawPriorExperience ?? "").trim() ? "" : getErrorMessage("VAL_001_0022")
  ), []);

  const sanitizeLocationValue = useCallback((value) => {
    const text = String(value ?? "").trim();
    if (!text) return "";
    const coordinateOnly = /^\s*[-+]?\d+(\.\d+)?\s*,\s*[-+]?\d+(\.\d+)?(\s*,\s*[-+]?\d+(\.\d+)?)?\s*$/.test(text);
    return coordinateOnly ? "" : text;
  }, []);

  const setDetectedLocation = useCallback((value) => {
    if (userEditedLocationRef.current) return;
    const sanitized = sanitizeLocationValue(value);
    setDemographics((prev) => ({ ...prev, location: sanitized }));
    setLocationPermissionDenied(false);
    setManualLocationAllowed(!sanitized);
    setErrors((prev) => {
      if (!prev.location) return prev;
      const next = { ...prev };
      delete next.location;
      return next;
    });
  }, [sanitizeLocationValue, setDemographics]);

  const getBrowserPosition = useCallback((options) => (
    new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, options);
    })
  ), []);

  const detectLocation = useCallback((mode = GEOLOCATION_MODES.manual) => {
    if (mode === GEOLOCATION_MODES.auto) {
      if (autoLocationAttemptsRef.current >= MAX_AUTO_LOCATION_ATTEMPTS) return;
      autoLocationAttemptsRef.current += 1;
    }
    setManualLocationAllowed(false);
    setLocationPermissionDenied(false);
    setErrors((prev) => {
      if (!prev.location) return prev;
      const next = { ...prev };
      delete next.location;
      return next;
    });
    if (!navigator.geolocation) {
      setLocationStatus(uiText("user.locationFallback"));
      setLocationPermissionDenied(false);
      setManualLocationAllowed(true);
      setErrors((prev) => {
        const next = { ...prev };
        delete next.location;
        return next;
      });
      return;
    }

    setLocating(true);
    setLocationStatus(uiText("user.locationRequesting"));
    const resolveLocation = async () => {
      try {
        let position;
        try {
          position = await getBrowserPosition({
            enableHighAccuracy: false,
            timeout: runtimeConfig.geolocationTimeoutMs,
            maximumAge: runtimeConfig.geolocationMaxAgeMs,
          });
        } catch {
          setLocationStatus(uiText("user.locationRetrying"));
          position = await getBrowserPosition({
            enableHighAccuracy: true,
            timeout: Math.max(runtimeConfig.geolocationTimeoutMs * 2, 20000),
            maximumAge: 0,
          });
        }

        const { latitude, longitude } = position.coords;
        let detectedLocation = "";

        try {
          const now = Date.now();
          let reverseState = { next_allowed_at: 0, fail_count: 0 };
          try {
            const raw = sessionStorage.getItem(REVERSE_GEOCODE_STATE_KEY);
            if (raw) {
              const parsed = JSON.parse(raw);
              if (parsed && typeof parsed === "object") {
                if (parsed[REVERSE_GEOCODE_FIELDS.expiresAt] && now > Number(parsed[REVERSE_GEOCODE_FIELDS.expiresAt])) {
                  reverseState = { next_allowed_at: 0, fail_count: 0 };
                } else {
                  reverseState = {
                    [REVERSE_GEOCODE_FIELDS.nextAllowedAt]: Number(parsed[REVERSE_GEOCODE_FIELDS.nextAllowedAt] || 0),
                    [REVERSE_GEOCODE_FIELDS.failCount]: Number(parsed[REVERSE_GEOCODE_FIELDS.failCount] || 0),
                  };
                }
              }
            }
          } catch {
            // Ignore malformed cache
          }
          if (now < reverseState[REVERSE_GEOCODE_FIELDS.nextAllowedAt]) {
            setManualLocationAllowed(true);
            setLocationStatus(uiText("user.locationFallback"));
            return;
          }
          if (reverseGeocodeAbortRef.current) {
            reverseGeocodeAbortRef.current.abort();
          }
          const controller = new AbortController();
          reverseGeocodeAbortRef.current = controller;
          const reverse = await fetch(
            `${runtimeConfig.reverseGeocodeUrl}?format=jsonv2&lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}`,
            { signal: controller.signal }
          );
          if (reverse.ok) {
            const data = await reverse.json();
            const address = data?.address || {};
            const city = address.city || address.town || address.village || address.hamlet;
            const state = address.state;
            const country = address.country;
            const composed = [city, state, country].filter(Boolean).join(", ");
            if (composed.length >= LOCATION_MIN_LENGTH) {
              detectedLocation = composed;
            }
            sessionStorage.setItem(REVERSE_GEOCODE_STATE_KEY, JSON.stringify({
              [REVERSE_GEOCODE_FIELDS.nextAllowedAt]: now + REVERSE_GEOCODE_MIN_INTERVAL_MS,
              [REVERSE_GEOCODE_FIELDS.failCount]: 0,
              [REVERSE_GEOCODE_FIELDS.expiresAt]: now + REVERSE_GEOCODE_TTL_MS,
            }));
          }
        } catch {
          const now = Date.now();
          let failCount = 0;
          try {
            const raw = sessionStorage.getItem(REVERSE_GEOCODE_STATE_KEY);
            if (raw) {
              const parsed = JSON.parse(raw);
              failCount = Number(parsed?.[REVERSE_GEOCODE_FIELDS.failCount] || 0);
            }
          } catch {
            failCount = 0;
          }
          const nextFailCount = Math.min(5, failCount + 1);
          const backoffMs = Math.min(REVERSE_GEOCODE_MAX_BACKOFF_MS, REVERSE_GEOCODE_MIN_INTERVAL_MS * (2 ** nextFailCount));
          sessionStorage.setItem(REVERSE_GEOCODE_STATE_KEY, JSON.stringify({
            [REVERSE_GEOCODE_FIELDS.nextAllowedAt]: now + backoffMs,
            [REVERSE_GEOCODE_FIELDS.failCount]: nextFailCount,
            [REVERSE_GEOCODE_FIELDS.expiresAt]: now + REVERSE_GEOCODE_TTL_MS,
          }));
        } finally {
          reverseGeocodeAbortRef.current = null;
        }

        userEditedLocationRef.current = false;
        setDemographics((prev) => ({ ...prev, location: "" }));
        setDetectedLocation(detectedLocation);
        if (sanitizeLocationValue(detectedLocation)) {
          setLocationStatus(uiText("user.locationDetected"));
        } else {
          setManualLocationAllowed(true);
          setLocationStatus(uiText("user.locationFallback"));
        }
      } catch (error) {
        const denied = error?.code === GEOLOCATION_ERROR_CODES.permissionDenied;
        setLocationPermissionDenied(denied);
        setManualLocationAllowed(true);
        setLocationStatus(denied ? uiText("user.locationPermissionDenied") : uiText("user.locationFallback"));
        setErrors((prev) => {
          const next = { ...prev };
          delete next[USER_DETAIL_FIELDS.location];
          return next;
        });
      } finally {
        setLocating(false);
      }
    };

    resolveLocation();
  }, [
    getBrowserPosition,
    sanitizeLocationValue,
    setDemographics,
    setDetectedLocation,
    setManualLocationAllowed,
    setLocationPermissionDenied,
    setLocationStatus,
  ]);

  useEffect(() => {
    if (autoDetectStartedRef.current) return;
    autoDetectStartedRef.current = true;
    try {
      const lastPromptAt = Number(sessionStorage.getItem(AUTO_LOCATION_PROMPT_KEY) || "0");
      const now = Date.now();
      if (now - lastPromptAt < AUTO_LOCATION_PROMPT_DEDUPE_MS) return;
      sessionStorage.setItem(AUTO_LOCATION_PROMPT_KEY, String(now));
    } catch {
      // Ignore storage failures; continue with normal behavior.
    }
    detectLocation(GEOLOCATION_MODES.auto);
  }, [detectLocation]);

  useEffect(() => {
    const sanitized = sanitizeLocationValue(demographics.location);
    if (sanitized !== String(demographics.location || "")) {
      setDemographics((prev) => ({ ...prev, location: sanitized }));
      if (!sanitized) setManualLocationAllowed(true);
    }
  }, [demographics.location, sanitizeLocationValue, setDemographics, setManualLocationAllowed]);

  useEffect(() => {
    const availabilityRef = availabilityAbortRef.current;
    return () => {
      if (reverseGeocodeAbortRef.current) {
        reverseGeocodeAbortRef.current.abort();
        reverseGeocodeAbortRef.current = null;
      }
      Object.keys(availabilityRef).forEach((key) => {
        if (availabilityRef[key]) {
          availabilityRef[key].abort();
          availabilityRef[key] = null;
        }
      });
    };
  }, []);

  const validateForm = useCallback(() => {
    const newErrors = {};
    const usernameError = validateUsernameInput(demographics.username);
    if (usernameError) newErrors.username = usernameError;
    const emailError = validateEmailInput(demographics.email);
    if (emailError) newErrors.email = emailError;
    const phoneError = validatePhoneInput(demographics.phone);
    if (phoneError) newErrors.phone = phoneError;
    const genderError = validateGenderInput(demographics.gender_code);
    if (genderError) newErrors.gender_code = genderError;
    const ageError = validateAgeInput(demographics.age);
    if (ageError) newErrors.age = ageError;
    const locationError = (locationPermissionDenied && !manualLocationAllowed)
      ? uiText("user.locationPermissionRequired")
      : validateLocationInput(demographics.location);
    if (locationError) newErrors[USER_DETAIL_FIELDS.location] = locationError;
    const languageError = validateLanguageInput(demographics.language_code);
    if (languageError) newErrors.language_code = languageError;
    const priorExperienceError = validatePriorExperienceInput(demographics.prior_experience);
    if (priorExperienceError) newErrors.prior_experience = priorExperienceError;
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [
    demographics,
    locationPermissionDenied,
    manualLocationAllowed,
    validateAgeInput,
    validateEmailInput,
    validateGenderInput,
    validateLanguageInput,
    validateLocationInput,
    validatePhoneInput,
    validatePriorExperienceInput,
    validateUsernameInput,
  ]);

  const handleSubmit = useCallback(async () => {
    if (!isOnline) {
      setErrors((prev) => ({
        ...prev,
        [USER_DETAIL_FIELDS.general]: uiText("user.offlineSubmit"),
      }));
      setPendingFlag(USER_DETAILS_PENDING_KEY);
      setPendingSubmit(true);
      return;
    }
    if (!validateForm()) return;

    setErrors((prev) => {
      if (!prev.general) return prev;
      const next = { ...prev };
      delete next.general;
      return next;
    });
    setSubmitting(true);
    setChecking({ username: true, email: true, phone: true });

    try {
      const checks = [];
      if (demographics.username && demographics.username.trim().length >= USERNAME_MIN_LENGTH) {
        checks.push(
          endpoints.checkUsername(demographics.username.trim())
            .then((data) => ({ field: "username", available: data.available }))
            .catch(() => ({ field: "username", available: true }))
        );
      }
      if (demographics.email && REGEX_PATTERNS.email.test(demographics.email.trim())) {
        checks.push(
          endpoints.checkEmail(demographics.email.trim())
            .then((data) => ({ field: "email", available: data.available }))
            .catch(() => ({ field: "email", available: true }))
        );
      }
      if (demographics.phone) {
        const phoneDigits = normalizePhoneForApi(demographics.phone);
        const isValidIndian = REGEX_PATTERNS.indianPhone.test(phoneDigits)
          || (phoneDigits.length === 12 && phoneDigits.startsWith(STRING_PREFIXES.countryCode91) && REGEX_PATTERNS.indianPhone.test(phoneDigits.slice(2)));
        if (isValidIndian) {
          checks.push(
            endpoints.checkPhone(phoneDigits)
              .then((data) => ({ field: "phone", available: data.available }))
              .catch(() => ({ field: "phone", available: true }))
          );
        }
      }

      const results = await Promise.all(checks);
      const newErrors = {};
      results.forEach((result) => {
        if (!result.available) {
          const errorCode = USER_DETAILS_DUPLICATE_ERROR_CODES[result.field] || USER_DETAILS_DUPLICATE_ERROR_CODES.fallback;
          newErrors[result.field] = getErrorMessage(errorCode);
        }
      });
      if (Object.keys(newErrors).length > 0) {
        setErrors((prev) => ({ ...prev, ...newErrors }));
        return;
      }

      await onSubmit();
    } catch (error) {
      if (error?.code === REQUEST_CODES.aborted) return;
      const mappedField = USER_DETAILS_ERROR_CODE_TO_FIELD[error?.code] || error?.field || null;
      if (mappedField) {
        setErrors((prev) => ({
          ...prev,
          [mappedField]: error.message || getErrorMessage(USER_DETAILS_DUPLICATE_ERROR_CODES[mappedField] || "SYS_001_0001"),
        }));
        return;
      }
      if (error?.status === 409) {
        try {
          const [u, e, p] = await Promise.all([
            demographics.username?.trim()
              ? endpoints.checkUsername(demographics.username.trim()).catch(() => ({ available: true }))
              : Promise.resolve({ available: true }),
            demographics.email?.trim()
              ? endpoints.checkEmail(demographics.email.trim()).catch(() => ({ available: true }))
              : Promise.resolve({ available: true }),
            demographics.phone
              ? endpoints.checkPhone(normalizePhoneForApi(demographics.phone)).catch(() => ({ available: true }))
              : Promise.resolve({ available: true }),
          ]);
          const conflictErrors = {};
          if (u?.available === false) conflictErrors[USER_DETAIL_FIELDS.username] = getErrorMessage(USER_DETAILS_DUPLICATE_ERROR_CODES.username);
          if (e?.available === false) conflictErrors[USER_DETAIL_FIELDS.email] = getErrorMessage(USER_DETAILS_DUPLICATE_ERROR_CODES.email);
          if (p?.available === false) conflictErrors[USER_DETAIL_FIELDS.phone] = getErrorMessage(USER_DETAILS_DUPLICATE_ERROR_CODES.phone);
          if (Object.keys(conflictErrors).length > 0) {
            setErrors((prev) => ({ ...prev, ...conflictErrors }));
            return;
          }
        } catch {
          // Fall through to generic message.
        }
      }
      setErrors((prev) => ({
        ...prev,
        [USER_DETAIL_FIELDS.general]: error?.message || getErrorMessage("SYS_001_0001"),
      }));
    } finally {
      setSubmitting(false);
      setChecking({ username: false, email: false, phone: false });
    }
  }, [demographics, isOnline, onSubmit, validateForm]);

  useEffect(() => {
    if (!isOnline || submitting) return;
    const pending = getPendingFlag(USER_DETAILS_PENDING_KEY) === true;
    if (!pending) return;
    removeStoredKey(USER_DETAILS_PENDING_KEY);
    setPendingSubmit(false);
    handleSubmit();
  }, [handleSubmit, isOnline, submitting]);

  useEffect(() => {
    if (!isOnline) return;
    setIsSaving(true);
    setSaveError("");
    if (saveTimeoutRef.current) {
      clearScheduledTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = scheduleTimeout(() => setIsSaving(false), 400);
    try {
      const meta = readStoredMeta(DEMOGRAPHICS_KEY);
      if (meta?.savedAt) {
        lastSavedAtRef.current = meta.savedAt;
        setLastSavedAt(meta.savedAt);
      } else {
        const now = Date.now();
        lastSavedAtRef.current = now;
        setLastSavedAt(now);
      }
    } catch {
      setSaveError(uiText("autosave.failed"));
      if (lastSavedAtRef.current) {
        setLastSavedAt(lastSavedAtRef.current);
      }
    }
  }, [demographics, isOnline]);

  useEffect(() => {
    if (!isOnline) setIsSaving(false);
  }, [isOnline]);

  useEffect(() => () => {
    if (saveTimeoutRef.current) clearScheduledTimeout(saveTimeoutRef.current);
  }, []);

  const updateField = useCallback((field, value) => {
    setDemographics((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  }, [errors, setDemographics]);

  const getFieldError = useCallback((field, value) => {
    switch (field) {
      case "username":
        return validateUsernameInput(value);
      case "email":
        return validateEmailInput(value);
      case "phone":
        return validatePhoneInput(value);
      case "gender_code":
        return validateGenderInput(value);
      case "age":
        return validateAgeInput(value);
      case "location":
        return validateLocationInput(value);
      case "language_code":
        return validateLanguageInput(value);
      case "prior_experience":
        return validatePriorExperienceInput(value);
      default:
        return "";
    }
  }, [
    validateAgeInput,
    validateEmailInput,
    validateGenderInput,
    validateLanguageInput,
    validateLocationInput,
    validatePhoneInput,
    validatePriorExperienceInput,
    validateUsernameInput,
  ]);

  const checkAvailability = useCallback(async (field, value) => {
    if (!value || value.trim().length === 0) return;
    if (field === "username" && value.trim().length < USERNAME_MIN_LENGTH) return;
    if (field === "email") {
      if (!REGEX_PATTERNS.email.test(value.trim())) return;
    }
    if (field === "phone") {
      const phoneDigits = normalizePhoneForApi(value);
      const isValidIndian = REGEX_PATTERNS.indianPhone.test(phoneDigits)
        || (phoneDigits.length === 12 && phoneDigits.startsWith(STRING_PREFIXES.countryCode91) && REGEX_PATTERNS.indianPhone.test(phoneDigits.slice(2)));
      if (!isValidIndian) return;
    }

    setChecking((prev) => ({ ...prev, [field]: true }));
    try {
      if (availabilityAbortRef.current[field]) {
        availabilityAbortRef.current[field].abort();
      }
      const controller = new AbortController();
      availabilityAbortRef.current[field] = controller;
      const request = field === "username"
        ? endpoints.checkUsername(value.trim(), { signal: controller.signal })
        : field === "email"
          ? endpoints.checkEmail(value.trim(), { signal: controller.signal })
          : endpoints.checkPhone(normalizePhoneForApi(value), { signal: controller.signal });
      const data = await request;

      if (!data.available) {
        const errorCode = USER_DETAILS_DUPLICATE_ERROR_CODES[field] || USER_DETAILS_DUPLICATE_ERROR_CODES.fallback;
        setErrors((prev) => ({
          ...prev,
          [field]: getErrorMessage(errorCode),
        }));
      }
    } catch (error) {
      if (error?.code === REQUEST_CODES.aborted) return;
    } finally {
      availabilityAbortRef.current[field] = null;
      setChecking((prev) => ({ ...prev, [field]: false }));
    }
  }, []);

  const debouncedCheck = useCallback((field, value) => {
    if (debounceTimerRef.current[field]) {
      clearScheduledTimeout(debounceTimerRef.current[field]);
    }
    debounceTimerRef.current[field] = scheduleTimeout(() => {
      checkAvailability(field, value);
    }, runtimeConfig.availabilityDebounceMs);
  }, [checkAvailability]);

  const handleFieldBlur = useCallback((field, value, checkDuplicate = false) => {
    const error = getFieldError(field, value);
    setErrors((prev) => {
      const next = { ...prev };
      if (error) {
        next[field] = error;
      } else {
        delete next[field];
      }
      return next;
    });
    if (!error && checkDuplicate) {
      debouncedCheck(field, value);
    }
  }, [debouncedCheck, getFieldError]);

  const requiredFields = [
    "username",
    "email",
    "phone",
    "gender_code",
    "age",
    "location",
    "language_code",
    "prior_experience",
  ];

  const isFormComplete = requiredFields.every((field) => {
    const value = demographics[field];
    if (typeof value === "string") {
      return value.trim().length > 0;
    }
    return value !== null && value !== undefined && value !== "";
  });

  const constants = useMemo(() => ({
    ageMin: AGE_MIN,
    ageMax: AGE_MAX,
    usernameMin: USERNAME_MIN_LENGTH,
    locationMin: LOCATION_MIN_LENGTH,
  }), []);

  return {
    constants,
    isOnline,
    genderOptions: optionLists.genders,
    languageOptions: optionLists.languages,
    optionsLoading,
    errors,
    submitting,
    checking,
    locating,
    locationStatus,
    locationPermissionDenied,
    manualLocationAllowed,
    userEditedLocationRef,
    isFormComplete,
    detectLocation,
    handleSubmit,
    handleFieldBlur,
    updateField,
    draftRestored,
    lastSavedAt,
    isSaving,
    saveError,
    retryCountdown,
  };
}
