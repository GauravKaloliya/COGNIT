import React from "react";
import { runtimeConfig } from "../../config/runtime";
import { uiText } from "../../utils/uiText.js";

function detectEmojiSupport() {
  if (typeof document === "undefined") return false;
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const context = canvas.getContext("2d");
  if (!context) return false;
  context.textBaseline = "top";
  context.font = "28px 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif";
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillText("😄", 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] !== 0) {
      return true;
    }
  }
  return false;
}

function RatingScale({
  name,
  label,
  value,
  setValue,
  imageReady,
  disabled,
  onBlur,
  displayValues = null,
  emojiMode = false,
}) {
  const maxRating = runtimeConfig.maxRating;
  const ratingValues = Array.from(
    { length: Math.max(0, runtimeConfig.maxRating - runtimeConfig.minRating + 1) },
    (_, index) => runtimeConfig.minRating + index
  );
  return (
    <div className="field effort-rating">
      <div className="field-header">
        <label>
          {label} <span className="required" aria-label={uiText("common.requiredAria")}>*</span> {value > 0 ? `${value}/${maxRating}` : ""}
        </label>
        <span className={`status-badge ${value > 0 ? "met" : "pending"}`}>
          {value > 0 ? uiText("survey.minimumMet") : uiText("survey.ratingBadge")}
        </span>
      </div>
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
            <span className={`rating-label rating-label-${option} ${emojiMode ? "rating-label-emoji" : ""}`}>
              {emojiMode ? (
                <span className="rating-emoji-glyph" aria-hidden="true">
                  {displayValues?.[option] || option}
                </span>
              ) : (
                displayValues?.[option] || option
              )}
            </span>
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
  confidenceRating,
  setConfidenceRating,
  imageReady,
  disabled = false,
  onDifficultyBlur,
  onConfidenceBlur,
}) {
  const [emojiSupported, setEmojiSupported] = React.useState(false);

  React.useEffect(() => {
    setEmojiSupported(detectEmojiSupport());
  }, []);

  const confidenceDisplayValues = React.useMemo(() => (
    emojiSupported
      ? {
          1: "😟",
          2: "🙂",
          3: "😌",
          4: "😄",
          5: "🤩",
        }
      : null
  ), [emojiSupported]);

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
        name="confidence-rating"
        label={uiText("survey.confidenceLabel")}
        value={confidenceRating}
        setValue={setConfidenceRating}
        imageReady={imageReady}
        disabled={disabled}
        onBlur={onConfidenceBlur}
        displayValues={confidenceDisplayValues}
        emojiMode={emojiSupported}
      />
    </>
  );
}

export default React.memo(SurveyRatingField);
