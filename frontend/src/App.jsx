import React from "react";
import ServiceUnavailablePage from "./components/ServiceUnavailablePage.jsx";
import OfflinePage from "./components/OfflinePage.jsx";
import DSButton from "./components/design/DSButton.jsx";
import ThemeToggleIcon from "./components/ThemeToggleIcon.jsx";
import AppContainer from "./components/app/AppContainer.jsx";
import AppStageRouter, { prefetchLikelyNextChunks } from "./components/app/AppStageRouter.jsx";
import { getErrorMessage } from "./utils/errorRegistry.js";
import { uiText } from "./utils/uiText.js";
import { telemetryIncrement, telemetryInteraction, telemetryUpdateScrollDepth } from "./utils/clientTelemetry.js";
import { useAppController } from "./hooks/useAppController";
import { useIsMobile } from "./hooks/useIsMobile.js";

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    this.setState({ error });
    this.props.onError?.(error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="panel">
          <h1>{getErrorMessage("SYS_001_0001")}</h1>
          <p>{getErrorMessage("UI_001_0003")}</p>
          {this.state.error?.message && <p className="error-text">{this.state.error.message}</p>}
          {this.state.error?.stack && <pre className="error-details-pre">{this.state.error.stack}</pre>}
        </div>
      );
    }
    return this.props.children;
  }
}

const ToastLayer = React.lazy(() => import("./components/feedback/ToastLayer.jsx"));
const ConfettiLayer = React.lazy(() => import("./components/feedback/ConfettiLayer.jsx"));

export default function App({ darkMode, toggleDarkMode, storageOk = true }) {
  const {
    isOnline,
    isActiveTabOwner,
    stage,
    publicId,
    demographics,
    setDemographics,
    setStage,
    toasts,
    addToast,
    systemReady,
    systemError,
    systemChecking,
    retryHealthCheck,
    survey,
    surveyCompleted,
    setSurveyFeedbackReady,
    consentGiven,
    imageError,
    isFetchingImage,
    showConfetti,
    fetchImage,
    prefetchNextImage,
    handleSubmit,
    claimActiveTabLock,
    dismissToast,
    handleConsentGiven,
    handleUserDetailsSubmit,
    handleEmailVerified,
    handleAccountFlagged,
    resetWorkflowToConsent,
    handleAppError,
    clearUserStorage,
  } = useAppController();
  const isMobile = useIsMobile();
  const [showBackToTop, setShowBackToTop] = React.useState(false);
  const deferredToasts = React.useDeferredValue(toasts);
  const deferredConfetti = React.useDeferredValue(showConfetti);
  const offlineResetDoneRef = React.useRef(false);

  React.useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const onScroll = () => {
      if (!media.matches) {
        setShowBackToTop(false);
        return;
      }
      setShowBackToTop(window.scrollY > 600);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  React.useEffect(() => {
    let rafId = null;
    const scheduleScrollTelemetry = () => {
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        telemetryUpdateScrollDepth();
      });
    };
    const onClick = () => telemetryInteraction("click");
    const onKeydown = () => telemetryInteraction("keypress");
    const onVisibilityChange = () => {
      if (document.hidden) {
        telemetryIncrement("tab_switches");
      }
    };
    const onBeforeUnload = () => telemetryIncrement("page_close_attempts");
    const onOffline = () => telemetryIncrement("network_disconnects");

    window.addEventListener("scroll", scheduleScrollTelemetry, { passive: true });
    window.addEventListener("click", onClick, { passive: true });
    window.addEventListener("keydown", onKeydown);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("offline", onOffline);

    return () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
      window.removeEventListener("scroll", scheduleScrollTelemetry);
      window.removeEventListener("click", onClick);
      window.removeEventListener("keydown", onKeydown);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  React.useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    if (!media.matches) return;
    window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
  }, [stage, systemReady]);

  React.useEffect(() => {
    if (!systemReady) return;
    prefetchLikelyNextChunks(stage);
  }, [stage, systemReady]);

  React.useEffect(() => {
    if (!isOnline) {
      if (!offlineResetDoneRef.current) {
        clearUserStorage?.(publicId);
        offlineResetDoneRef.current = true;
      }
      return;
    }
    offlineResetDoneRef.current = false;
  }, [clearUserStorage, isOnline, publicId]);

  if (!isOnline) {
    return (
      <ErrorBoundary onError={() => {}}>
        <OfflinePage
          onRetry={() => window.location.reload()}
          darkMode={darkMode}
          onToggleDarkMode={toggleDarkMode}
        />
      </ErrorBoundary>
    );
  }

  if (!isActiveTabOwner) {
    return (
      <ErrorBoundary onError={() => {}}>
        <div className="app">
          <header className="header">
            <div className="brand">
              <h1>{uiText("app.brand")}</h1>
              {!isMobile && <p className="subtitle">{uiText("app.subtitle")}</p>}
            </div>
            <div className="header-actions">
              <DSButton
                variant="ghost"
                className="dark-mode-toggle"
                onClick={toggleDarkMode}
                title={darkMode ? uiText("app.darkModeLight") : uiText("app.darkModeDark")}
              >
                <ThemeToggleIcon darkMode={darkMode} />
              </DSButton>
            </div>
          </header>
          <div className="panel status-panel">
            {!storageOk && (
              <div className="banner warning">
                <span>{uiText("app.storageUnavailable")}</span>
              </div>
            )}
            <h2>{uiText("app.anotherTabTitle")}</h2>
            <p className="status-message">{uiText("app.anotherTabMessage")}</p>
            <DSButton variant="primary" onClick={() => claimActiveTabLock(true)}>
              {uiText("app.reclaimTab")}
            </DSButton>
          </div>
        </div>
      </ErrorBoundary>
    );
  }

  if (systemError && !systemReady && !systemChecking) {
    return (
      <ErrorBoundary onError={() => {}}>
        <ServiceUnavailablePage
          error={systemError}
          onRetry={retryHealthCheck}
          isRetrying={systemChecking}
          darkMode={darkMode}
          onToggleDarkMode={toggleDarkMode}
        />
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary onError={handleAppError}>
      <AppContainer
        darkMode={darkMode}
        toggleDarkMode={toggleDarkMode}
        isMobile={isMobile}
        storageOk={storageOk}
        stage={stage}
      >
        <AppStageRouter
          stage={stage}
          systemChecking={systemChecking}
          systemReady={systemReady}
          publicId={publicId}
          consentGiven={consentGiven}
          demographics={demographics}
          setDemographics={setDemographics}
          handleConsentGiven={handleConsentGiven}
          handleUserDetailsSubmit={handleUserDetailsSubmit}
          handleEmailVerified={handleEmailVerified}
          handleAccountFlagged={handleAccountFlagged}
          addToast={addToast}
          survey={survey}
          surveyCompleted={surveyCompleted}
          setSurveyFeedbackReady={setSurveyFeedbackReady}
          setStage={setStage}
          clearUserStorage={clearUserStorage}
          resetWorkflowToConsent={resetWorkflowToConsent}
          fetchImage={fetchImage}
          prefetchNextImage={prefetchNextImage}
          handleSubmit={handleSubmit}
          imageError={imageError}
          isFetchingImage={isFetchingImage}
        />
      </AppContainer>

      {showBackToTop && (
        <DSButton
          variant="ghost"
          className="back-to-top"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          aria-label={uiText("common.backToTop")}
        >
          ↑
        </DSButton>
      )}

      <React.Suspense fallback={null}>
        <ConfettiLayer show={deferredConfetti} />
      </React.Suspense>
      <React.Suspense fallback={null}>
        <ToastLayer toasts={deferredToasts} onDismiss={dismissToast} />
      </React.Suspense>
    </ErrorBoundary>
  );
}
