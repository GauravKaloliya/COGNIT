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
  retryDisabled,
  handleRetryImage,
  handleImageLoad,
  handleImageError,
  imageRef,
}) {
  if (showImageError) {
    return (
      <div className="image-container premium-image-surface">
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
    <div className={`image-container premium-image-surface ${isZoomed ? "zoomed" : ""} ${imageLoaded ? "is-loaded" : "is-loading"}`}>
      {!imageError ? (
        <img
          ref={imageRef}
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
