import React from "react";
import UserDetailsPage from "./pages/UserDetailsPage.jsx";
import ConsentPage from "./pages/ConsentPage.jsx";
import PaymentContentPage from "./pages/PaymentContentPage.jsx";
import PaymentLinkPage from "./pages/PaymentLinkPage.jsx";
import SurveyPage from "./pages/SurveyPage.jsx";
import SurveyFeedPage from "./pages/SurveyFeedPage.jsx";
import FinishedPage from "./pages/FinishedPage.jsx";
import ServiceUnavailablePage from "./components/ServiceUnavailablePage.jsx";
import PageSkeleton from "./components/PageSkeleton.jsx";
import ThemeToggleIcon from "./components/ThemeToggleIcon.jsx";
import FlowStepper from "./components/FlowStepper.jsx";
import DSButton from "./components/design/DSButton.jsx";
import { getErrorMessage } from "./utils/errorRegistry.js";
import { uiText } from "./utils/uiText.js";
import { useAppController } from "./hooks/useAppController";
import { useIsMobile } from "./hooks/useIsMobile.js";

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    this.props.onError?.(error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="panel">
          <h1>{getErrorMessage("SYS_001_0001")}</h1>
          <p>{getErrorMessage("SYS_002_0023")}</p>
        </div>
      );
    }
    return this.props.children;
  }
}

function Toasts({ toasts, onDismiss }) {
  return (
    <div className="toast-container">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast ${toast.type}`}>
          <span>{toast.message}</span>
          <div className="toast-actions">
            {toast.action && (
              <DSButton
                variant="ghost"
                className="toast-action"
                onClick={() => {
                  toast.action.onClick();
                  onDismiss(toast.id);
                }}
              >
                {toast.action.label}
              </DSButton>
            )}
            <DSButton variant="ghost" onClick={() => onDismiss(toast.id)} aria-label={uiText("toast.dismiss")}>
              ×
            </DSButton>
          </div>
        </div>
      ))}
    </div>
  );
}

function Confetti({ show }) {
  if (!show) return null;
  return (
    <div className="confetti">
      {Array.from({ length: 24 }).map((_, index) => (
        <span key={index} className={`confetti-piece piece-${index % 6}`} />
      ))}
    </div>
  );
}

export default function App({ darkMode, toggleDarkMode, storageOk = true }) {
  const {
    isActiveTabOwner,
    stage,
    paymentSubStage,
    publicId,
    sessionId,
    demographics,
    setDemographics,
    setStage,
    toasts,
    addToast,
    systemReady,
    systemError,
    systemChecking,
    online,
    lastSyncAt,
    retryHealthCheck,
    survey,
    surveyCompleted,
    surveyFeedbackReady,
    setSurveyFeedbackReady,
    imageError,
    isFetchingImage,
    showConfetti,
    fetchImage,
    handleSubmit,
    claimActiveTabLock,
    dismissToast,
    handleConsentGiven,
    handleUserDetailsSubmit,
    handleUserDetailsBack,
    handleEmailVerified,
    handlePaymentComplete,
    handlePaymentContentToLink,
    handleAppError,
    clearUserStorage,
  } = useAppController();
  const isMobile = useIsMobile();
  const [showBackToTop, setShowBackToTop] = React.useState(false);

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
    const media = window.matchMedia("(max-width: 767px)");
    if (!media.matches) return;
    window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
  }, [stage, paymentSubStage, systemReady]);

  const renderContent = () => {
    if (systemChecking && !systemReady) {
      return (
        <PageSkeleton
          title={uiText("status.loadingApp")}
          subtitle={uiText("status.checkingConnectivity")}
          variant="app"
        />
      );
    }

    if (systemError && !systemReady) return null;

      switch (stage) {
        case "consent":
        return <ConsentPage publicId={publicId} onConsentGiven={handleConsentGiven} systemReady={systemReady} />;
      case "user-details":
        return (
          <UserDetailsPage
            publicId={publicId}
            demographics={demographics}
            setDemographics={setDemographics}
            onSubmit={handleUserDetailsSubmit}
            onEmailVerified={handleEmailVerified}
            addToast={addToast}
            onBack={handleUserDetailsBack}
            systemReady={systemReady}
          />
        );
      case "payment":
        return paymentSubStage === "content" ? (
          <PaymentContentPage onNext={handlePaymentContentToLink} />
        ) : (
          <PaymentLinkPage
            onNext={handlePaymentComplete}
            publicId={publicId}
            sessionId={sessionId}
            addToast={addToast}
          />
        );
      case "survey":
        if (surveyFeedbackReady) {
          return (
            <SurveyFeedPage
              surveyCompleted={surveyCompleted}
              setSurveyFeedbackReady={setSurveyFeedbackReady}
              setStage={setStage}
              fetchNextSurvey={fetchImage}
              clearUserStorage={clearUserStorage}
            />
          );
        }
        return (
          <SurveyPage
            survey={survey}
            publicId={publicId}
            surveyCompleted={surveyCompleted}
            onSubmit={handleSubmit}
            fetchError={imageError}
            onRetry={fetchImage}
            isFetchingImage={isFetchingImage}
          />
        );
      case "finished":
        return <FinishedPage surveyCompleted={surveyCompleted} publicId={publicId} clearUserStorage={clearUserStorage} />;
      default:
        return <ConsentPage publicId={publicId} onConsentGiven={handleConsentGiven} systemReady={systemReady} />;
    }
  };

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
            <p className="status-message">
              {uiText("app.anotherTabMessage")}
            </p>
            <DSButton variant="primary" onClick={() => claimActiveTabLock()}>
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
            <div className="header-status">
              <div className={`status-dot ${online ? "online" : "offline"}`}>
                {online ? uiText("status.online") : uiText("status.offline")}
              </div>
              <div className="header-status-text">
                <span className="header-status-line">
                  {online ? uiText("status.onlineReady") : uiText("status.offlineSubmissions")}
                </span>
                <span className="header-status-line">
                  {lastSyncAt
                    ? uiText("status.lastSync", { time: new Date(lastSyncAt).toLocaleTimeString() })
                    : uiText("status.neverSynced")}
                </span>
              </div>
            </div>
          </div>
        </header>

        {!storageOk && (
          <div className="banner warning">
            <span>{uiText("app.storageUnavailable")}</span>
          </div>
        )}

        <FlowStepper stage={stage} />

        <div className="route-transition">
          {renderContent()}
        </div>

        <div className="branding-footer">{uiText("app.footerCredit")}</div>
      </div>

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

      <Confetti show={showConfetti} />
      <Toasts toasts={toasts} onDismiss={dismissToast} />
    </ErrorBoundary>
  );
}
