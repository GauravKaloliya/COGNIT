import React from "react";
import { uiText } from "../../utils/uiText.js";
import SectionSkeleton from "../SectionSkeleton.jsx";
import DSButton from "../design/DSButton.jsx";

export default function SurveyImagePanel({
  imageSrc,
  imageLoaded,
  imageError,
  showImageError,
  errorMessage,
  isZoomed,
  setIsZoomed,
  _retryCountdown,
  retryDisabled,
  handleRetryImage,
  handleImageLoad,
  handleImageError,
}) {
  if (showImageError) {
    return (
      <div className="image-container">
        <div className="image-error">
          <p>{errorMessage || uiText("survey.imageRestoreFailed")}</p>
          <DSButton variant="primary" className="small button-top" onClick={handleRetryImage} disabled={retryDisabled}>
            {uiText("common.retry")}
          </DSButton>
        </div>
      </div>
    );
  }

  return (
    <div className={`image-container ${isZoomed ? "zoomed" : ""}`}>
      {!imageError ? (
        <img
          key={imageSrc}
          src={imageSrc}
          alt={uiText("survey.promptAlt")}
          onClick={() => setIsZoomed(!isZoomed)}
          onLoad={handleImageLoad}
          onError={handleImageError}
          style={{ display: imageLoaded ? "block" : "none" }}
        />
      ) : null}
      {(!imageLoaded || imageError) && (
        <div className="image-loading">
          <SectionSkeleton title={uiText("survey.loadingImage")} rows={4} dense />
        </div>
      )}
      <DSButton
        variant="ghost"
        className="zoom-toggle"
        onClick={() => setIsZoomed(!isZoomed)}
        disabled={!imageLoaded || imageError}
      >
        {isZoomed ? uiText("survey.resetZoom") : uiText("survey.zoom")}
      </DSButton>
    </div>
  );
}
