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
import { getErrorMessage } from "./utils/errorRegistry.js";
import { uiText } from "./utils/uiText.js";
import { useAppController } from "./hooks/useAppController";

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
          {toast.action && (
            <button
              className="toast-action"
              onClick={() => {
                toast.action.onClick();
                onDismiss(toast.id);
              }}
            >
              {toast.action.label}
            </button>
          )}
          <button onClick={() => onDismiss(toast.id)} aria-label={uiText("toast.dismiss")}>
            ×
          </button>
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

export default function App() {
  const {
    isActiveTabOwner,
    darkMode,
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
    toggleDarkMode,
    handleConsentGiven,
    handleUserDetailsSubmit,
    handleUserDetailsBack,
    handlePaymentComplete,
    handlePaymentContentToLink,
    handlePaymentBack,
    handleAppError,
  } = useAppController();

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
        return <ConsentPage onConsentGiven={handleConsentGiven} systemReady={systemReady} />;
      case "user-details":
        return (
          <UserDetailsPage
            demographics={demographics}
            setDemographics={setDemographics}
            onSubmit={handleUserDetailsSubmit}
            onBack={handleUserDetailsBack}
            systemReady={systemReady}
          />
        );
      case "payment":
        return paymentSubStage === "content" ? (
          <PaymentContentPage onNext={handlePaymentContentToLink} onBack={handlePaymentBack} />
        ) : (
          <PaymentLinkPage
            onNext={handlePaymentComplete}
            onBack={handlePaymentBack}
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
        return <FinishedPage surveyCompleted={surveyCompleted} publicId={publicId} />;
      default:
        return <ConsentPage onConsentGiven={handleConsentGiven} systemReady={systemReady} />;
    }
  };

  if (!isActiveTabOwner) {
    return (
      <ErrorBoundary onError={() => {}}>
        <div className="app">
          <header className="header">
            <div className="brand">
              <h1>C.O.G.N.I.T.</h1>
              <p className="subtitle">{uiText("app.subtitle")}</p>
            </div>
            <div className="header-actions">
              <button
                className="ghost dark-mode-toggle"
                onClick={toggleDarkMode}
                title={darkMode ? uiText("app.darkModeLight") : uiText("app.darkModeDark")}
              >
                <ThemeToggleIcon darkMode={darkMode} />
              </button>
            </div>
          </header>
          <div className="panel status-panel">
            <h2>{uiText("app.anotherTabTitle")}</h2>
            <p className="status-message">
              {uiText("app.anotherTabMessage")}
            </p>
            <button className="primary" onClick={() => claimActiveTabLock()}>
              {uiText("app.reclaimTab")}
            </button>
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
            <h1>C.O.G.N.I.T.</h1>
            <p className="subtitle">{uiText("app.subtitle")}</p>
          </div>
          <div className="header-actions">
            <button
              className="ghost dark-mode-toggle"
              onClick={toggleDarkMode}
              title={darkMode ? uiText("app.darkModeLight") : uiText("app.darkModeDark")}
            >
              {darkMode ? "☀️" : "🌙"}
            </button>
            <div className={`status-dot ${online ? "online" : "offline"}`}>{online ? uiText("status.online") : uiText("status.offline")}</div>
          </div>
        </header>

        {!online && systemReady && (
          <div className="banner warning">
            {uiText("status.offlineSubmissions")}
          </div>
        )}

        <div className="route-transition">
          {renderContent()}
        </div>

        <div className="branding-footer">{uiText("app.footerCredit")}</div>
      </div>

      <Confetti show={showConfetti} />
      <Toasts toasts={toasts} onDismiss={dismissToast} />
    </ErrorBoundary>
  );
}
