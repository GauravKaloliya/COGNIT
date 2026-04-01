import React from "react";
import { uiText } from "../../utils/uiText.js";
import SectionSkeleton from "../SectionSkeleton.jsx";
import FullscreenIcon from "../icons/FullscreenIcon.jsx";
import ZoomIcon from "../icons/ZoomIcon.jsx";
import DSButton from "../design/DSButton.jsx";

export default function SurveyImagePanel({
  imageSrc,
  imageLoaded,
  imageError,
  showImageError,
  errorMessage,
  isZoomed,
  isFullscreen,
  setIsZoomed,
  setIsFullscreen,
  handleImageLoad,
  handleImageError,
  imageRef,
}) {
  const [animateIn, setAnimateIn] = React.useState(true);
  const fullscreenShellRef = React.useRef(null);

  React.useEffect(() => {
    setAnimateIn(true);
  }, [imageSrc]);

  React.useEffect(() => {
    if (!isFullscreen) return undefined;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isFullscreen]);

  React.useEffect(() => {
    if (!isFullscreen) return undefined;

    const fullscreenElement = fullscreenShellRef.current;
    const requestFullscreen = fullscreenElement?.requestFullscreen?.bind(fullscreenElement);

    if (typeof requestFullscreen === "function" && document.fullscreenElement !== fullscreenElement) {
      requestFullscreen().catch(() => {});
    }

    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) {
        setIsFullscreen(false);
      }
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      if (document.fullscreenElement === fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
    };
  }, [isFullscreen, setIsFullscreen]);

  const openFullscreen = React.useCallback(() => {
    if (!imageLoaded || imageError) return;
    setIsFullscreen(true);
  }, [imageError, imageLoaded, setIsFullscreen]);

  const closeFullscreen = React.useCallback(() => {
    setIsFullscreen(false);
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
  }, [setIsFullscreen]);

  if (showImageError) {
    return (
      <div className="image-container premium-image-surface">
        <div className="image-error">
          <p>{errorMessage || uiText("survey.imageRestoreFailed")}</p>
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
          className={`survey-image ${animateIn && !isZoomed ? "image-animate-in" : ""} ${isZoomed ? "image-is-zoomed" : ""}`.trim()}
          src={imageSrc}
          alt={uiText("survey.promptAlt")}
          onClick={openFullscreen}
          onLoad={handleImageLoad}
          onError={() => handleImageError({ reasonHint: "img_element_error" })}
          onAnimationEnd={(event) => {
            if (event.animationName === "survey-image-content-enter") {
              setAnimateIn(false);
            }
          }}
          style={{ display: imageLoaded ? "block" : "none" }}
        />
      ) : null}
      {(!imageLoaded || imageError) && (
        <div className="image-loading">
          <SectionSkeleton title={uiText("survey.loadingImage")} rows={4} dense />
        </div>
      )}
      <div className="image-action-group">
        <DSButton
          variant="ghost"
          type="button"
          className="image-action-button fullscreen-toggle"
          onClick={openFullscreen}
          disabled={!imageLoaded || imageError}
          aria-label={uiText("survey.openFullscreen")}
          title={uiText("survey.openFullscreen")}
        >
          <FullscreenIcon className="zoom-toggle-icon" />
        </DSButton>
        <DSButton
          variant="ghost"
          type="button"
          className="image-action-button zoom-toggle"
          onClick={() => setIsZoomed((prev) => !prev)}
          disabled={!imageLoaded || imageError}
          aria-label={isZoomed ? uiText("survey.resetZoom") : uiText("survey.zoom")}
          title={isZoomed ? uiText("survey.resetZoom") : uiText("survey.zoom")}
        >
          <ZoomIcon zoomed={isZoomed} className="zoom-toggle-icon" />
        </DSButton>
      </div>
      {isFullscreen && imageLoaded && !imageError ? (
        <div
          className="image-fullscreen-modal"
          role="dialog"
          aria-modal="true"
          aria-label={uiText("survey.fullscreenTitle")}
          onClick={closeFullscreen}
        >
          <div className="image-fullscreen-ambient image-fullscreen-ambient-left" />
          <div className="image-fullscreen-ambient image-fullscreen-ambient-right" />
          <div className="image-fullscreen-grain" />
          <div
            ref={fullscreenShellRef}
            className="image-fullscreen-shell"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="image-fullscreen-chrome">
              <div className="image-fullscreen-copy">
                <span className="image-fullscreen-badge">{uiText("survey.fullscreenBadge")}</span>
                <div className="image-fullscreen-text">
                  <strong>{uiText("survey.fullscreenTitle")}</strong>
                  <span>{uiText("survey.fullscreenHint")}</span>
                </div>
              </div>
            </div>
            <div className="image-fullscreen-stage">
              <div className="image-fullscreen-stage-glow" />
              <div className="image-fullscreen-letterbox image-fullscreen-letterbox-top" />
              <div className="image-fullscreen-letterbox image-fullscreen-letterbox-bottom" />
              <div className="image-fullscreen-frame">
                <img
                  className="image-fullscreen-asset"
                  src={imageSrc}
                  alt={uiText("survey.promptAlt")}
                />
              </div>
            </div>
            <DSButton
              variant="ghost"
              type="button"
              className="image-fullscreen-close"
              onClick={closeFullscreen}
              aria-label={uiText("survey.closeFullscreen")}
              title={uiText("survey.closeFullscreen")}
            >
              x
            </DSButton>
          </div>
        </div>
      ) : null}
    </div>
  );
}
