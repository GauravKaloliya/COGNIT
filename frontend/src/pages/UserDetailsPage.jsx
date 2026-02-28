import React, { useState, useEffect, useRef, useCallback } from "react";
import { endpoints } from "../utils/api.js";
import { getErrorMessage } from "../utils/errorRegistry.js";

const USERNAME_MIN_LENGTH = parseInt(import.meta.env.VITE_USERNAME_MIN_LENGTH || "2", 10);
const AGE_MIN = parseInt(import.meta.env.VITE_AGE_MIN || "13", 10);
const AGE_MAX = parseInt(import.meta.env.VITE_AGE_MAX || "100", 10);
const LOCATION_MIN_LENGTH = parseInt(import.meta.env.VITE_LOCATION_MIN_LENGTH || "2", 10);

const DUPLICATE_ERROR_CODES = {
  username: 'DUP_001_0001',
  email: 'DUP_001_0002',
  phone: 'DUP_001_0003'
};

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
  const debounceTimerRef = useRef({ username: null, email: null, phone: null });

  useEffect(() => {
    document.title = "User Details - C.O.G.N.I.T.";
  }, []);

  const validateForm = () => {
    const newErrors = {};

    // Username validation - no spaces, no special chars except underscore
    if (!demographics.username || demographics.username.trim().length < USERNAME_MIN_LENGTH) {
      newErrors.username = getErrorMessage('VAL_001_0010', 'en', { min: USERNAME_MIN_LENGTH });
    } else if (!/^[a-zA-Z0-9_]+$/.test(demographics.username)) {
      newErrors.username = getErrorMessage('VAL_001_0011');
    }
    
    // Email validation - only Gmail, Microsoft (Outlook/Hotmail), Apple (iCloud)
    const allowedEmailDomains = ['gmail.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'me.com', 'mac.com'];
    if (!demographics.email) {
      newErrors.email = getErrorMessage('VAL_001_0012');
    } else {
      const emailLower = demographics.email.toLowerCase().trim();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(emailLower)) {
        newErrors.email = getErrorMessage('VAL_001_0013');
      } else {
        const domain = emailLower.split('@')[1];
        if (!allowedEmailDomains.includes(domain)) {
          newErrors.email = getErrorMessage('VAL_001_0014');
        }
      }
    }
    
    // Phone validation - Indian numbers only (10 digits, starts with 6-9)
    if (!demographics.phone) {
      newErrors.phone = getErrorMessage('VAL_001_0015');
    } else {
      // Remove all non-digit characters
      const phoneDigits = demographics.phone.replace(/\D/g, '');
      // Indian mobile numbers: 10 digits starting with 6, 7, 8, or 9
      // Also handle +91 prefix (12 digits total)
      const isValidIndian = /^[6-9]\d{9}$/.test(phoneDigits) || 
                            (phoneDigits.length === 12 && phoneDigits.startsWith('91') && /^[6-9]/.test(phoneDigits.slice(2)));
      if (!isValidIndian) {
        newErrors.phone = getErrorMessage('VAL_001_0016');
      }
    }
    
    if (!demographics.gender_code) {
      newErrors.gender_code = getErrorMessage('VAL_001_0017');
    }
    
    // Age validation - AGE_MIN to AGE_MAX only
    if (!demographics.age) {
      newErrors.age = getErrorMessage('VAL_001_0018');
    } else {
      const ageNum = parseInt(demographics.age);
      if (isNaN(ageNum) || ageNum < AGE_MIN || ageNum > AGE_MAX) {
        newErrors.age = getErrorMessage('VAL_001_0019', 'en', { min: AGE_MIN, max: AGE_MAX });
      }
    }

    if (!demographics.location || demographics.location.trim().length < LOCATION_MIN_LENGTH) {
      newErrors.location = getErrorMessage('VAL_001_0020');
    }
    
    if (!demographics.language_code) {
      newErrors.language_code = getErrorMessage('VAL_001_0021');
    }
    
    if (!demographics.prior_experience) {
      newErrors.prior_experience = getErrorMessage('VAL_001_0022');
    }
    
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
      const request = field === "username"
        ? endpoints.checkUsername(value.trim())
        : field === "email"
          ? endpoints.checkEmail(value.trim())
          : endpoints.checkPhone(value.trim());
      const data = await request;
      
      if (!data.available) {
        const errorCode = DUPLICATE_ERROR_CODES[field] || 'DUP_001_0004';
        setErrors(prev => ({
          ...prev,
          [field]: getErrorMessage(errorCode)
        }));
      }
    } catch (error) {
      // Silently fail - don't block user on network errors
    } finally {
      setChecking(prev => ({ ...prev, [field]: false }));
    }
  }, []);

  const debouncedCheck = useCallback((field, value) => {
    if (debounceTimerRef.current[field]) {
      clearTimeout(debounceTimerRef.current[field]);
    }
    debounceTimerRef.current[field] = setTimeout(() => {
      checkAvailability(field, value);
    }, 500);
  }, [checkAvailability]);

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
            onChange={(e) => updateField('username', e.target.value)}
            onBlur={(e) => debouncedCheck('username', e.target.value)}
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
            onBlur={(e) => debouncedCheck('email', e.target.value)}
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
              debouncedCheck('phone', value);
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
          />
          {errors.age && <span className="error-text">{errors.age}</span>}
        </div>

        <div className={`form-field ${errors.location ? 'error' : ''}`}>
          <label>Place/Location <span className="required" aria-label="required">*</span></label>
          <input
            type="text"
            className={errors.location ? 'error-input' : ''}
            placeholder="e.g., Mumbai, India"
            value={demographics.location || ''}
            onChange={(e) => updateField('location', e.target.value)}
          />
          {errors.location && <span className="error-text">{errors.location}</span>}
        </div>

        <div className={`form-field ${errors.language_code ? 'error' : ''}`}>
          <label>Native Language <span className="required" aria-label="required">*</span></label>
          <select
            className={errors.language_code ? 'error-input' : ''}
            value={demographics.language_code || ''}
            onChange={(e) => updateField('language_code', e.target.value)}
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

      <div className="page-actions">
        <button
          className="primary"
          onClick={handleSubmit}
          disabled={!systemReady || submitting || !isFormComplete || Object.keys(errors).length > 0}
        >
          {submitting ? "Submitting..." : "Continue"}
        </button>
      </div>
    </div>
  );
}