import React from "react";
import { uiText } from "../../utils/uiText.js";

export default function SurveyRatingField({ rating, setRating, imageReady }) {
  return (
    <div className="field effort-rating">
      <label>
        {uiText("survey.ratingLabel")} <span className="required" aria-label="required">*</span> {rating > 0 ? `${rating}/10` : ""}
      </label>
      <div className={`rating-scale ${!imageReady ? "rating-scale-disabled" : ""}`}>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((val) => (
          <label key={val} className="rating-option">
            <input
              type="radio"
              name="effort-rating"
              value={val}
              checked={rating === val}
              onChange={() => setRating(val)}
              disabled={!imageReady}
            />
            <span className="rating-label">{val}</span>
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
