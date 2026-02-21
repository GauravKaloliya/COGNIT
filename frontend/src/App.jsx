import React, { useEffect, useState, useCallback, useRef } from "react";
import UserDetailsPage from "./pages/UserDetailsPage.jsx";
import ConsentPage from "./pages/ConsentPage.jsx";
import PaymentLinkPage from "./pages/PaymentLinkPage.jsx";
import SurveyPage from "./pages/SurveyPage.jsx";
import FinishedPage from "./pages/FinishedPage.jsx";
import { getApiUrl } from "./utils/apiBase";
import { api, endpoints } from "./utils/api.js";
import { getErrorMessage, parseErrorResponse } from "./utils/errors";

function createId() {
  if (crypto?.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback UUID generation
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function getStoredValue(key, fallback) {
  const stored = sessionStorage.getItem(key);
  return stored ? JSON.parse(stored) : fallback;
}

function saveStoredValue(key, value) {
  sessionStorage.setItem(key, JSON.stringify(value));
}

// Stage order for secure navigation (CONSOLIDATED - NEW)
const STAGE_ORDER = ["consent", "user-details", "payment", "survey", "finished"];

const validateStageTransition = (currentStage, targetStage, paymentVerified = false) => {
  const currentIndex = STAGE_ORDER.indexOf(currentStage);
  const targetIndex = STAGE_ORDER.indexOf(targetStage);
  
  // Allow going back to previous stages
  if (targetIndex <= currentIndex) {
    return true;
  }
  
  // Only allow moving forward to next stage if current stage is complete
  switch (currentStage) {
    case "consent":
      return targetStage === "user-details";
    case "user-details":
      return targetStage === "payment";
    case "payment":
      // Require payment verification before allowing survey access
      return targetStage === "survey" && paymentVerified;
    case "survey":
      return targetStage === "finished";
    default:
      return false;
  }
};

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
          <h1>Something went wrong</h1>
          <p>Please refresh the page to continue.</p>
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
          <button onClick={() => onDismiss(toast.id)} aria-label="Dismiss">
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
  // System state
  const [systemReady, setSystemReady] = useState(false);
  const [systemError, setSystemError] = useState(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [darkMode, setDarkMode] = useState(getStoredValue("darkMode", false));
  
  // Flow state
  const [stage, setStage] = useState(getStoredValue("stage", "consent"));
  const [publicId] = useState(() => getStoredValue("publicId", createId()));
  const [sessionId] = useState(() => getStoredValue("sessionId", createId()));
  const [consentGiven, setConsentGiven] = useState(() => getStoredValue("consentGiven", false));
  const [paymentVerified, setPaymentVerified] = useState(() => getStoredValue("paymentVerified", false));
  
  // Demographics state - using new API field names
  const [demographics, setDemographics] = useState(
    getStoredValue("demographics", {
      username: "",
      email: "",
      phone: "",
      gender_code: "",
      age: "",
      location: "",
      language_code: "",
      prior_experience: ""
    })
  );
  
  // Survey state
  const [survey, setSurvey] = useState(getStoredValue("survey", null));
  const [surveyCompleted, setSurveyCompleted] = useState(getStoredValue("surveyCompleted", 0));
  const [surveyFeedbackReady, setSurveyFeedbackReady] = useState(getStoredValue("surveyFeedbackReady", false));
  const [shownImages, setShownImages] = useState(getStoredValue("shownImages", []));
  const [imageError, setImageError] = useState(null);
  
  // UI state
  const [toasts, setToasts] = useState([]);
  const [showConfetti, setShowConfetti] = useState(false);

  // Persist state
  useEffect(() => { saveStoredValue("publicId", publicId); }, [publicId]);
  useEffect(() => { saveStoredValue("sessionId", sessionId); }, [sessionId]);
  useEffect(() => { saveStoredValue("consentGiven", consentGiven); }, [consentGiven]);
  useEffect(() => { saveStoredValue("paymentVerified", paymentVerified); }, [paymentVerified]);
  useEffect(() => { saveStoredValue("demographics", demographics); }, [demographics]);
  useEffect(() => { saveStoredValue("stage", stage); }, [stage]);
  useEffect(() => { saveStoredValue("survey", survey); }, [survey]);
  useEffect(() => { saveStoredValue("surveyCompleted", surveyCompleted); }, [surveyCompleted]);
  useEffect(() => { saveStoredValue("surveyFeedbackReady", surveyFeedbackReady); }, [surveyFeedbackReady]);
  useEffect(() => { saveStoredValue("shownImages", shownImages); }, [shownImages]);
  useEffect(() => { saveStoredValue("darkMode", darkMode); document.body.classList.toggle("dark", darkMode); }, [darkMode]);

  // Define addToast early since it's used in useEffect below
  const addToast = useCallback((message, type = "info", action) => {
    const id = createId();
    setToasts((prev) => [...prev, { id, message, type, action }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 4000);
  }, []);
  
  // Online/offline detection
  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Health check on mount
  useEffect(() => {
    const checkHealth = async () => {
      try {
        const response = await fetch(getApiUrl('/health'));
        if (response.ok) {
          const data = await response.json();
          if (data.status === 'healthy' && data.database === 'connected') {
            setSystemReady(true);
            setSystemError(null);
          } else {
            setSystemReady(false);
            setSystemError('System is degraded. Please try again later.');
          }
        } else {
          setSystemReady(false);
          setSystemError('Unable to connect to the server.');
        }
      } catch (err) {
        setSystemReady(false);
        setSystemError('Unable to connect to the server. Please check your connection.');
      }
    };

    checkHealth();
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  // Verify payment status when accessing survey stage directly (prevent unauthorized access)
  useEffect(() => {
    const verifyPaymentForSurvey = async () => {
      // Only check if we're at survey stage and haven't verified payment yet
      if (stage === 'survey' && !paymentVerified && systemReady) {
        try {
          const paymentStatus = await endpoints.getParticipantPaymentStatus(publicId);
          if (paymentStatus.is_verified) {
            setPaymentVerified(true);
          } else {
            // Redirect to payment page if payment is not verified
            addToast("Please complete payment before accessing the survey.", "error");
            setStage("payment");
          }
        } catch (error) {
          // Redirect to payment page on error
          addToast("Payment verification failed. Please complete payment first.", "error");
          setStage("payment");
        }
      }
    };

    verifyPaymentForSurvey();
  }, [stage, systemReady, paymentVerified, publicId, addToast]);

  // Create participant in database using standardized API wrapper
  const createParticipant = async () => {
    try {
      const data = await endpoints.createParticipant({
        public_id: publicId,
        session_id: sessionId,
        username: demographics.username,
        email: demographics.email,
        phone: demographics.phone,
        gender_code: demographics.gender_code,
        age: parseInt(demographics.age),
        location: demographics.location,
        language_code: demographics.language_code,
        prior_experience: demographics.prior_experience
      });
      return data;
    } catch (error) {
      // Log error to backend for analytics
      if (error.code) {
        endpoints.logClientError({
          error_code: error.code,
          error_message: error.message,
          page_url: window.location.href,
          extra_data: {
            category: error.category,
            severity: error.severity,
            action: error.action,
            field: error.field
          }
        }).catch(() => {}); // Silent fail
      }
      const errorMessage = getErrorMessage(error, "Failed to create participant. Please try again.");
      throw new Error(errorMessage);
    }
  };

  // Record consent in database using standardized API wrapper
  const recordConsent = async () => {
    try {
      const data = await endpoints.recordConsent(publicId);
      return data;
    } catch (error) {
      // Log error to backend for analytics
      if (error.code) {
        endpoints.logClientError({
          error_code: error.code,
          error_message: error.message,
          page_url: window.location.href,
          extra_data: {
            category: error.category,
            severity: error.severity,
            action: error.action
          }
        }).catch(() => {});
      }
      const errorMessage = getErrorMessage(error, "Failed to record consent. Please try again.");
      throw new Error(errorMessage);
    }
  };

  // Handle user details submission with secure navigation
  const handleUserDetailsSubmit = async () => {
    try {
      await createParticipant();
      if (consentGiven) {
        await recordConsent();
      }
      // Secure navigation: validate transition before moving
      if (validateStageTransition("user-details", "payment")) {
        setStage("payment");
      }
      addToast("Details submitted successfully", "success");
    } catch (err) {
      addToast(err.message, "error");
      throw err;
    }
  };

  // Handle consent given with secure navigation
  const handleConsentGiven = async () => {
    setConsentGiven(true);
    // Secure navigation: validate transition before moving
    if (validateStageTransition("consent", "user-details")) {
      setStage("user-details");
    }
    addToast("Consent recorded successfully", "success");
  };

  // Handle back from user details to consent
  const handleUserDetailsBack = () => {
    setStage("consent");
  };

  // Handle payment completion with secure navigation
  const handlePaymentComplete = async () => {
    // Verify payment status with backend before allowing survey access
    try {
      const paymentStatus = await endpoints.getParticipantPaymentStatus(publicId);
      if (paymentStatus.is_verified) {
        setPaymentVerified(true);
        if (validateStageTransition("payment", "survey", true)) {
          setStage("survey");
        }
        setSurveyFeedbackReady(false);
        try {
          await fetchImage();
          addToast("Participation confirmed successfully", "success");
        } catch (err) {
          addToast("Failed to load first survey image. Please try again.", "error");
        }
      } else {
        addToast("Payment verification failed. Please complete payment first.", "error");
      }
    } catch (error) {
      // Payment not verified - redirect back to payment page
      const errorMessage = error.message || "Payment not verified. Please complete payment first.";
      addToast(errorMessage, "error");
      setPaymentVerified(false);
      // Ensure we stay on payment page if verification fails
      if (stage !== "payment") {
        setStage("payment");
      }
    }
  };

  // Handle payment back navigation
  const handlePaymentBack = () => {
    setStage("user-details");
    setPaymentVerified(false);
  };

  // Fetch image using standardized API wrapper
  const fetchImage = async () => {
    setSurveyFeedbackReady(false);
    setImageError(null);

    try {
      const data = await endpoints.getRandomImage(shownImages);
      // Track this image as shown
      setShownImages(prev => [...prev, data.image_id]);
      setSurvey(data);
    } catch (error) {
      // Log error to backend for analytics
      if (error.code) {
        endpoints.logClientError({
          error_code: error.code,
          error_message: error.message,
          page_url: window.location.href,
          extra_data: {
            category: error.category,
            severity: error.severity,
            action: error.action
          }
        }).catch(() => {});
      }
      const errorMessage = error.message || "Failed to load image";
      addToast(errorMessage, "error");
      setImageError(errorMessage);
      setSurvey(null);
    }
  };

  // Handle submission using standardized API wrapper
  const handleSubmit = async (formData) => {
    // Extract engagement data if provided
    const engagementData = formData.engagementData || {};

    try {
      const result = await endpoints.submitDescription({
        public_id: publicId,
        image_id: survey.image_id,
        description: formData.description,
        rating: formData.rating,
        feedback: formData.comments,
        time_spent_seconds: formData.timeSpentSeconds,
        is_survey: surveyCompleted === 0,
        survey_index: surveyCompleted === 0 ? 0 : surveyCompleted,
        tab_switch_count: engagementData.tabSwitchCount || 0,
        page_close_attempts: engagementData.pageCloseAttempts || 0,
        network_disconnects: engagementData.networkDisconnects || 0
      });

      if (result.attention_passed === false) {
        addToast("Please follow the special instructions next time!", "warning");
      } else {
        addToast("Your response was saved!", "success");
      }

      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 1200);

      // Update survey completed count
      setSurveyCompleted((prev) => prev + 1);

      // Show feedback screen after first practice survey
      if (surveyCompleted === 0) {
        setSurveyFeedbackReady(true);
      }
    } catch (error) {
      // Log error to backend for analytics
      if (error.code) {
        endpoints.logClientError({
          error_code: error.code,
          error_message: error.message,
          page_url: window.location.href,
          extra_data: {
            category: error.category,
            severity: error.severity,
            action: error.action,
            field: error.field
          }
        }).catch(() => {});
      }
      const errorMessage = getErrorMessage(error, "Submission failed. Please try again.");
      throw new Error(errorMessage);
    }
  };

  // Handle finish
  const handleFinish = () => {
    setStage("finished");
  };

  // Handle survey continue - fetch next survey image
  const handleSurveyContinue = async () => {
    setSurveyFeedbackReady(false);
    await fetchImage();
  };

  // Handle survey finish
  const handleSurveyFinish = () => {
    setSurveyFeedbackReady(false); // Reset feedback state
    setStage("finished");
  };

  // Render based on stage
  const renderContent = () => {
    if (!systemReady && !systemError) {
      return (
        <div className="panel status-panel">
          <h2>Loading C.O.G.N.I.T.</h2>
          <p className="status-message">Checking system connectivity...</p>
          <div className="spinner" />
        </div>
      );
    }

    if (systemError) {
      return (
        <div className="panel status-panel">
          <h2>System Error</h2>
          <p className="status-message">{systemError}</p>
          <button className="primary small" onClick={() => window.location.reload()}>
            Retry
          </button>
        </div>
      );
    }

    switch (stage) {
      case "consent":
        return (
          <ConsentPage
            onConsentGiven={handleConsentGiven}
            systemReady={systemReady}
          />
        );

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
        return (
          <PaymentLinkPage
            onNext={handlePaymentComplete}
            onBack={handlePaymentBack}
            publicId={publicId}
          />
        );
      
      case "survey":
        return (
          <SurveyPage
            survey={survey}
            publicId={publicId}
            onSubmit={handleSubmit}
            onFinish={handleFinish}
            isSurvey={true}
            surveyFeedbackReady={surveyFeedbackReady}
            onSurveyContinue={handleSurveyContinue}
            onSurveyFinish={handleSurveyFinish}
            fetchError={imageError}
            onRetry={fetchImage}
            surveyCompleted={surveyCompleted}
          />
        );
      
      case "finished":
        return <FinishedPage surveyCompleted={surveyCompleted} publicId={publicId} />;
      
      default:
        // Secure default: redirect to consent if stage is invalid
        return <ConsentPage onConsentGiven={handleConsentGiven} systemReady={systemReady} />;
    }
  };

  return (
    <ErrorBoundary onError={() => addToast("Unexpected error occurred.", "error")}>
      <div className="app">
        <header className="header">
          <div className="brand">
            <h1>C.O.G.N.I.T.</h1>
            <p className="subtitle">Describe each image with as much detail as possible</p>
          </div>
          <div className="header-actions">
            <button
              className="ghost dark-mode-toggle"
              onClick={() => setDarkMode((prev) => !prev)}
              title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
            >
              {darkMode ? "☀️" : "🌙"}
            </button>
            <div className={`status-dot ${online ? "online" : "offline"}`}>
              {online ? "Online" : "Offline"}
            </div>
          </div>
        </header>

        {!online && systemReady && (
          <div className="banner warning">
            You appear to be offline. Submissions will fail until connectivity is restored.
          </div>
        )}

        {renderContent()}

        <div className="branding-footer">
          Created by Gaurav Kaloliya
        </div>
      </div>
      
      <Confetti show={showConfetti} />
      <Toasts toasts={toasts} onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))} />
    </ErrorBoundary>
  );
}
