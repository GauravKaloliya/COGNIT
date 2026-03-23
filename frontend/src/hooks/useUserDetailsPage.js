import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { endpoints } from "../utils/api.js";
import { getErrorMessage } from "../utils/errorRegistry.js";
import { getDisplayErrorMessage } from "../utils/appError.js";
import { runtimeConfig } from "../config/runtime";
import { uiText } from "../utils/uiText";
import { useOnlineStatus } from "./useOnlineStatus";
import { useRetryCountdown } from "./useRetryCountdown";
import { clearScheduledInterval, clearScheduledTimeout, scheduleInterval, scheduleTimeout, SECOND_MS } from "../utils/timing";
import { requirePublicId } from "../utils/publicId";
import {
  forEachStorageArea,
  getPendingFlag,
  makeScopedKey,
  readExpiringValue,
  readJsonValue,
  readStoredMeta,
  removeStoredKey,
  setPendingFlag,
  writeExpiringValue,
  writeJsonValue,
} from "../utils/storage";
import {
  GEOLOCATION_ERROR_CODES,
  GEOLOCATION_MODES,
  REVERSE_GEOCODE_FIELDS,
  USER_DETAILS_DUPLICATE_ERROR_CODES,
  USER_DETAILS_ERROR_CODE_TO_FIELD,
  USER_DETAIL_FIELDS,
} from "../constants/userDetails";
import { REQUEST_CODES } from "../constants/request";
import { REGEX_PATTERNS } from "../constants/patterns";
import {
  buildUserDetailsValidators,
  prioritizeEnglishOptions,
  sanitizeLocationValue,
} from "../utils/userDetailsHelpers";

const USERNAME_MIN_LENGTH = runtimeConfig.usernameMinLength;
const AGE_MIN = runtimeConfig.ageMin;
const AGE_MAX = runtimeConfig.ageMax;
const LOCATION_MIN_LENGTH = runtimeConfig.locationMinLength;
const OTP_STATUS = runtimeConfig.otpStatus;
const MAX_AUTO_LOCATION_ATTEMPTS = 2;
const AUTO_LOCATION_PROMPT_KEY = runtimeConfig.storageKeys.autoLocationPrompt;
const AUTO_LOCATION_SUCCESS_KEY = runtimeConfig.storageKeys.autoLocationSuccess;
const AUTO_LOCATION_PROMPT_DEDUPE_MS = 2000;
const AUTO_LOCATION_SESSION_PROMPT_KEY = `${AUTO_LOCATION_SUCCESS_KEY}_prompted_session`;
const LOCATION_PERMISSION_GRANTED_KEY = `${AUTO_LOCATION_SUCCESS_KEY}_permission_granted`;
const REVERSE_GEOCODE_STATE_KEY = runtimeConfig.storageKeys.reverseGeocodeState;
const REVERSE_GEOCODE_MIN_INTERVAL_MS = 10000;
const REVERSE_GEOCODE_MAX_BACKOFF_MS = 60000;
const REVERSE_GEOCODE_TTL_MS = runtimeConfig.reverseGeocodeTtlMs;
const USER_DETAILS_PENDING_KEY = runtimeConfig.storageKeys.userDetailsPending;
const PARTICIPANT_OPTIONS_KEY = runtimeConfig.storageKeys.participantOptions;
const DEMOGRAPHICS_KEY = runtimeConfig.storageKeys.demographics;
const EMAIL_OTP_STATE_KEY = runtimeConfig.storageKeys.emailOtpState;
const EMAIL_OTP_TTL_MS = Math.max(
  30000,
  (runtimeConfig.emailOtpExpirySeconds || 300) * 1000
);

export function useUserDetailsPage({
  publicId,
  demographics,
  setDemographics,
  onSubmit,
  onEmailVerified,
  addToast,
}) {
  const scope = String(publicId || "").trim() || "anon";
  const scopedUserDetailsPendingKey = makeScopedKey(USER_DETAILS_PENDING_KEY, scope);
  const scopedOtpKey = makeScopedKey(EMAIL_OTP_STATE_KEY, scope);
  const scopedDemographicsKey = makeScopedKey(DEMOGRAPHICS_KEY, scope);

  const isOnline = useOnlineStatus();
  const [optionLists, setOptionLists] = useState(() => {
    const cached = readJsonValue(PARTICIPANT_OPTIONS_KEY, null, "local");
    return {
      genders: Array.isArray(cached?.genders) ? cached.genders : [],
      languages: Array.isArray(cached?.languages) ? cached.languages : [],
      priorExperiences: Array.isArray(cached?.prior_experiences) ? cached.prior_experiences : [],
    };
  });
  const [optionsLoading, setOptionsLoading] = useState(() => (
    optionLists.genders.length === 0 || optionLists.languages.length === 0 || optionLists.priorExperiences.length === 0
  ));
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const otpLength = runtimeConfig.emailOtpLength;
  const [otpDigits, setOtpDigits] = useState(() => Array.from({ length: otpLength }, () => ""));
  const [otpError, setOtpError] = useState("");
  const [resendCountdownActive, setResendCountdownActive] = useState(false);
  const [resendInitialSeconds, setResendInitialSeconds] = useState(runtimeConfig.emailOtpResendCooldownSeconds);
  const [emailEditable, setEmailEditable] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [pendingSubmit, setPendingSubmit] = useState(false);
  const [checking, setChecking] = useState({ username: false, email: false });
  const [locating, setLocating] = useState(false);
  const [locationStatus, setLocationStatus] = useState("");
  const [locationPermissionDenied, setLocationPermissionDenied] = useState(false);
  const [locationPermissionState, setLocationPermissionState] = useState(() => {
    try {
      return localStorage.getItem(LOCATION_PERMISSION_GRANTED_KEY) === "1" ? "granted" : "unknown";
    } catch {
      return "unknown";
    }
  });
  const [manualLocationAllowed, setManualLocationAllowed] = useState(false);
  const locationAttemptedRef = useRef(false);
  const [locationAutoSucceeded, setLocationAutoSucceeded] = useState(() => {
    try {
      return localStorage.getItem(AUTO_LOCATION_SUCCESS_KEY) === "1";
    } catch {
      return false;
    }
  });
  const autoLocationAttemptsRef = useRef(0);
  const autoDetectStartedRef = useRef(false);
  const participantOptionsLoadedRef = useRef(
    optionLists.genders.length > 0 && optionLists.languages.length > 0 && optionLists.priorExperiences.length > 0
  );
  const userEditedLocationRef = useRef(false);
  const retryCountdown = useRetryCountdown(!isOnline && pendingSubmit, runtimeConfig.serviceRetrySeconds);
  const resendSeconds = useRetryCountdown(resendCountdownActive, resendInitialSeconds);
  const debounceTimerRef = useRef({ username: null, email: null });
  const reverseGeocodeAbortRef = useRef(null);
  const availabilityAbortRef = useRef({ username: null, email: null });
  const suppressAvailabilityRef = useRef(false);
  const saveTimeoutRef = useRef(null);
  const draftSaveTimeoutRef = useRef(null);
  const lastSavedAtRef = useRef(null);
  const submittedPublicIdRef = useRef("");
  const submittedEmailRef = useRef("");
  const autoVerifyRef = useRef("");
  const resendEndsAtRef = useRef(null);
  const otpExpiresAtRef = useRef(null);

  const [otpStatus, setOtpStatus] = useState(OTP_STATUS.idle);
  const [otpExpiresAt, setOtpExpiresAt] = useState(null);
  const [otpExpirySeconds, setOtpExpirySeconds] = useState(0);
  const validators = useMemo(() => buildUserDetailsValidators({
    usernameMinLength: USERNAME_MIN_LENGTH,
    ageMin: AGE_MIN,
    ageMax: AGE_MAX,
    locationMinLength: LOCATION_MIN_LENGTH,
  }), []);
  const otpValue = otpDigits.join("");
  const showOtpField = [
    OTP_STATUS.sending,
    OTP_STATUS.sent,
    OTP_STATUS.sendFailed,
    OTP_STATUS.verifying,
    OTP_STATUS.verifyFailed,
  ].includes(otpStatus);
  const inputsLocked = submitting
    || otpStatus === OTP_STATUS.sending
    || otpStatus === OTP_STATUS.verifying
    || otpStatus === OTP_STATUS.sent
    || otpStatus === OTP_STATUS.verifyFailed;
  const allowEmailDuringOtp = otpStatus !== OTP_STATUS.idle;
  const emailInputDisabled = inputsLocked && !allowEmailDuringOtp;

  useEffect(() => {
    document.title = uiText("user.documentTitle");
  }, []);

  useEffect(() => {
    const storedMeta =
      readStoredMeta(scopedDemographicsKey, "local") ||
      readStoredMeta(DEMOGRAPHICS_KEY, "local");
    if (storedMeta) {
      setDraftRestored(true);
    }
  }, [scopedDemographicsKey]);

  useEffect(() => {
    const opts = { ttlMs: EMAIL_OTP_TTL_MS, schemaVersion: runtimeConfig.uiStateSchemaVersion };
    const readOtp = () => {
      const scopedLocal = readExpiringValue(scopedOtpKey, null, { ...opts, area: "local" });
      if (scopedLocal) return { value: scopedLocal, source: { key: scopedOtpKey, area: "local" } };
      const unscopedLocal = readExpiringValue(EMAIL_OTP_STATE_KEY, null, { ...opts, area: "local" });
      if (unscopedLocal) return { value: unscopedLocal, source: { key: EMAIL_OTP_STATE_KEY, area: "local" } };
      const scopedSession = readExpiringValue(scopedOtpKey, null, { ...opts, area: "session" });
      if (scopedSession) return { value: scopedSession, source: { key: scopedOtpKey, area: "session" } };
      const unscopedSession = readExpiringValue(EMAIL_OTP_STATE_KEY, null, { ...opts, area: "session" });
      if (unscopedSession) return { value: unscopedSession, source: { key: EMAIL_OTP_STATE_KEY, area: "session" } };
      return null;
    };

    const stored = readOtp();
    const storedOtp = stored?.value;
    if (!storedOtp || typeof storedOtp !== "object") return;

    if (storedOtp.otpStatus === OTP_STATUS.verified) {
      forEachStorageArea((area) => {
        removeStoredKey(EMAIL_OTP_STATE_KEY, area);
        removeStoredKey(scopedOtpKey, area);
      });
      return;
    }

    if (stored?.source && stored.source.key !== scopedOtpKey) {
      try {
        writeExpiringValue(scopedOtpKey, storedOtp, { ...opts, area: "local" });
        removeStoredKey(stored.source.key, stored.source.area);
      } catch {
        // Ignore migration failures.
      }
    }

    if (storedOtp.publicId) submittedPublicIdRef.current = String(storedOtp.publicId);
    if (storedOtp.submittedEmail) submittedEmailRef.current = String(storedOtp.submittedEmail);
    if (typeof storedOtp.emailEditable === "boolean") setEmailEditable(storedOtp.emailEditable);
    if (typeof storedOtp.otpStatus === "string") {
      const normalizedStatus = [OTP_STATUS.sending, OTP_STATUS.verifying].includes(storedOtp.otpStatus)
        ? OTP_STATUS.sent
        : storedOtp.otpStatus === OTP_STATUS.sendFailed
          ? OTP_STATUS.verifyFailed
          : storedOtp.otpStatus;
      setOtpStatus(normalizedStatus);
    }
    if (storedOtp.resendEndsAt && typeof storedOtp.resendEndsAt === "number") {
      const remaining = Math.max(0, Math.ceil((storedOtp.resendEndsAt - Date.now()) / 1000));
      if (remaining > 0) {
        resendEndsAtRef.current = storedOtp.resendEndsAt;
        setResendInitialSeconds(remaining);
        setResendCountdownActive(true);
      }
    }
    if (storedOtp.otpExpiresAt && typeof storedOtp.otpExpiresAt === "number") {
      const remaining = Math.max(0, Math.ceil((storedOtp.otpExpiresAt - Date.now()) / 1000));
      if (remaining > 0) {
        otpExpiresAtRef.current = storedOtp.otpExpiresAt;
        setOtpExpiresAt(storedOtp.otpExpiresAt);
        setOtpExpirySeconds(remaining);
      }
    }
  }, [otpLength, scopedOtpKey]);

  useEffect(() => {
    if (!otpExpiresAt || otpStatus === OTP_STATUS.verified || otpStatus === OTP_STATUS.idle) {
      setOtpExpirySeconds(0);
      return undefined;
    }
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((otpExpiresAt - Date.now()) / 1000));
      setOtpExpirySeconds(remaining);
    };
    tick();
    const interval = scheduleInterval(tick, SECOND_MS);
    return () => clearScheduledInterval(interval);
  }, [otpExpiresAt, otpStatus]);

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
          languages: prioritizeEnglishOptions(Array.isArray(data?.languages) ? data.languages : []),
          prior_experiences: Array.isArray(data?.prior_experiences) ? data.prior_experiences : [],
        };
        setOptionLists({
          genders: nextOptions.genders,
          languages: nextOptions.languages,
          priorExperiences: nextOptions.prior_experiences,
        });
        writeJsonValue(PARTICIPANT_OPTIONS_KEY, nextOptions, "local");
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
        const cachedLanguages = prioritizeEnglishOptions(Array.isArray(cached?.languages) ? cached.languages : []);
        const cachedPriorExperiences = Array.isArray(cached?.prior_experiences) ? cached.prior_experiences : [];
        if (cachedGenders.length > 0 && cachedLanguages.length > 0 && cachedPriorExperiences.length > 0) {
          setOptionLists({
            genders: cachedGenders,
            languages: cachedLanguages,
            priorExperiences: cachedPriorExperiences,
          });
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

  useEffect(() => {
    if (!optionLists.priorExperiences.length) return;
    const currentValue = String(demographics.prior_experience || "").trim();
    if (!currentValue) return;
    const flatOptions = optionLists.priorExperiences.flatMap((group) => (
      Array.isArray(group?.options) ? group.options : []
    ));
    const hasCodeMatch = flatOptions.some((option) => String(option?.value || "").trim() === currentValue);
    if (hasCodeMatch) return;
    const labelMatch = flatOptions.find((option) => String(option?.label || "").trim() === currentValue);
    if (!labelMatch?.value) return;
    setDemographics((prev) => ({ ...prev, prior_experience: String(labelMatch.value) }));
  }, [demographics.prior_experience, optionLists.priorExperiences, setDemographics]);

  const validateUsernameInput = useCallback((rawUsername) => validators.validateUsernameInput(rawUsername), [validators]);
  const validateEmailInput = useCallback((rawEmail) => validators.validateEmailInput(rawEmail), [validators]);
  const validateGenderInput = useCallback((rawGender) => validators.validateGenderInput(rawGender), [validators]);
  const validateAgeInput = useCallback((rawAge) => validators.validateAgeInput(rawAge), [validators]);
  const validateLocationInput = useCallback((rawLocation) => validators.validateLocationInput(rawLocation), [validators]);
  const validateLanguageInput = useCallback((rawLanguage) => validators.validateLanguageInput(rawLanguage), [validators]);
  const validatePriorExperienceInput = useCallback((rawPriorExperience) => validators.validatePriorExperienceInput(rawPriorExperience), [validators]);

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
  }, [setDemographics]);

  const markLocationAutoSuccess = useCallback(() => {
    try {
      localStorage.setItem(AUTO_LOCATION_SUCCESS_KEY, "1");
      localStorage.setItem(LOCATION_PERMISSION_GRANTED_KEY, "1");
    } catch {
      // Ignore storage failures.
    }
    setLocationAutoSucceeded(true);
    setLocationPermissionDenied(false);
    setManualLocationAllowed(true);
    setLocationStatus("");
  }, [setLocationPermissionDenied, setManualLocationAllowed, setLocationStatus]);

  const getBrowserPosition = useCallback((options) => (
    new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, options);
    })
  ), []);

  const detectLocation = useCallback((mode = GEOLOCATION_MODES.manual) => {
    locationAttemptedRef.current = true;
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
        setLocationPermissionState("granted");
        try {
          localStorage.setItem(LOCATION_PERMISSION_GRANTED_KEY, "1");
        } catch {
          // Ignore storage failures.
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
            if (locationAttemptedRef.current) setLocationStatus(uiText("user.locationFallback"));
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
          markLocationAutoSuccess();
          setLocationStatus(uiText("user.locationDetected"));
        } else {
          setManualLocationAllowed(true);
          if (locationAttemptedRef.current) setLocationStatus(uiText("user.locationFallback"));
        }
      } catch (error) {
        const denied = error?.code === GEOLOCATION_ERROR_CODES.permissionDenied;
        setLocationPermissionState(denied ? "denied" : "unknown");
        setLocationPermissionDenied(denied);
        if (denied) {
          try {
            localStorage.removeItem(LOCATION_PERMISSION_GRANTED_KEY);
          } catch {
            // Ignore storage failures.
          }
        }
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
    markLocationAutoSuccess,
    setDemographics,
    setDetectedLocation,
    setManualLocationAllowed,
    setLocationPermissionDenied,
    setLocationStatus,
  ]);

  useEffect(() => {
    if (autoDetectStartedRef.current) return;
    autoDetectStartedRef.current = true;

    const maybeAutoDetect = async () => {
      if (locationAutoSucceeded) return;
      try {
        const lastPromptAt = Number(localStorage.getItem(AUTO_LOCATION_PROMPT_KEY) || "0");
        const now = Date.now();
        if (now - lastPromptAt < AUTO_LOCATION_PROMPT_DEDUPE_MS) return;

        if (navigator.permissions?.query) {
          try {
            const permission = await navigator.permissions.query({ name: "geolocation" });
            setLocationPermissionState(permission.state || "unknown");
            if (permission.state === "granted") {
              try {
                localStorage.setItem(LOCATION_PERMISSION_GRANTED_KEY, "1");
              } catch {
                // Ignore storage failures.
              }
            }
            if (permission.state === "denied") {
              setLocationPermissionDenied(true);
              setManualLocationAllowed(true);
              setLocationStatus(uiText("user.locationPermissionDenied"));
              return;
            }
            if (permission.state === "prompt") {
              setManualLocationAllowed(true);
              setLocationStatus("");
              try {
                const prompted = sessionStorage.getItem(AUTO_LOCATION_SESSION_PROMPT_KEY) === "1";
                if (prompted) return;
                sessionStorage.setItem(AUTO_LOCATION_SESSION_PROMPT_KEY, "1");
              } catch {
                // Ignore sessionStorage failures; continue prompting once.
              }
            }
          } catch {
            // Ignore permissions API failures and fall through.
          }
        }

        localStorage.setItem(AUTO_LOCATION_PROMPT_KEY, String(now));
      } catch {
        // Ignore storage failures; continue with normal behavior.
      }
      detectLocation(GEOLOCATION_MODES.auto);
    };

    void maybeAutoDetect();
  }, [detectLocation, locationAutoSucceeded, setLocationPermissionDenied, setLocationStatus, setManualLocationAllowed]);

  useEffect(() => {
    if (!locationAutoSucceeded) return;
    setLocationPermissionDenied(false);
    setManualLocationAllowed(true);
    setLocationStatus("");
  }, [locationAutoSucceeded, setLocationPermissionDenied, setLocationStatus, setManualLocationAllowed]);

  useEffect(() => {
    if (locationPermissionState !== "granted" || locating) return;
    setLocationPermissionDenied(false);
    setManualLocationAllowed(true);
  }, [locationPermissionState, locating, setLocationPermissionDenied, setManualLocationAllowed]);

  useEffect(() => {
    const sanitized = sanitizeLocationValue(demographics.location);
    if (sanitized !== String(demographics.location || "")) {
      setDemographics((prev) => ({ ...prev, location: sanitized }));
      if (!sanitized) setManualLocationAllowed(true);
    }
  }, [demographics.location, setDemographics, setManualLocationAllowed]);

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
    validatePriorExperienceInput,
    validateUsernameInput,
  ]);

  const handleSubmit = useCallback(async () => {
    if (!isOnline) {
      setErrors((prev) => ({
        ...prev,
        [USER_DETAIL_FIELDS.general]: uiText("user.offlineSubmit"),
      }));
      setPendingFlag(scopedUserDetailsPendingKey);
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
    suppressAvailabilityRef.current = true;
    Object.keys(debounceTimerRef.current).forEach((key) => {
      if (debounceTimerRef.current[key]) {
        clearScheduledTimeout(debounceTimerRef.current[key]);
        debounceTimerRef.current[key] = null;
      }
    });
    Object.keys(availabilityAbortRef.current).forEach((key) => {
      if (availabilityAbortRef.current[key]) {
        availabilityAbortRef.current[key].abort();
        availabilityAbortRef.current[key] = null;
      }
    });
    setSubmitting(true);
    setChecking({ username: true, email: true });

    try {
      const normalizedUsername = String(demographics.username || "").trim();
      const normalizedEmail = String(demographics.email || "").trim().toLowerCase();

      let usernameCheck;
      let emailCheck;
      try {
        [usernameCheck, emailCheck] = await Promise.all([
          endpoints.checkUsername(normalizedUsername),
          endpoints.checkEmail(normalizedEmail),
        ]);
      } catch (error) {
        if (error?.code === REQUEST_CODES.aborted) return;
        setErrors((prev) => ({
          ...prev,
          [USER_DETAIL_FIELDS.general]: error?.message || getErrorMessage("SYS_001_0001"),
        }));
        return;
      }

      const results = [
        { field: "username", available: usernameCheck?.available !== false },
        { field: "email", available: emailCheck?.available !== false },
      ];
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

      const participant = await onSubmit();
      const effectivePublicId = requirePublicId(participant?.public_id || publicId, () => {
        addToast?.(getErrorMessage("NF_001_0001"), "warning");
      });
      if (!effectivePublicId) throw new Error(getErrorMessage("NF_001_0001"));
      submittedPublicIdRef.current = effectivePublicId;
      submittedEmailRef.current = normalizedEmail;
      setEmailEditable(false);
      setOtpError("");
      setOtpDigits(Array.from({ length: otpLength }, () => ""));
      setOtpStatus(OTP_STATUS.sending);
      try {
        const response = await endpoints.requestEmailOtp(effectivePublicId, normalizedEmail, false);
        setOtpStatus(OTP_STATUS.sent);
        setResendInitialSeconds(runtimeConfig.emailOtpResendCooldownSeconds);
        resendEndsAtRef.current = Date.now() + runtimeConfig.emailOtpResendCooldownSeconds * 1000;
        setResendCountdownActive(true);
        const expiresAtValue = response?.expires_at || response?.expiresAt;
        const parsedExpiry = expiresAtValue ? Date.parse(expiresAtValue) : NaN;
        const expiresAt = Number.isFinite(parsedExpiry)
          ? parsedExpiry
          : Date.now() + runtimeConfig.emailOtpExpirySeconds * 1000;
        const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
        otpExpiresAtRef.current = expiresAt;
        setOtpExpiresAt(expiresAt);
        setOtpExpirySeconds(remaining);
        addToast?.(uiText("email.sentToast"), "success");
      } catch (err) {
        if (err?.code === REQUEST_CODES.aborted) return;
        setOtpStatus(OTP_STATUS.sendFailed);
        setResendCountdownActive(false);
        resendEndsAtRef.current = null;
        setEmailEditable(true);
        setOtpError(err?.message || getErrorMessage("SYS_002_0002"));
      }
    } catch (error) {
      if (error?.code === REQUEST_CODES.aborted) return;
      const mappedField = USER_DETAILS_ERROR_CODE_TO_FIELD[error?.code] || error?.field || null;
      if (mappedField) {
        setErrors((prev) => ({
          ...prev,
          [mappedField]: getDisplayErrorMessage(error, USER_DETAILS_DUPLICATE_ERROR_CODES[mappedField] || "SYS_001_0001"),
        }));
        return;
      }
      if (error?.status === 409) {
        try {
          const [u, e] = await Promise.all([
            demographics.username?.trim()
              ? endpoints.checkUsername(demographics.username.trim()).catch(() => ({ available: true }))
              : Promise.resolve({ available: true }),
            demographics.email?.trim()
              ? endpoints.checkEmail(demographics.email.trim()).catch(() => ({ available: true }))
              : Promise.resolve({ available: true }),
          ]);
          const conflictErrors = {};
          if (u?.available === false) conflictErrors[USER_DETAIL_FIELDS.username] = getErrorMessage(USER_DETAILS_DUPLICATE_ERROR_CODES.username);
          if (e?.available === false) conflictErrors[USER_DETAIL_FIELDS.email] = getErrorMessage(USER_DETAILS_DUPLICATE_ERROR_CODES.email);
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
      setChecking({ username: false, email: false });
      suppressAvailabilityRef.current = false;
    }
  }, [addToast, demographics, isOnline, onSubmit, otpLength, publicId, scopedUserDetailsPendingKey, validateForm]);

  useEffect(() => {
    if (!isOnline || submitting) return;
    const pending = getPendingFlag(scopedUserDetailsPendingKey) === true;
    if (!pending) return;
    removeStoredKey(scopedUserDetailsPendingKey);
    setPendingSubmit(false);
    handleSubmit();
  }, [handleSubmit, isOnline, scopedUserDetailsPendingKey, submitting]);

  useEffect(() => {
    if (!isOnline) return;
    setIsSaving(true);
    setSaveError("");
    if (draftSaveTimeoutRef.current) {
      clearScheduledTimeout(draftSaveTimeoutRef.current);
    }
    draftSaveTimeoutRef.current = scheduleTimeout(() => {
      try {
        const meta =
          readStoredMeta(scopedDemographicsKey, "local") ||
          readStoredMeta(DEMOGRAPHICS_KEY, "local");
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
      } finally {
        if (saveTimeoutRef.current) {
          clearScheduledTimeout(saveTimeoutRef.current);
        }
        saveTimeoutRef.current = scheduleTimeout(() => setIsSaving(false), 400);
      }
    }, 700);
  }, [demographics, isOnline, scopedDemographicsKey]);

  useEffect(() => {
    if (!isOnline) setIsSaving(false);
  }, [isOnline]);

  useEffect(() => () => {
    if (saveTimeoutRef.current) clearScheduledTimeout(saveTimeoutRef.current);
    if (draftSaveTimeoutRef.current) clearScheduledTimeout(draftSaveTimeoutRef.current);
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

  const setOtpDigit = useCallback((index, value) => {
    const digitsOnly = String(value || "").replace(/\D/g, "");
    setOtpDigits((prev) => {
      const next = [...prev];
      if (!digitsOnly) {
        next[index] = "";
        return next;
      }
      next[index] = digitsOnly.slice(-1);
      return next;
    });
  }, []);

  const setOtpFromPaste = useCallback((index, value) => {
    const digitsOnly = String(value || "").replace(/\D/g, "");
    if (!digitsOnly) return;
    setOtpDigits((prev) => {
      const next = [...prev];
      const slice = digitsOnly.slice(0, otpLength - index);
      slice.split("").forEach((digit, offset) => {
        next[index + offset] = digit;
      });
      return next;
    });
  }, [otpLength]);

  const verifyOtp = useCallback(async () => {
    const effectivePublicId = requirePublicId(submittedPublicIdRef.current || publicId);
    const normalizedEmail = String(demographics.email || "").trim().toLowerCase();
    const normalizedOtp = String(otpValue || "").replace(/\D/g, "");
    if (!effectivePublicId || !normalizedEmail) {
      setOtpError(getErrorMessage("VAL_003_0001"));
      return;
    }
    if (!normalizedOtp || normalizedOtp.length !== otpLength) {
      setOtpError(getErrorMessage("AUTH_003_0001"));
      return;
    }
    if (!isOnline) {
      setOtpError(uiText("email.offlineBanner"));
      return;
    }
    setOtpStatus(OTP_STATUS.verifying);
    setOtpError("");
    try {
      await endpoints.verifyEmailOtp(effectivePublicId, normalizedEmail, normalizedOtp);
      setOtpStatus(OTP_STATUS.verified);
      forEachStorageArea((area) => {
        removeStoredKey(EMAIL_OTP_STATE_KEY, area);
        removeStoredKey(scopedOtpKey, area);
      });
      addToast?.(uiText("email.verifiedToast"), "success");
      onEmailVerified?.();
    } catch (err) {
      if (err?.code === REQUEST_CODES.aborted) return;
      setOtpStatus(OTP_STATUS.verifyFailed);
      autoVerifyRef.current = "";
      setOtpDigits(Array.from({ length: otpLength }, () => ""));
      setEmailEditable(true);
      setOtpError(err?.message || getErrorMessage("SYS_002_0002"));
    }
  }, [addToast, demographics.email, isOnline, onEmailVerified, otpLength, otpValue, publicId, scopedOtpKey]);

  useEffect(() => {
    if (![OTP_STATUS.sent, OTP_STATUS.verifyFailed].includes(otpStatus)) return;
    if (!otpValue || otpValue.length !== otpLength) return;
    if (autoVerifyRef.current === otpValue) return;
    autoVerifyRef.current = otpValue;
    verifyOtp();
  }, [otpLength, otpStatus, otpValue, verifyOtp]);

  const handleResend = useCallback(async () => {
    const effectivePublicId = requirePublicId(submittedPublicIdRef.current || publicId);
    const normalizedEmail = String(demographics.email || "").trim().toLowerCase();
    if (!effectivePublicId || !normalizedEmail) {
      setOtpError(getErrorMessage("VAL_003_0001"));
      return;
    }
    if (!isOnline) {
      setOtpError(uiText("email.offlineRequest"));
      return;
    }
    const emailUpdate = submittedEmailRef.current && submittedEmailRef.current !== normalizedEmail;
    autoVerifyRef.current = "";
    setOtpStatus(OTP_STATUS.sending);
    setOtpError("");
    try {
      const response = await endpoints.requestEmailOtp(effectivePublicId, normalizedEmail, emailUpdate);
      submittedEmailRef.current = normalizedEmail;
      setOtpDigits(Array.from({ length: otpLength }, () => ""));
      setOtpStatus(OTP_STATUS.sent);
      setResendInitialSeconds(runtimeConfig.emailOtpResendCooldownSeconds);
      resendEndsAtRef.current = Date.now() + runtimeConfig.emailOtpResendCooldownSeconds * 1000;
      setResendCountdownActive(true);
      const expiresAtValue = response?.expires_at || response?.expiresAt;
      const parsedExpiry = expiresAtValue ? Date.parse(expiresAtValue) : NaN;
      const expiresAt = Number.isFinite(parsedExpiry)
        ? parsedExpiry
        : Date.now() + runtimeConfig.emailOtpExpirySeconds * 1000;
      const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      otpExpiresAtRef.current = expiresAt;
      setOtpExpiresAt(expiresAt);
      setOtpExpirySeconds(remaining);
      addToast?.(uiText("email.sentToast"), "success");
    } catch (err) {
      if (err?.code === REQUEST_CODES.aborted) return;
      setOtpStatus(OTP_STATUS.sendFailed);
      setResendCountdownActive(false);
      resendEndsAtRef.current = null;
      setEmailEditable(true);
      setOtpError(err?.message || getErrorMessage("SYS_002_0002"));
    }
  }, [addToast, demographics.email, isOnline, otpLength, publicId]);

  useEffect(() => {
    if (resendCountdownActive && resendSeconds === 0) {
      setResendCountdownActive(false);
      resendEndsAtRef.current = null;
    }
  }, [resendCountdownActive, resendSeconds]);

  useEffect(() => {
    if (!resendCountdownActive) return;
    if (otpExpirySeconds > 0) return;
    if (![OTP_STATUS.sent, OTP_STATUS.verifyFailed].includes(otpStatus)) return;
    setResendCountdownActive(false);
    resendEndsAtRef.current = null;
  }, [otpExpirySeconds, otpStatus, resendCountdownActive]);

  useEffect(() => {
    if (!submittedEmailRef.current) return;
    const normalizedEmail = String(demographics.email || "").trim().toLowerCase();
    if (normalizedEmail !== submittedEmailRef.current && otpStatus !== OTP_STATUS.verified) {
      setOtpDigits(Array.from({ length: otpLength }, () => ""));
      setOtpStatus((prev) => (prev === OTP_STATUS.idle ? prev : OTP_STATUS.sendFailed));
      setOtpError("");
    }
  }, [demographics.email, otpLength, otpStatus]);

  useEffect(() => {
    if (otpStatus === OTP_STATUS.idle) {
      forEachStorageArea((area) => {
        removeStoredKey(EMAIL_OTP_STATE_KEY, area);
        removeStoredKey(scopedOtpKey, area);
      });
      otpExpiresAtRef.current = null;
      setOtpExpiresAt(null);
      setOtpExpirySeconds(0);
      return;
    }
    if (resendCountdownActive && !resendEndsAtRef.current) {
      resendEndsAtRef.current = Date.now() + Math.max(1, resendSeconds) * 1000;
    }
    const payload = {
      publicId: submittedPublicIdRef.current || publicId,
      email: String(demographics.email || "").trim().toLowerCase(),
      submittedEmail: submittedEmailRef.current,
      otpStatus,
      resendEndsAt: resendEndsAtRef.current,
      otpExpiresAt: otpExpiresAtRef.current || otpExpiresAt,
      emailEditable,
    };
    writeExpiringValue(scopedOtpKey, payload, {
      area: "local",
      ttlMs: EMAIL_OTP_TTL_MS,
      schemaVersion: runtimeConfig.uiStateSchemaVersion,
    });
    // Clear any legacy/unscoped copies.
    removeStoredKey(EMAIL_OTP_STATE_KEY, "session");
    removeStoredKey(EMAIL_OTP_STATE_KEY, "local");
  }, [
    demographics.email,
    emailEditable,
    otpDigits,
    otpExpiresAt,
    otpStatus,
    publicId,
    resendCountdownActive,
    resendSeconds,
    scopedOtpKey,
  ]);

  const getFieldError = useCallback((field, value) => {
    switch (field) {
      case "username":
        return validateUsernameInput(value);
      case "email":
        return validateEmailInput(value);
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
    validatePriorExperienceInput,
    validateUsernameInput,
  ]);

  const checkAvailability = useCallback(async (field, value) => {
    if (suppressAvailabilityRef.current) return;
    if (!value || value.trim().length === 0) return;
    if (field === "username" && value.trim().length < USERNAME_MIN_LENGTH) return;
    if (field === "email") {
      if (!REGEX_PATTERNS.email.test(value.trim())) return;
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
          : Promise.resolve({ available: true });
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
    if (suppressAvailabilityRef.current) return;
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
    priorExperienceGroups: optionLists.priorExperiences,
    optionsLoading,
    errors,
    submitting,
    checking,
    locating,
    locationStatus,
    locationPermissionDenied,
    locationPermissionState,
    manualLocationAllowed,
    locationAutoSucceeded,
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
    otpDigits,
    otpValue,
    otpLength,
    showOtpField,
    otpStatus,
    otpError,
    otpExpirySeconds,
    resendSeconds,
    emailInputDisabled,
    inputsLocked,
    setOtpDigit,
    setOtpFromPaste,
    handleResend,
  };
}
