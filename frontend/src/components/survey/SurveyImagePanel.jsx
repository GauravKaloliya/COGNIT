import React from "react";
import { getErrorMessage } from "../../utils/errorRegistry.js";
import { uiText } from "../../utils/uiText.js";
import SectionSkeleton from "../SectionSkeleton.jsx";
import DSButton from "../design/DSButton.jsx";

export default function SurveyImagePanel({
  imageSrc,
  imageLoaded,
  imageError,
  isZoomed,
  setIsZoomed,
  retryCountdown,
  retryDisabled,
  handleRetryImage,
  handleImageLoad,
  handleImageError,
}) {
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
      ) : (
        <div className="image-error">
          <p>{getErrorMessage("SYS_002_0005")}</p>
          {retryCountdown > 0 && (
            <DSButton variant="primary" className="small button-top" disabled>
              {uiText("common.tryAgainIn", { seconds: retryCountdown })}
            </DSButton>
          )}
          {!retryDisabled && (
            <DSButton variant="primary" className="small button-top" onClick={handleRetryImage}>
              {uiText("common.retry")}
            </DSButton>
          )}
        </div>
      )}
      {!imageLoaded && !imageError && (
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
