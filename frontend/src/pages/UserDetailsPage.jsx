import React, { useState, useEffect } from "react";
import { getApiUrl } from "../utils/apiBase";

export default function UserDetailsPage({
  demographics,
  setDemographics,
  onSubmit,
  systemReady,
  onBack
}) {
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    document.title = "User Details - C.O.G.N.I.T.";
  }, []);

  const validateForm = () => {
    const newErrors = {};
    
    // Username validation - no spaces, no special chars except underscore
    if (!demographics.username || demographics.username.trim().length < 2) {
      newErrors.username = "Username is required (min 2 characters)";
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
    
    if (!demographics.gender) {
      newErrors.gender = "Gender is required";
    }
    
    // Age validation - 13 to 100 only
    if (!demographics.age) {
      newErrors.age = "Age is required";
    } else {
      const ageNum = parseInt(demographics.age);
      if (isNaN(ageNum) || ageNum < 13 || ageNum > 100) {
        newErrors.age = "Age must be between 13 and 100";
      }
    }
    
    if (!demographics.place || demographics.place.trim().length < 2) {
      newErrors.place = "Place/Location is required";
    }
    
    if (!demographics.native_language) {
      newErrors.native_language = "Native language is required";
    }
    
    if (!demographics.prior_experience) {
      newErrors.prior_experience = "Prior experience is required";
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
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
      setErrors(prev => ({ ...prev, [field]: null }));
    }
  };

  const requiredFields = [
    "username",
    "email",
    "phone",
    "gender",
    "age",
    "place",
    "native_language",
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
          />
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
          />
          {errors.email && <span className="error-text">{errors.email}</span>}
        </div>

        <div className={`form-field ${errors.phone ? 'error' : ''}`}>
          <label>Phone Number <span className="required" aria-label="required">*</span></label>
          <input
            type="tel"
            className={errors.phone ? 'error-input' : ''}
            placeholder="10-digit Indian mobile number"
            value={demographics.phone || ''}
            onChange={(e) => updateField('phone', e.target.value)}
          />
          {errors.phone && <span className="error-text">{errors.phone}</span>}
        </div>

        <div className={`form-field ${errors.gender ? 'error' : ''}`}>
          <label>Gender <span className="required" aria-label="required">*</span></label>
          <select
            className={errors.gender ? 'error-input' : ''}
            value={demographics.gender || ''}
            onChange={(e) => updateField('gender', e.target.value)}
          >
            <option value="" disabled>Select gender</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="non-binary">Non-binary</option>
            <option value="prefer-not-say">Prefer not to say</option>
            <option value="other">Other</option>
          </select>
          {errors.gender && <span className="error-text">{errors.gender}</span>}
        </div>

        <div className={`form-field ${errors.age ? 'error' : ''}`}>
          <label>Age <span className="required" aria-label="required">*</span></label>
          <input
            type="number"
            className={`number-left${errors.age ? ' error-input' : ''}`}
            min="13"
            max="100"
            placeholder="Age (13-100)"
            value={demographics.age || ''}
            onChange={(e) => updateField('age', e.target.value)}
          />
          {errors.age && <span className="error-text">{errors.age}</span>}
        </div>

        <div className={`form-field ${errors.place ? 'error' : ''}`}>
          <label>Place/Location <span className="required" aria-label="required">*</span></label>
          <input
            type="text"
            className={errors.place ? 'error-input' : ''}
            placeholder="e.g., Mumbai, India"
            value={demographics.place || ''}
            onChange={(e) => updateField('place', e.target.value)}
          />
          {errors.place && <span className="error-text">{errors.place}</span>}
        </div>

        <div className={`form-field ${errors.native_language ? 'error' : ''}`}>
          <label>Native Language <span className="required" aria-label="required">*</span></label>
          <select
            className={errors.native_language ? 'error-input' : ''}
            value={demographics.native_language || ''}
            onChange={(e) => updateField('native_language', e.target.value)}
          >
            <option value="" disabled>Select native language</option>
            <option value="English">English</option>
            <option value="Hindi">Hindi (हिन्दी)</option>
            <option value="Bengali">Bengali (বাংলা)</option>
            <option value="Telugu">Telugu (తెలుగు)</option>
            <option value="Marathi">Marathi (मराठी)</option>
            <option value="Tamil">Tamil (தமிழ்)</option>
            <option value="Urdu">Urdu (اردو)</option>
            <option value="Gujarati">Gujarati (ગુજરાતી)</option>
            <option value="Kannada">Kannada (ಕನ್ನಡ)</option>
            <option value="Malayalam">Malayalam (മലയാളം)</option>
          </select>
          {errors.native_language && <span className="error-text">{errors.native_language}</span>}
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
          disabled={!systemReady || submitting || !isFormComplete}
        >
          {submitting ? "Submitting..." : "Continue"}
        </button>
      </div>
    </div>
  );
}