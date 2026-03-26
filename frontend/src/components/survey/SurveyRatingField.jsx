import React from "react";
import { runtimeConfig } from "../../config/runtime";
import { uiText } from "../../utils/uiText.js";

function RatingScale({
  name,
  label,
  value,
  setValue,
  imageReady,
  disabled,
  onBlur,
}) {
  const maxRating = runtimeConfig.maxRating;
  const ratingValues = Array.from(
    { length: Math.max(0, runtimeConfig.maxRating - runtimeConfig.minRating + 1) },
    (_, index) => runtimeConfig.minRating + index
  );
  return (
    <div className="field effort-rating">
      <label>
        {label} <span className="required" aria-label="required">*</span> {value > 0 ? `${value}/${maxRating}` : ""}
      </label>
      <div className={`rating-scale ${(!imageReady || disabled) ? "rating-scale-disabled" : ""}`}>
        {ratingValues.map((option) => (
          <label key={`${name}-${option}`} className="rating-option">
            <input
              type="radio"
              name={name}
              value={option}
              checked={value === option}
              onChange={() => setValue(option)}
              onBlur={onBlur}
              disabled={disabled || !imageReady}
            />
            <span className="rating-label">{option}</span>
          </label>
        ))}
      </div>
      <div className="rating-labels">
        <span>{uiText("survey.ratingLow")}</span>
        <span>{uiText("survey.ratingHigh")}</span>
      </div>
    </div>
  );
}

function SurveyRatingField({
  difficultyRating,
  setDifficultyRating,
  confidenceScore,
  setConfidenceScore,
  imageReady,
  disabled = false,
  onDifficultyBlur,
  onConfidenceBlur,
}) {
  return (
    <>
      <RatingScale
        name="difficulty-self-report"
        label={uiText("survey.difficultyLabel")}
        value={difficultyRating}
        setValue={setDifficultyRating}
        imageReady={imageReady}
        disabled={disabled}
        onBlur={onDifficultyBlur}
      />
      <RatingScale
        name="confidence-score"
        label={uiText("survey.confidenceLabel")}
        value={confidenceScore}
        setValue={setConfidenceScore}
        imageReady={imageReady}
        disabled={disabled}
        onBlur={onConfidenceBlur}
      />
    </>
  );
}

export default React.memo(SurveyRatingField);
