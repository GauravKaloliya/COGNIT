import React from "react";
import { uiText } from "../../utils/uiText.js";
import DSButton from "../design/DSButton.jsx";

export default function UserProfileFields({
  demographics,
  errors,
  optionsLoading,
  inputsLocked,
  isMobile,
  locating,
  locationStatus,
  locationPermissionState,
  userEditedLocationRef,
  genderOptions,
  languageOptions,
  priorExperienceGroups,
  ageMin,
  ageMax,
  locationMin,
  ageOk,
  locationOk,
  updateField,
  handleFieldBlur,
  detectLocation,
}) {
  return (
    <>
      <div className={`form-field gender-field ${errors.gender_code ? "error" : ""} ${optionsLoading ? "loading" : ""}`}>
        <label>{uiText("user.gender")} <span className="required" aria-label="required">*</span></label>
        <select
          className={errors.gender_code ? "error-input" : ""}
          value={demographics.gender_code || ""}
          disabled={optionsLoading || genderOptions.length === 0 || inputsLocked}
          onChange={(e) => updateField("gender_code", e.target.value)}
          onBlur={(e) => handleFieldBlur("gender_code", e.target.value)}
        >
          <option value="" disabled>{uiText("user.genderPlaceholder")}</option>
          {genderOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        {optionsLoading && <span className="checking-text">{uiText("user.checking")}</span>}
        {errors.gender_code && <span className="error-text">{errors.gender_code}</span>}
      </div>

      <div className={`form-field age-field ${errors.age ? "error" : ""} ${optionsLoading ? "loading" : ""}`}>
        <label>{uiText("user.age")} <span className="required" aria-label="required">*</span></label>
        <input
          type="number"
          inputMode="numeric"
          pattern="[0-9]*"
          className={`number-left${errors.age ? " error-input" : ""}`}
          min={ageMin}
          max={ageMax}
          placeholder={uiText("user.agePlaceholderRange", { min: ageMin, max: ageMax })}
          value={demographics.age || ""}
          disabled={inputsLocked}
          onChange={(e) => updateField("age", e.target.value.replace(/\D/g, ""))}
          onBlur={(e) => handleFieldBlur("age", e.target.value)}
        />
        {errors.age && <span className="error-text">{errors.age}</span>}
        {!ageOk && (
          <span className="helper-text warning">{uiText("user.ageHint", { min: ageMin, max: ageMax })}</span>
        )}
      </div>

      <div className={`form-field location-field ${errors.location ? "error" : ""} ${optionsLoading ? "loading" : ""}`}>
        <label>{uiText("user.location")} <span className="required" aria-label="required">*</span></label>
        <input
          type="text"
          className={errors.location ? "error-input" : ""}
          placeholder={locating ? uiText("user.locationPlaceholderDetecting") : uiText("user.locationPlaceholderManual")}
          value={demographics.location || ""}
          disabled={locating || inputsLocked}
          readOnly={locating || inputsLocked}
          onChange={(e) => {
            userEditedLocationRef.current = true;
            updateField("location", e.target.value);
          }}
          onBlur={(e) => handleFieldBlur("location", e.target.value)}
        />
        {!isMobile && locationPermissionState !== "granted" && !locating && (
          <DSButton
            type="button"
            variant="ghost"
            className="location-permission-btn"
            disabled={inputsLocked}
            onClick={() => detectLocation("manual")}
          >
            {uiText("user.enableLocation")}
          </DSButton>
        )}
        {!isMobile && locationStatus && <span className="checking-text">{locationStatus}</span>}
        {!isMobile && locationPermissionState === "denied" && (
          <span className="helper-text warning">{uiText("user.locationPermissionHelp")}</span>
        )}
        {errors.location && <span className="error-text">{errors.location}</span>}
        {!locationOk && (
          <span className="helper-text warning">{uiText("user.locationHint", { min: locationMin })}</span>
        )}
      </div>

      <div className={`form-field language-field ${errors.language_code ? "error" : ""} ${optionsLoading ? "loading" : ""}`}>
        <label>{uiText("user.language")} <span className="required" aria-label="required">*</span></label>
        <select
          className={errors.language_code ? "error-input" : ""}
          value={demographics.language_code || ""}
          disabled={optionsLoading || languageOptions.length === 0 || inputsLocked}
          onChange={(e) => updateField("language_code", e.target.value)}
          onBlur={(e) => handleFieldBlur("language_code", e.target.value)}
        >
          <option value="" disabled>{uiText("user.languagePlaceholder")}</option>
          {languageOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        {optionsLoading && <span className="checking-text">{uiText("user.checking")}</span>}
        {errors.language_code && <span className="error-text">{errors.language_code}</span>}
      </div>

      <div className={`form-field prior-experience-field ${errors.prior_experience ? "error" : ""} ${optionsLoading ? "loading" : ""}`}>
        <label>{uiText("user.priorExperience")} <span className="required" aria-label="required">*</span></label>
        <select
          className={errors.prior_experience ? "error-input" : ""}
          value={demographics.prior_experience || ""}
          disabled={inputsLocked}
          onChange={(e) => updateField("prior_experience", e.target.value)}
          onBlur={(e) => handleFieldBlur("prior_experience", e.target.value)}
        >
          <option value="" disabled>{uiText("user.priorExperiencePlaceholder")}</option>
          {priorExperienceGroups.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.options.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
        {errors.prior_experience && <span className="error-text">{errors.prior_experience}</span>}
      </div>
    </>
  );
}
