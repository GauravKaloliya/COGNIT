import React from "react";
import { uiText } from "../../utils/uiText.js";
import DSButton from "../design/DSButton.jsx";

function UserProfileFields({
  genderCode,
  age,
  location,
  languageCode,
  priorExperience,
  genderError,
  ageError,
  locationError,
  languageError,
  priorExperienceError,
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
      <div className={`form-field gender-field ${genderError ? "error" : ""} ${optionsLoading ? "loading" : ""}`}>
        <label>{uiText("user.gender")} <span className="required" aria-label="required">*</span></label>
        <select
          className={genderError ? "error-input" : ""}
          value={genderCode || ""}
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
        {genderError && <span className="error-text">{genderError}</span>}
      </div>

      <div className={`form-field age-field ${ageError ? "error" : ""} ${optionsLoading ? "loading" : ""}`}>
        <label>{uiText("user.age")} <span className="required" aria-label="required">*</span></label>
        <input
          type="number"
          inputMode="numeric"
          pattern="[0-9]*"
          className={`number-left${ageError ? " error-input" : ""}`}
          min={ageMin}
          max={ageMax}
          placeholder={uiText("user.agePlaceholderRange", { min: ageMin, max: ageMax })}
          value={age || ""}
          disabled={inputsLocked}
          onChange={(e) => updateField("age", e.target.value.replace(/\D/g, ""))}
          onBlur={(e) => handleFieldBlur("age", e.target.value)}
        />
        {ageError && <span className="error-text">{ageError}</span>}
        {!ageOk && (
          <span className="helper-text warning">{uiText("user.ageHint", { min: ageMin, max: ageMax })}</span>
        )}
      </div>

      <div className={`form-field location-field ${locationError ? "error" : ""} ${optionsLoading ? "loading" : ""}`}>
        <label>{uiText("user.location")} <span className="required" aria-label="required">*</span></label>
        <input
          type="text"
          className={locationError ? "error-input" : ""}
          placeholder={locating ? uiText("user.locationPlaceholderDetecting") : uiText("user.locationPlaceholderManual")}
          value={location || ""}
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
        {locationError && <span className="error-text">{locationError}</span>}
        {!locationOk && (
          <span className="helper-text warning">{uiText("user.locationHint", { min: locationMin })}</span>
        )}
      </div>

      <div className={`form-field language-field ${languageError ? "error" : ""} ${optionsLoading ? "loading" : ""}`}>
        <label>{uiText("user.language")} <span className="required" aria-label="required">*</span></label>
        <select
          className={languageError ? "error-input" : ""}
          value={languageCode || ""}
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
        {languageError && <span className="error-text">{languageError}</span>}
      </div>

      <div className={`form-field prior-experience-field ${priorExperienceError ? "error" : ""} ${optionsLoading ? "loading" : ""}`}>
        <label>{uiText("user.priorExperience")} <span className="required" aria-label="required">*</span></label>
        <select
          className={priorExperienceError ? "error-input" : ""}
          value={priorExperience || ""}
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
        {priorExperienceError && <span className="error-text">{priorExperienceError}</span>}
      </div>
    </>
  );
}

export default React.memo(UserProfileFields);
