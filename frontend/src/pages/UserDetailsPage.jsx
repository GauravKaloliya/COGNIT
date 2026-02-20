import React, { useState, useEffect, useRef, useCallback } from "react";
import { getApiUrl } from "../utils/apiBase";

const USERNAME_MIN_LENGTH = parseInt(import.meta.env.VITE_USERNAME_MIN_LENGTH || "2", 10);
const AGE_MIN = parseInt(import.meta.env.VITE_AGE_MIN || "13", 10);
const AGE_MAX = parseInt(import.meta.env.VITE_AGE_MAX || "100", 10);
const LOCATION_MIN_LENGTH = parseInt(import.meta.env.VITE_LOCATION_MIN_LENGTH || "2", 10);

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
      newErrors.username = `Username is required (min ${USERNAME_MIN_LENGTH} characters)`;
    } else if (!/^[a-zA-Z0-9_]+$/.test(demographics.username)) {
      newErrors.username = "Username can only contain letters, numbers, and underscores (no spaces or special characters)";
    }
    
    // Email validation - only Gmail, Microsoft (Outlook/Hotmail), Apple (iCloud)
    const allowedEmailDomains = ['gmail.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'me.com', 'mac.com'];
    if (!demographics.email) {
      newErrors.email = "Email is required";
    } else {
      const emailLower = demographics.email.toLowerCase().trim();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(emailLower)) {
        newErrors.email = "Please enter a valid email address";
      } else {
        const domain = emailLower.split('@')[1];
        if (!allowedEmailDomains.includes(domain)) {
          newErrors.email = "Only Gmail, Outlook, Hotmail, and iCloud email addresses are allowed";
        }
      }
    }
    
    // Phone validation - Indian numbers only (10 digits, starts with 6-9)
    if (!demographics.phone) {
      newErrors.phone = "Phone number is required";
    } else {
      // Remove all non-digit characters
      const phoneDigits = demographics.phone.replace(/\D/g, '');
      // Indian mobile numbers: 10 digits starting with 6, 7, 8, or 9
      // Also handle +91 prefix (12 digits total)
      const isValidIndian = /^[6-9]\d{9}$/.test(phoneDigits) || 
                            (phoneDigits.length === 12 && phoneDigits.startsWith('91') && /^[6-9]/.test(phoneDigits.slice(2)));
      if (!isValidIndian) {
        newErrors.phone = "Please enter a valid 10-digit Indian mobile number";
      }
    }
    
    if (!demographics.gender_code) {
      newErrors.gender_code = "Gender is required";
    }
    
    // Age validation - AGE_MIN to AGE_MAX only
    if (!demographics.age) {
      newErrors.age = "Age is required";
    } else {
      const ageNum = parseInt(demographics.age);
      if (isNaN(ageNum) || ageNum < AGE_MIN || ageNum > AGE_MAX) {
        newErrors.age = `Age must be between ${AGE_MIN} and ${AGE_MAX}`;
      }
    }

    if (!demographics.location || demographics.location.trim().length < LOCATION_MIN_LENGTH) {
      newErrors.location = "Place/Location is required";
    }
    
    if (!demographics.language_code) {
      newErrors.language_code = "Native language is required";
    }
    
    if (!demographics.prior_experience) {
      newErrors.prior_experience = "Prior experience is required";
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

    try {
      await onSubmit();
    } finally {
      setSubmitting(false);
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
      const endpoint = field === "username" ? "check-username" : field === "email" ? "check-email" : "check-phone";
      const response = await fetch(`${getApiUrl(`/${endpoint}`)}?${field}=${encodeURIComponent(value.trim())}`);
      const data = await response.json();
      
      if (!data.available) {
        setErrors(prev => ({
          ...prev,
          [field]: `This ${field} is already registered`
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