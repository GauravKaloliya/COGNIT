import React, { useEffect, useState, useCallback, useRef } from "react";
import UserDetailsPage from "./pages/UserDetailsPage.jsx";
import ConsentPage from "./pages/ConsentPage.jsx";
import PaymentContentPage from "./pages/PaymentContentPage.jsx";
import PaymentLinkPage from "./pages/PaymentLinkPage.jsx";
import SurveyPage from "./pages/SurveyPage.jsx";
import SurveyFeedPage from "./pages/SurveyFeedPage.jsx";
import FinishedPage from "./pages/FinishedPage.jsx";
import ServiceUnavailablePage from "./components/ServiceUnavailablePage.jsx";
import { getApiUrl } from "./utils/apiBase";
import { endpoints } from "./utils/api.js";
import { getErrorMessage } from "./utils/errorRegistry.js";

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
          <h1>{getErrorMessage('SYS_001_0001')}</h1>
          <p>{getErrorMessage('SYS_002_0023')}</p>
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
  const [systemChecking, setSystemChecking] = useState(true);
  const [retryTrigger, setRetryTrigger] = useState(0);
  const [online, setOnline] = useState(navigator.onLine);
  const [darkMode, setDarkMode] = useState(getStoredValue("darkMode", false));
  
  // Flow state
  const [stage, setStage] = useState(getStoredValue("stage", "consent"));
  const [paymentSubStage, setPaymentSubStage] = useState(getStoredValue("paymentSubStage", "content"));
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
  const canTrackEngagement = ["payment", "survey", "finished"].includes(stage);
  const currentPageRef = useRef("consent");

  // Persist state
  useEffect(() => { saveStoredValue("publicId", publicId); }, [publicId]);
  useEffect(() => { saveStoredValue("sessionId", sessionId); }, [sessionId]);
  useEffect(() => { saveStoredValue("consentGiven", consentGiven); }, [consentGiven]);
  useEffect(() => { saveStoredValue("paymentVerified", paymentVerified); }, [paymentVerified]);
  useEffect(() => { saveStoredValue("demographics", demographics); }, [demographics]);
  useEffect(() => { saveStoredValue("stage", stage); }, [stage]);
  useEffect(() => { saveStoredValue("paymentSubStage", paymentSubStage); }, [paymentSubStage]);
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

  const trackEngagementEvent = useCallback((eventType, eventData = {}) => {
    if (!publicId || !canTrackEngagement) return;
    endpoints.trackEngagement({
      public_id: publicId,
      event_type: eventType,
      event_data: eventData
    }).catch(() => {});
  }, [publicId, canTrackEngagement]);

  useEffect(() => {
    if (!canTrackEngagement) return;
    const page = stage === "payment" ? `payment-${paymentSubStage}` : stage;
    currentPageRef.current = page;
    trackEngagementEvent("page_view", {
      page,
      stage,
      payment_sub_stage: stage === "payment" ? paymentSubStage : null,
      path: window.location.pathname
    });
  }, [canTrackEngagement, stage, paymentSubStage, trackEngagementEvent]);

  useEffect(() => {
    if (!canTrackEngagement || !publicId) return;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        trackEngagementEvent("tab_switch", { page: currentPageRef.current });
      }
    };

    const handleOffline = () => {
      trackEngagementEvent("network_disconnect", { page: currentPageRef.current });
    };

    const handleBeforeUnload = () => {
      const payload = JSON.stringify({
        public_id: publicId,
        event_type: "page_close_attempt",
        event_data: {
          page: currentPageRef.current
        }
      });
      if (navigator.sendBeacon) {
        const blob = new Blob([payload], { type: "application/json" });
        navigator.sendBeacon(getApiUrl("/engagement/track"), blob);
      } else {
        trackEngagementEvent("page_close_attempt", { page: currentPageRef.current });
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [canTrackEngagement, publicId, trackEngagementEvent]);
  
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

  // Health check on mount and on manual retry
  useEffect(() => {
    let cancelled = false;

    const checkHealth = async () => {
      setSystemChecking(true);
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        let response;
        try {
          response = await fetch(getApiUrl('/health'), { signal: controller.signal });
        } finally {
          clearTimeout(timeoutId);
        }
        if (cancelled) return;
        if (response.ok) {
          const data = await response.json();
          if (data.status === 'healthy' && data.database === 'connected') {
            setSystemReady(true);
            setSystemError(null);
          } else {
            setSystemReady(false);
            setSystemError(
              data.error
                ? getErrorMessage('SYS_002_0020', 'en', { error: data.error })
                : getErrorMessage('SYS_002_0021')
            );
          }
        } else {
          let data = null;
          try {
            data = await response.json();
          } catch (parseError) {
            data = null;
          }
          setSystemReady(false);
          setSystemError(
            data?.error
              ? getErrorMessage('SYS_002_0020', 'en', { error: data.error })
              : getErrorMessage('SYS_002_0019', 'en', { status: response.status })
          );
        }
      } catch (err) {
        if (cancelled) return;
        setSystemReady(false);
        if (err.name === 'AbortError') {
          setSystemError(getErrorMessage('SYS_002_0008'));
        } else {
          setSystemError(getErrorMessage('SYS_002_0001'));
        }
      } finally {
        if (!cancelled) setSystemChecking(false);
      }
    };

    checkHealth();
    const interval = setInterval(checkHealth, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [retryTrigger]);

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
            addToast(getErrorMessage('PAY_001_0005'), "error");
            setStage("payment");
            setPaymentSubStage("content");
          }
        } catch (error) {
          // Redirect to payment page on error
          addToast(getErrorMessage('PAY_001_0005'), "error");
          setStage("payment");
          setPaymentSubStage("content");
        }
      }
    };

    verifyPaymentForSurvey();
  }, [stage, systemReady, paymentVerified, publicId, addToast]);

  useEffect(() => {
    if (stage !== "survey" || !systemReady || !paymentVerified || surveyFeedbackReady) {
      return;
    }
    // Recover gracefully after hard reload if in-memory survey object is missing.
    if (!survey || !survey.image_id) {
      fetchImage({ clearCurrent: true });
    }
  }, [stage, systemReady, paymentVerified, surveyFeedbackReady, survey]);

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
      const errorMessage = error.message || getErrorMessage('SYS_002_0022');
      throw new Error(errorMessage);
    }
  };

  // Record consent in database using standardized API wrapper
  const recordConsent = async () => {
    try {
      const data = await endpoints.recordConsent(publicId);
      return data;
    } catch (error) {
      const errorMessage = error.message || getErrorMessage('SYS_002_0002');
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
      if (validateStageTransition("user-details", "payment")) {
        // Secure navigation: validate transition before moving
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
  const handlePaymentComplete = async (options = {}) => {
    const skipVerification = options?.skipVerification === true;

    if (skipVerification) {
      setPaymentVerified(true);
      setPaymentSubStage("content");
      if (validateStageTransition("payment", "survey", true)) {
        setStage("survey");
      }
      fetchImage({ clearCurrent: true });
      addToast("Participation confirmed successfully", "success");
      return;
    }

    // Verify payment status with backend before allowing survey access
    try {
      const paymentStatus = await endpoints.getParticipantPaymentStatus(publicId);
      if (paymentStatus.is_verified) {
        setPaymentVerified(true);
        setPaymentSubStage("content"); // Reset to content for next time
        if (validateStageTransition("payment", "survey", true)) {
          setStage("survey");
        }
        fetchImage({ clearCurrent: true });
        addToast("Participation confirmed successfully", "success");
      } else {
        addToast(getErrorMessage('PAY_001_0005'), "error");
      }
    } catch (error) {
      // Payment not verified - redirect back to payment page
      const errorMessage = error.message || getErrorMessage('PAY_001_0005');
      addToast(errorMessage, "error");
      setPaymentVerified(false);
      // Ensure we stay on payment page if verification fails
      if (stage !== "payment") {
        setStage("payment");
        setPaymentSubStage("content");
      }
    }
  };

  // Handle payment content to payment link navigation
  const handlePaymentContentToLink = () => {
    setPaymentSubStage("link");
  };

  // Handle payment back navigation
  const handlePaymentBack = () => {
    if (paymentSubStage === "link") {
      setPaymentSubStage("content");
    } else {
      setStage("user-details");
      setPaymentVerified(false);
      setPaymentSubStage("content");
    }
  };

  // Fetch image using standardized API wrapper
  const fetchImage = async ({ clearCurrent = false } = {}) => {
    setSurveyFeedbackReady(false);
    setImageError(null);
    if (clearCurrent) {
      setSurvey(null);
    }

    try {
      const data = await endpoints.getRandomImage(shownImages, publicId);
      // Track this image as shown
      setShownImages(prev => [...prev, data.image_id]);
      setSurvey(data);
    } catch (error) {
      const errorMessage = error.message || getErrorMessage('SYS_002_0016');
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

      const attentionStatus = result.attention_status || {};
      if (attentionStatus.is_attention_check && result.attention_passed === false) {
        if (attentionStatus.failure_reasons?.includes("too_fast_attention")) {
          addToast("Attention check failed: response was too fast. Please read image instructions carefully.", "warning");
        } else {
          addToast("Attention check failed: please follow the special instructions shown in the image.", "warning");
        }
      } else {
        addToast("Your response was saved!", "success");
      }

      if (attentionStatus.hard_flag_triggered) {
        addToast("Multiple attention failures detected. Please slow down and answer carefully.", "warning");
      }

      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 1200);

      const nextCompleted = surveyCompleted + 1;
      setSurveyCompleted(nextCompleted);

      // Always show feedback page after each successful survey submission.
      setSurveyFeedbackReady(true);
    } catch (error) {
      const errorMessage = error.message || getErrorMessage('SYS_002_0006');
      throw new Error(errorMessage);
    }
  };

  // Render based on stage
  const renderContent = () => {
    if (systemChecking && !systemReady) {
      return (
        <div className="panel status-panel">
          <h2>Loading C.O.G.N.I.T.</h2>
          <p className="status-message">Checking system connectivity...</p>
          <div className="spinner" />
        </div>
      );
    }

    if (systemError && !systemReady) {
      return null;
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
        if (paymentSubStage === "content") {
          return (
            <PaymentContentPage
              onNext={handlePaymentContentToLink}
              onBack={handlePaymentBack}
            />
          );
        } else {
          return (
            <PaymentLinkPage
              onNext={handlePaymentComplete}
              onBack={handlePaymentBack}
              publicId={publicId}
            />
          );
        }
      
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
            onSubmit={handleSubmit}
            fetchError={imageError}
            onRetry={fetchImage}
          />
        );
      
      case "finished":
        return <FinishedPage surveyCompleted={surveyCompleted} publicId={publicId} />;
      
      default:
        // Secure default: redirect to consent if stage is invalid
        return <ConsentPage onConsentGiven={handleConsentGiven} systemReady={systemReady} />;
    }
  };

  if (systemError && !systemReady && !systemChecking) {
    return (
      <ErrorBoundary onError={() => {}}>
        <ServiceUnavailablePage
          error={systemError}
          onRetry={() => setRetryTrigger((prev) => prev + 1)}
          isRetrying={systemChecking}
        />
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary onError={() => addToast(getErrorMessage('SYS_002_0017'), "error")}>
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
