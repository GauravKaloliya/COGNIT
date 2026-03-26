import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { endpoints } from "../../utils/api.js";
import { runtimeConfig } from "../../config/runtime";
import { getErrorMessage } from "../../utils/errorRegistry.js";
import { REQUEST_CODES } from "../../constants/request";
import { USER_DETAILS_DUPLICATE_ERROR_CODES, USER_DETAIL_FIELDS } from "../../constants/userDetails";
import { REGEX_PATTERNS } from "../../constants/patterns";
import { buildUserDetailsValidators } from "../../utils/userDetailsHelpers";
import { clearScheduledTimeout, scheduleTimeout } from "../../utils/timing";
import { makeScopedKey, readStoredMeta } from "../../utils/storage";

const USERNAME_MIN_LENGTH = runtimeConfig.usernameMinLength;
const AGE_MIN = runtimeConfig.ageMin;
const AGE_MAX = runtimeConfig.ageMax;
const LOCATION_MIN_LENGTH = runtimeConfig.locationMinLength;
const DEMOGRAPHICS_KEY = runtimeConfig.storageKeys.demographics;
const REQUIRED_FIELDS = [
  USER_DETAIL_FIELDS.username,
  USER_DETAIL_FIELDS.email,
  USER_DETAIL_FIELDS.genderCode,
  USER_DETAIL_FIELDS.age,
  USER_DETAIL_FIELDS.location,
  USER_DETAIL_FIELDS.languageCode,
  USER_DETAIL_FIELDS.priorExperience,
];

const FIELD_META_ACTIONS = {
  replaceErrors: "replace-errors",
  setError: "set-error",
  clearError: "clear-error",
  markDirty: "mark-dirty",
  markTouched: "mark-touched",
  markTouchedBatch: "mark-touched-batch",
};

const INITIAL_FIELD_META = {
  errors: {},
  dirty: {},
  touched: {},
};

function fieldMetaReducer(state, action) {
  switch (action.type) {
    case FIELD_META_ACTIONS.replaceErrors: {
      return {
        ...state,
        errors: action.errors || {},
      };
    }
    case FIELD_META_ACTIONS.setError: {
      return {
        ...state,
        errors: {
          ...state.errors,
          [action.field]: action.message,
        },
      };
    }
    case FIELD_META_ACTIONS.clearError: {
      if (!state.errors[action.field]) return state;
      const nextErrors = { ...state.errors };
      delete nextErrors[action.field];
      return {
        ...state,
        errors: nextErrors,
      };
    }
    case FIELD_META_ACTIONS.markDirty: {
      if (state.dirty[action.field]) return state;
      return {
        ...state,
        dirty: {
          ...state.dirty,
          [action.field]: true,
        },
      };
    }
    case FIELD_META_ACTIONS.markTouched: {
      if (state.touched[action.field]) return state;
      return {
        ...state,
        touched: {
          ...state.touched,
          [action.field]: true,
        },
      };
    }
    case FIELD_META_ACTIONS.markTouchedBatch: {
      const nextTouched = { ...state.touched };
      action.fields.forEach((field) => {
        nextTouched[field] = true;
      });
      return {
        ...state,
        touched: nextTouched,
      };
    }
    default:
      return state;
  }
}

export function useUserDetailsValidationDraft({
  demographics,
  setDemographics,
  scope,
  canPersist = false,
}) {
  const scopedDemographicsKey = canPersist && scope ? makeScopedKey(DEMOGRAPHICS_KEY, scope) : null;
  const [fieldMeta, dispatchFieldMeta] = useReducer(fieldMetaReducer, INITIAL_FIELD_META);
  const [checking, setChecking] = useState({ username: false, email: false });
  const [draftRestored, setDraftRestored] = useState(false);
  const debounceTimerRef = useRef({ username: null, email: null });
  const availabilityAbortRef = useRef({ username: null, email: null });
  const suppressAvailabilityRef = useRef(false);
  const validators = useMemo(() => buildUserDetailsValidators({
    usernameMinLength: USERNAME_MIN_LENGTH,
    ageMin: AGE_MIN,
    ageMax: AGE_MAX,
    locationMinLength: LOCATION_MIN_LENGTH,
  }), []);
  const errors = fieldMeta.errors;
  const errorsRef = useRef(errors);

  useEffect(() => {
    errorsRef.current = errors;
  }, [errors]);

  const setErrors = useCallback((updater) => {
    const nextErrors = typeof updater === "function"
      ? updater(errorsRef.current)
      : updater || {};
    dispatchFieldMeta({
      type: FIELD_META_ACTIONS.replaceErrors,
      errors: nextErrors,
    });
  }, []);

  useEffect(() => {
    if (!scopedDemographicsKey) return;
    const storedMeta = readStoredMeta(scopedDemographicsKey, "local");
    if (storedMeta) {
      setDraftRestored(true);
    }
  }, [scopedDemographicsKey]);

  useEffect(() => () => {
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
  }, []);

  const validateUsernameInput = useCallback((rawUsername) => validators.validateUsernameInput(rawUsername), [validators]);
  const validateEmailInput = useCallback((rawEmail) => validators.validateEmailInput(rawEmail), [validators]);
  const validateGenderInput = useCallback((rawGender) => validators.validateGenderInput(rawGender), [validators]);
  const validateAgeInput = useCallback((rawAge) => validators.validateAgeInput(rawAge), [validators]);
  const validateLocationInput = useCallback((rawLocation) => validators.validateLocationInput(rawLocation), [validators]);
  const validateLanguageInput = useCallback((rawLanguage) => validators.validateLanguageInput(rawLanguage), [validators]);
  const validatePriorExperienceInput = useCallback((rawPriorExperience) => validators.validatePriorExperienceInput(rawPriorExperience), [validators]);

  const validateForm = useCallback(() => {
    const nextErrors = {};
    const usernameError = validateUsernameInput(demographics.username);
    if (usernameError) nextErrors[USER_DETAIL_FIELDS.username] = usernameError;
    const emailError = validateEmailInput(demographics.email);
    if (emailError) nextErrors[USER_DETAIL_FIELDS.email] = emailError;
    const genderError = validateGenderInput(demographics.gender_code);
    if (genderError) nextErrors[USER_DETAIL_FIELDS.genderCode] = genderError;
    const ageError = validateAgeInput(demographics.age);
    if (ageError) nextErrors[USER_DETAIL_FIELDS.age] = ageError;
    const locationError = validateLocationInput(demographics.location);
    if (locationError) nextErrors[USER_DETAIL_FIELDS.location] = locationError;
    const languageError = validateLanguageInput(demographics.language_code);
    if (languageError) nextErrors[USER_DETAIL_FIELDS.languageCode] = languageError;
    const priorExperienceError = validatePriorExperienceInput(demographics.prior_experience);
    if (priorExperienceError) nextErrors[USER_DETAIL_FIELDS.priorExperience] = priorExperienceError;
    dispatchFieldMeta({
      type: FIELD_META_ACTIONS.markTouchedBatch,
      fields: REQUIRED_FIELDS,
    });
    dispatchFieldMeta({
      type: FIELD_META_ACTIONS.replaceErrors,
      errors: nextErrors,
    });
    return Object.keys(nextErrors).length === 0;
  }, [
    demographics.age,
    demographics.email,
    demographics.gender_code,
    demographics.language_code,
    demographics.location,
    demographics.prior_experience,
    demographics.username,
    validateAgeInput,
    validateEmailInput,
    validateGenderInput,
    validateLanguageInput,
    validateLocationInput,
    validatePriorExperienceInput,
    validateUsernameInput,
  ]);

  const updateField = useCallback((field, value) => {
    setDemographics((prev) => ({ ...prev, [field]: value }));
    dispatchFieldMeta({ type: FIELD_META_ACTIONS.markDirty, field });
    dispatchFieldMeta({ type: FIELD_META_ACTIONS.clearError, field });
  }, [setDemographics]);

  const getFieldError = useCallback((field, value) => {
    switch (field) {
      case USER_DETAIL_FIELDS.username:
        return validateUsernameInput(value);
      case USER_DETAIL_FIELDS.email:
        return validateEmailInput(value);
      case USER_DETAIL_FIELDS.genderCode:
        return validateGenderInput(value);
      case USER_DETAIL_FIELDS.age:
        return validateAgeInput(value);
      case USER_DETAIL_FIELDS.location:
        return validateLocationInput(value);
      case USER_DETAIL_FIELDS.languageCode:
        return validateLanguageInput(value);
      case USER_DETAIL_FIELDS.priorExperience:
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
    const trimmed = String(value || "").trim();
    if (!trimmed) return;
    if (field === USER_DETAIL_FIELDS.username && trimmed.length < USERNAME_MIN_LENGTH) return;
    if (field === USER_DETAIL_FIELDS.email && !REGEX_PATTERNS.email.test(trimmed)) return;
    if (![USER_DETAIL_FIELDS.username, USER_DETAIL_FIELDS.email].includes(field)) return;

    setChecking((prev) => ({ ...prev, [field]: true }));
    dispatchFieldMeta({ type: FIELD_META_ACTIONS.clearError, field });

    try {
      if (availabilityAbortRef.current[field]) {
        availabilityAbortRef.current[field].abort();
      }
      const controller = new AbortController();
      availabilityAbortRef.current[field] = controller;
      const result = field === USER_DETAIL_FIELDS.username
        ? await endpoints.checkUsername(trimmed, { signal: controller.signal })
        : await endpoints.checkEmail(trimmed, { signal: controller.signal });
      if (result?.available === false) {
        const errorCode = USER_DETAILS_DUPLICATE_ERROR_CODES[field] || USER_DETAILS_DUPLICATE_ERROR_CODES.fallback;
        dispatchFieldMeta({
          type: FIELD_META_ACTIONS.setError,
          field,
          message: getErrorMessage(errorCode),
        });
      }
    } catch (error) {
      if (error?.code !== REQUEST_CODES.aborted) {
        // Ignore duplicate-check failures to avoid blocking user typing.
      }
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
      void checkAvailability(field, value);
    }, runtimeConfig.availabilityDebounceMs);
  }, [checkAvailability]);

  const handleFieldBlur = useCallback((field, value, checkDuplicate = false) => {
    const error = getFieldError(field, value);
    dispatchFieldMeta({ type: FIELD_META_ACTIONS.markTouched, field });
    if (error) {
      dispatchFieldMeta({
        type: FIELD_META_ACTIONS.setError,
        field,
        message: error,
      });
    } else {
      dispatchFieldMeta({ type: FIELD_META_ACTIONS.clearError, field });
    }
    if (!error && checkDuplicate) {
      debouncedCheck(field, value);
    }
  }, [debouncedCheck, getFieldError]);

  const startSubmitValidation = useCallback(() => {
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
    setChecking({ username: true, email: true });
  }, []);

  const endSubmitValidation = useCallback(() => {
    suppressAvailabilityRef.current = false;
    setChecking({ username: false, email: false });
  }, []);

  const setGeneralError = useCallback((message) => {
    if (message) {
      dispatchFieldMeta({
        type: FIELD_META_ACTIONS.setError,
        field: USER_DETAIL_FIELDS.general,
        message,
      });
      return;
    }
    dispatchFieldMeta({
      type: FIELD_META_ACTIONS.clearError,
      field: USER_DETAIL_FIELDS.general,
    });
  }, []);

  const clearGeneralError = useCallback(() => {
    setGeneralError("");
  }, [setGeneralError]);

  return {
    errors,
    setErrors,
    checking,
    fieldMeta,
    draftRestored,
    validateForm,
    updateField,
    handleFieldBlur,
    startSubmitValidation,
    endSubmitValidation,
    setGeneralError,
    clearGeneralError,
  };
}
