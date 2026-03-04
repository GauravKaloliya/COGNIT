import React, { useState, useEffect, useRef, useCallback } from "react";
import { endpoints } from "../utils/api.js";
import { getErrorMessage } from "../utils/errorRegistry.js";
import { runtimeConfig } from "../config/runtime";
import PageSkeleton from "../components/PageSkeleton.jsx";
import SectionSkeleton from "../components/SectionSkeleton.jsx";

const USERNAME_MIN_LENGTH = runtimeConfig.usernameMinLength;
const AGE_MIN = runtimeConfig.ageMin;
const AGE_MAX = runtimeConfig.ageMax;
const LOCATION_MIN_LENGTH = runtimeConfig.locationMinLength;
const LOCATION_PERMISSION_REQUIRED_MESSAGE = "You have to enable location permission to submit this form.";

const DUPLICATE_ERROR_CODES = {
  username: 'DUP_001_0001',
  email: 'DUP_001_0002',
  phone: 'DUP_001_0003'
};

const sanitizeUsername = (value) => value.replace(/[^a-zA-Z0-9_]/g, "");

export default function UserDetailsPage({
  demographics,
  setDemographics,
  onSubmit,
  systemReady,
  onBack
}) {
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [checking, setChecking] = useState({ username: false, email: false, phone: false });
  const [locating, setLocating] = useState(false);
  const [locationStatus, setLocationStatus] = useState("");
  const [locationPermissionDenied, setLocationPermissionDenied] = useState(false);
  const debounceTimerRef = useRef({ username: null, email: null, phone: null });
  const reverseGeocodeAbortRef = useRef(null);
  const availabilityAbortRef = useRef({ username: null, email: null, phone: null });

  useEffect(() => {
    document.title = "User Details - C.O.G.N.I.T.";
  }, []);

  const validateUsernameInput = useCallback((rawUsername) => {
    const value = String(rawUsername ?? "").trim();
    if (!value || value.length < USERNAME_MIN_LENGTH) {
      return getErrorMessage('VAL_001_0010', 'en', { min: USERNAME_MIN_LENGTH });
    }
    if (!/^[a-zA-Z0-9_]+$/.test(value)) {
      return getErrorMessage('VAL_001_0011');
    }
    return "";
  }, []);

  const validateEmailInput = useCallback((rawEmail) => {
    const value = String(rawEmail ?? "").trim().toLowerCase();
    const allowedEmailDomains = ['gmail.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'me.com', 'mac.com'];
    if (!value) {
      return getErrorMessage('VAL_001_0012');
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(value)) {
      return getErrorMessage('VAL_001_0013');
    }
    const domain = value.split('@')[1];
    if (!allowedEmailDomains.includes(domain)) {
      return getErrorMessage('VAL_001_0014');
    }
    return "";
  }, []);

  const validatePhoneInput = useCallback((rawPhone) => {
    const phoneDigits = String(rawPhone ?? "").replace(/\D/g, '');
    if (!phoneDigits) {
      return getErrorMessage('VAL_001_0015');
    }
    const isValidIndian = /^[6-9]\d{9}$/.test(phoneDigits) ||
      (phoneDigits.length === 12 && phoneDigits.startsWith('91') && /^[6-9]/.test(phoneDigits.slice(2)));
    if (!isValidIndian) {
      return getErrorMessage('VAL_001_0016');
    }
    return "";
  }, []);

  const validateGenderInput = useCallback((rawGender) => {
    return String(rawGender ?? "").trim() ? "" : getErrorMessage('VAL_001_0017');
  }, []);

  const validateAgeInput = useCallback((rawAge) => {
    const trimmed = String(rawAge ?? "").trim();
    if (!trimmed) {
      return getErrorMessage('VAL_001_0018');
    }
    if (!/^\d+$/.test(trimmed)) {
      return getErrorMessage('VAL_001_0019', 'en', { min: AGE_MIN, max: AGE_MAX });
    }
    const ageNum = Number(trimmed);
    if (!Number.isInteger(ageNum) || ageNum < AGE_MIN || ageNum > AGE_MAX) {
      return getErrorMessage('VAL_001_0019', 'en', { min: AGE_MIN, max: AGE_MAX });
    }
    return "";
  }, []);

  const validateLocationInput = useCallback((rawLocation) => {
    const value = String(rawLocation ?? "").trim();
    return value.length >= LOCATION_MIN_LENGTH ? "" : getErrorMessage('VAL_001_0020');
  }, []);

  const validateLanguageInput = useCallback((rawLanguage) => {
    return String(rawLanguage ?? "").trim() ? "" : getErrorMessage('VAL_001_0021');
  }, []);

  const validatePriorExperienceInput = useCallback((rawPriorExperience) => {
    return String(rawPriorExperience ?? "").trim() ? "" : getErrorMessage('VAL_001_0022');
  }, []);

  const setDetectedLocation = useCallback((value) => {
    setDemographics((prev) => ({ ...prev, location: value }));
    setLocationPermissionDenied(false);
    setErrors((prev) => {
      if (!prev.location) return prev;
      const next = { ...prev };
      delete next.location;
      return next;
    });
  }, [setDemographics]);

  const detectLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setLocationStatus("Geolocation is not supported in this browser.");
      setLocationPermissionDenied(true);
      setErrors((prev) => ({
        ...prev,
        location: LOCATION_PERMISSION_REQUIRED_MESSAGE,
      }));
      return;
    }

    setLocating(true);
    setLocationStatus("Requesting location permission...");

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        const fallback = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
        let detectedLocation = fallback;

        try {
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
          }
        } catch (_err) {
          // Keep coordinate fallback when reverse geocoding fails.
        } finally {
          reverseGeocodeAbortRef.current = null;
        }

        setDetectedLocation(detectedLocation);
        setLocationStatus("Location detected successfully.");
        setLocating(false);
      },
      (error) => {
        const denied = error?.code === 1;
        setLocationPermissionDenied(denied);
        setLocationStatus(denied ? "Location permission denied." : "Unable to detect location.");
        setErrors((prev) => ({
          ...prev,
          location: denied
            ? LOCATION_PERMISSION_REQUIRED_MESSAGE
            : "Unable to detect location. Please try again.",
        }));
        setLocating(false);
      },
      {
        enableHighAccuracy: false,
        timeout: runtimeConfig.geolocationTimeoutMs,
        maximumAge: runtimeConfig.geolocationMaxAgeMs,
      }
    );
  }, [setDetectedLocation]);

  useEffect(() => {
    if (!demographics.location || demographics.location.trim().length < LOCATION_MIN_LENGTH) {
      detectLocation();
    }
  }, [demographics.location, detectLocation]);

  useEffect(() => {
    const availabilityRef = availabilityAbortRef.current;
    return () => {
      if (reverseGeocodeAbortRef.current) {
        reverseGeocodeAbortRef.current.abort();
        reverseGeocodeAbortRef.current = null;
      }
      Object.keys(availabilityRef).forEach((k) => {
        if (availabilityRef[k]) {
          availabilityRef[k].abort();
          availabilityRef[k] = null;
        }
      });
    };
  }, []);

  const validateForm = () => {
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

    const locationError = locationPermissionDenied
      ? LOCATION_PERMISSION_REQUIRED_MESSAGE
      : validateLocationInput(demographics.location);
    if (locationError) newErrors.location = locationError;

    const languageError = validateLanguageInput(demographics.language_code);
    if (languageError) newErrors.language_code = languageError;

    const priorExperienceError = validatePriorExperienceInput(demographics.prior_experience);
    if (priorExperienceError) newErrors.prior_experience = priorExperienceError;
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    // Validate form before submission
    if (!validateForm()) {
      return;
    }

    setSubmitting(true);
    setChecking({ username: true, email: true, phone: true });

    try {
      // Double-check username, email, and phone availability on submit
      const checks = [];
      
      if (demographics.username && demographics.username.trim().length >= USERNAME_MIN_LENGTH) {
        checks.push(
          endpoints.checkUsername(demographics.username.trim())
            .then((data) => ({ field: 'username', available: data.available }))
            .catch(() => ({ field: 'username', available: true }))
        );
      }
      
      if (demographics.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(demographics.email.trim())) {
        checks.push(
          endpoints.checkEmail(demographics.email.trim())
            .then((data) => ({ field: 'email', available: data.available }))
            .catch(() => ({ field: 'email', available: true }))
        );
      }
      
      if (demographics.phone) {
        const phoneDigits = demographics.phone.replace(/\D/g, '');
        const isValidIndian = /^[6-9]\d{9}$/.test(phoneDigits) || 
                              (phoneDigits.length === 12 && phoneDigits.startsWith('91') && /^[6-9]/.test(phoneDigits.slice(2)));
        if (isValidIndian) {
          checks.push(
            endpoints.checkPhone(phoneDigits)
              .then((data) => ({ field: 'phone', available: data.available }))
              .catch(() => ({ field: 'phone', available: true }))
          );
        }
      }
      
      const results = await Promise.all(checks);
      
      const newErrors = {};
      results.forEach(result => {
        if (!result.available) {
          const errorCode = DUPLICATE_ERROR_CODES[result.field] || 'DUP_001_0004';
          newErrors[result.field] = getErrorMessage(errorCode);
        }
      });
      
      if (Object.keys(newErrors).length > 0) {
        setErrors(prev => ({ ...prev, ...newErrors }));
        return;
      }
      
      await onSubmit();
    } finally {
      setSubmitting(false);
      setChecking({ username: false, email: false, phone: false });
    }
  };

  const updateField = (field, value) => {
    setDemographics(prev => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[field];
        return newErrors;
      });
    }
  };

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
    validateUsernameInput,
    validateEmailInput,
    validatePhoneInput,
    validateGenderInput,
    validateAgeInput,
    validateLocationInput,
    validateLanguageInput,
    validatePriorExperienceInput,
  ]);

  const checkAvailability = useCallback(async (field, value) => {
    if (!value || value.trim().length === 0) return;
    
    // Don't check if basic validation fails
    if (field === "username" && value.trim().length < USERNAME_MIN_LENGTH) return;
    if (field === "email") {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(value.trim())) return;
    }
    if (field === "phone") {
      const phoneDigits = value.replace(/\D/g, '');
      const isValidIndian = /^[6-9]\d{9}$/.test(phoneDigits) || 
                            (phoneDigits.length === 12 && phoneDigits.startsWith('91') && /^[6-9]/.test(phoneDigits.slice(2)));
      if (!isValidIndian) return;
    }

    setChecking(prev => ({ ...prev, [field]: true }));
    
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
          : endpoints.checkPhone(value.trim(), { signal: controller.signal });
      const data = await request;
      
      if (!data.available) {
        const errorCode = DUPLICATE_ERROR_CODES[field] || 'DUP_001_0004';
        setErrors(prev => ({
          ...prev,
          [field]: getErrorMessage(errorCode)
        }));
      }
    } catch (error) {
      if (error?.code === "REQ_ABORTED") {
        return;
      }
      // Silently fail - don't block user on network errors
    } finally {
      availabilityAbortRef.current[field] = null;
      setChecking(prev => ({ ...prev, [field]: false }));
    }
  }, []);

  const debouncedCheck = useCallback((field, value) => {
    if (debounceTimerRef.current[field]) {
      clearTimeout(debounceTimerRef.current[field]);
    }
    debounceTimerRef.current[field] = setTimeout(() => {
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
  }, [getFieldError, debouncedCheck]);

  const requiredFields = [
    "username",
    "email",
    "phone",
    "gender_code",
    "age",
    "location",
    "language_code",
    "prior_experience"
  ];

  const isFormComplete = requiredFields.every((field) => {
    const value = demographics[field];
    if (typeof value === "string") {
      return value.trim().length > 0;
    }
    return value !== null && value !== undefined && value !== "";
  });

  if (submitting) {
    return (
      <PageSkeleton
        title="Saving participant details"
        subtitle="Validating identity and availability checks"
        variant="user"
      />
    );
  }

  return (
    <div className="panel">
      <div className="page-top-actions">
        {onBack && (
          <button
            className="ghost back-button"
            onClick={onBack}
          >
            ← Back
          </button>
        )}
      </div>
      <h2>Participant Information</h2>
      <p className="page-subtitle left">
        Provide your details to participate in the C.O.G.N.I.T. research survey.
      </p>
      
      <div className="form-grid">
        <div className={`form-field ${errors.username ? 'error' : ''}`}>
          <label>Username <span className="required" aria-label="required">*</span></label>
          <input
            type="text"
            className={errors.username ? 'error-input' : ''}
            placeholder="Enter your username"
            value={demographics.username || ''}
            onChange={(e) => updateField('username', sanitizeUsername(e.target.value))}
            onBlur={(e) => handleFieldBlur('username', e.target.value, true)}
          />
          {checking.username && <span className="checking-text">Checking...</span>}
          {errors.username && <span className="error-text">{errors.username}</span>}
        </div>

        <div className={`form-field ${errors.email ? 'error' : ''}`}>
          <label>Email <span className="required" aria-label="required">*</span></label>
          <input
            type="email"
            className={errors.email ? 'error-input' : ''}
            placeholder="yourname@gmail.com"
            value={demographics.email || ''}
            onChange={(e) => updateField('email', e.target.value)}
            onBlur={(e) => handleFieldBlur('email', e.target.value, true)}
          />
          {checking.email && <span className="checking-text">Checking...</span>}
          {errors.email && <span className="error-text">{errors.email}</span>}
        </div>

        <div className={`form-field ${errors.phone ? 'error' : ''}`}>
          <label>Phone Number <span className="required" aria-label="required">*</span></label>
          <input
            type="tel"
            inputMode="numeric"
            pattern="[0-9]*"
            className={errors.phone ? 'error-input' : ''}
            placeholder="10-digit Indian mobile number"
            value={demographics.phone || ''}
            onChange={(e) => {
              const value = e.target.value.replace(/\D/g, '');
              updateField('phone', value);
            }}
            onBlur={(e) => {
              const value = e.target.value.replace(/\D/g, '');
              handleFieldBlur('phone', value, true);
            }}
          />
          {checking.phone && <span className="checking-text">Checking...</span>}
          {errors.phone && <span className="error-text">{errors.phone}</span>}
        </div>

        <div className={`form-field ${errors.gender_code ? 'error' : ''}`}>
          <label>Gender <span className="required" aria-label="required">*</span></label>
          <select
            className={errors.gender_code ? 'error-input' : ''}
            value={demographics.gender_code || ''}
            onChange={(e) => updateField('gender_code', e.target.value)}
            onBlur={(e) => handleFieldBlur('gender_code', e.target.value)}
          >
            <option value="" disabled>Select gender</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="non-binary">Non-binary</option>
            <option value="prefer-not-say">Prefer not to say</option>
            <option value="other">Other</option>
          </select>
          {errors.gender_code && <span className="error-text">{errors.gender_code}</span>}
        </div>

        <div className={`form-field ${errors.age ? 'error' : ''}`}>
          <label>Age <span className="required" aria-label="required">*</span></label>
          <input
            type="number"
            inputMode="numeric"
            pattern="[0-9]*"
            className={`number-left${errors.age ? ' error-input' : ''}`}
            min={AGE_MIN}
            max={AGE_MAX}
            placeholder={`Age (${AGE_MIN}-${AGE_MAX})`}
            value={demographics.age || ''}
            onChange={(e) => {
              const value = e.target.value.replace(/\D/g, '');
              updateField('age', value);
            }}
            onBlur={(e) => {
              handleFieldBlur('age', e.target.value);
            }}
          />
          {errors.age && <span className="error-text">{errors.age}</span>}
        </div>

        <div className={`form-field ${errors.location ? 'error' : ''}`}>
          <label>Place/Location <span className="required" aria-label="required">*</span></label>
          <input
            type="text"
            className={errors.location ? 'error-input' : ''}
            placeholder={locating ? "Detecting your location..." : "Auto-detected location"}
            value={demographics.location || ''}
            disabled
            readOnly
          />
          {locating && !(demographics.location || "").trim() && (
            <div className="location-skeleton-wrap">
              <SectionSkeleton title="Detecting your location" rows={2} dense />
            </div>
          )}
          {locationPermissionDenied && !locating && (
            <button
              type="button"
              className="ghost location-permission-btn"
              onClick={detectLocation}
            >
              Enable Location Permission
            </button>
          )}
          {locationStatus && <span className="checking-text">{locationStatus}</span>}
          {errors.location && <span className="error-text">{errors.location}</span>}
        </div>

        <div className={`form-field ${errors.language_code ? 'error' : ''}`}>
          <label>Native Language <span className="required" aria-label="required">*</span></label>
          <select
            className={errors.language_code ? 'error-input' : ''}
            value={demographics.language_code || ''}
            onChange={(e) => updateField('language_code', e.target.value)}
            onBlur={(e) => handleFieldBlur('language_code', e.target.value)}
          >
            <option value="" disabled>Select native language</option>
            <option value="en">English</option>
            <option value="hi">Hindi (हिन्दी)</option>
            <option value="bn">Bengali (বাংলা)</option>
            <option value="te">Telugu (తెలుగు)</option>
            <option value="mr">Marathi (मराठी)</option>
            <option value="ta">Tamil (தமிழ்)</option>
            <option value="ur">Urdu (اردو)</option>
            <option value="gu">Gujarati (ગુજરાતી)</option>
            <option value="kn">Kannada (ಕನ್ನಡ)</option>
            <option value="ml">Malayalam (മലയാളം)</option>
            <option value="other">Other</option>
          </select>
          {errors.language_code && <span className="error-text">{errors.language_code}</span>}
        </div>

        <div className={`form-field ${errors.prior_experience ? 'error' : ''}`}>
          <label>Prior Experience <span className="required" aria-label="required">*</span></label>
          <select
            className={errors.prior_experience ? 'error-input' : ''}
            value={demographics.prior_experience || ''}
            onChange={(e) => updateField('prior_experience', e.target.value)}
            onBlur={(e) => handleFieldBlur('prior_experience', e.target.value)}
          >
            <option value="" disabled>Select prior experience</option>
            <optgroup label="Technical Skills">
              <option value="Programming/Software Development">Programming/Software Development</option>
              <option value="Data Science/Machine Learning">Data Science/Machine Learning</option>
              <option value="Web Development">Web Development</option>
              <option value="Mobile App Development">Mobile App Development</option>
              <option value="Database Administration">Database Administration</option>
              <option value="Cloud Computing/AWS/Azure">Cloud Computing/AWS/Azure</option>
              <option value="Cybersecurity">Cybersecurity</option>
              <option value="Network Administration">Network Administration</option>
              <option value="DevOps/CI-CD">DevOps/CI-CD</option>
              <option value="Computer Vision/AI">Computer Vision/AI</option>
            </optgroup>
            <optgroup label="General Skills">
              <option value="Writing/Content Creation">Writing/Content Creation</option>
              <option value="Public Speaking">Public Speaking</option>
              <option value="Photography">Photography</option>
              <option value="Art/Design/Creative">Art/Design/Creative</option>
              <option value="Music/Performance">Music/Performance</option>
              <option value="Sports/Athletics">Sports/Athletics</option>
              <option value="Cooking/Culinary">Cooking/Culinary</option>
            </optgroup>
            <option value="None">None of the above</option>
          </select>
          {errors.prior_experience && <span className="error-text">{errors.prior_experience}</span>}
        </div>
      </div>

      <div className="page-actions sticky-mobile-actions">
        <button
          className="primary"
          onClick={handleSubmit}
          disabled={
            !systemReady ||
            submitting ||
            !isFormComplete ||
            locationPermissionDenied ||
            Object.keys(errors).length > 0
          }
        >
          {submitting ? "Submitting..." : "Continue"}
        </button>
      </div>
    </div>
  );
}
