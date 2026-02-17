import React, { useEffect, useState, useCallback } from "react";
import UserDetailsPage from "./pages/UserDetailsPage.jsx";
import ConsentPage from "./pages/ConsentPage.jsx";
import PaymentPage from "./pages/PaymentPage.jsx";
import SurveyPage from "./pages/SurveyPage.jsx";
import FinishedPage from "./pages/FinishedPage.jsx";
import { getApiUrl } from "./utils/apiBase";

function createId() {
  if (crypto?.randomUUID) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

function getStoredValue(key, fallback) {
  const stored = sessionStorage.getItem(key);
  return stored ? JSON.parse(stored) : fallback;
}

function saveStoredValue(key, value) {
  sessionStorage.setItem(key, JSON.stringify(value));
}

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
  const [participantId] = useState(() => getStoredValue("participantId", createId()));
  const [sessionId] = useState(() => getStoredValue("sessionId", createId()));
  const [consentGiven, setConsentGiven] = useState(() => getStoredValue("consentGiven", false));
  
  // Demographics state
  const [demographics, setDemographics] = useState(
    getStoredValue("demographics", {
      username: "",
      email: "",
      phone: "",
      gender: "",
      age: "",
      place: "",
      native_language: "",
      prior_experience: ""
    })
  );
  
  // Survey state
  const [survey, setSurvey] = useState(getStoredValue("survey", null));
  const [surveyCompleted, setSurveyCompleted] = useState(getStoredValue("surveyCompleted", 0));
  const [surveyFeedbackReady, setSurveyFeedbackReady] = useState(getStoredValue("surveyFeedbackReady", false));
  const [readyForNext, setReadyForNext] = useState(false);
  const [fetchingImage, setFetchingImage] = useState(false);
  const [shownImages, setShownImages] = useState(getStoredValue("shownImages", []));
  const [imageError, setImageError] = useState(null);
  
  // UI state
  const [toasts, setToasts] = useState([]);
  const [showConfetti, setShowConfetti] = useState(false);

  // Persist state
  useEffect(() => { saveStoredValue("participantId", participantId); }, [participantId]);
  useEffect(() => { saveStoredValue("sessionId", sessionId); }, [sessionId]);
  useEffect(() => { saveStoredValue("consentGiven", consentGiven); }, [consentGiven]);
  useEffect(() => { saveStoredValue("demographics", demographics); }, [demographics]);
  useEffect(() => { saveStoredValue("stage", stage); }, [stage]);
  useEffect(() => { saveStoredValue("survey", survey); }, [survey]);
  useEffect(() => { saveStoredValue("surveyCompleted", surveyCompleted); }, [surveyCompleted]);
  useEffect(() => { saveStoredValue("surveyFeedbackReady", surveyFeedbackReady); }, [surveyFeedbackReady]);
  useEffect(() => { saveStoredValue("shownImages", shownImages); }, [shownImages]);
  useEffect(() => { saveStoredValue("darkMode", darkMode); document.body.classList.toggle("dark", darkMode); }, [darkMode]);
  
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
          if (data.status === 'healthy' && data.services.database === 'connected') {
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

  const addToast = useCallback((message, type = "info", action) => {
    const id = createId();
    setToasts((prev) => [...prev, { id, message, type, action }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 4000);
  }, []);

  // Create participant in database
  const createParticipant = async () => {
    const response = await fetch(getApiUrl('/participants'), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        participant_id: participantId,
        session_id: sessionId,
        username: demographics.username,
        email: demographics.email,
        phone: demographics.phone,
        gender: demographics.gender,
        age: parseInt(demographics.age),
        place: demographics.place,
        native_language: demographics.native_language,
        prior_experience: demographics.prior_experience
      })
    });

    if (!response.ok) {
      const data = await response.json();
      const errorMessage = data.error || "Failed to create participant";
      throw new Error(errorMessage);
    }

    return response.json();
  };

  // Record consent in database
  const recordConsent = async () => {
    const response = await fetch(getApiUrl('/consent'), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        participant_id: participantId,
        consent_given: true
      })
    });

    if (!response.ok) {
      const data = await response.json();
      const errorMessage = data.error || "Failed to record consent";
      throw new Error(errorMessage);
    }

    return response.json();
  };

  // Handle user details submission
  const handleUserDetailsSubmit = async () => {
    try {
      await createParticipant();
      if (consentGiven) {
        await recordConsent();
      }
      setStage("payment");
      addToast("Details submitted successfully", "success");
    } catch (err) {
      // If participant already exists (409), that's okay - just continue
      if (err.message && err.message.includes("already exists")) {
        if (consentGiven) {
          try {
            await recordConsent();
          } catch (consentErr) {
            // Consent might already be recorded too, ignore error
          }
        }
        setStage("payment");
        addToast("Details submitted successfully", "success");
      } else {
        addToast(err.message, "error");
        throw err;
      }
    }
  };

  // Handle consent given
  const handleConsentGiven = async () => {
    setConsentGiven(true);
    setStage("user-details");
    addToast("Consent recorded successfully", "success");
  };

  // Handle payment completion
  const handlePaymentComplete = async () => {
    setStage("survey");
    setSurveyFeedbackReady(false); // Reset feedback state for new survey session
    try {
      await fetchImage();
      addToast("Payment completed successfully", "success");
    } catch (err) {
      addToast("Failed to load first survey image. Please try again.", "error");
      // Stay on survey page but show error
    }
  };

  // Fetch image
  const fetchImage = async () => {
    setFetchingImage(true);
    setReadyForNext(false);
    setSurveyFeedbackReady(false);
    setImageError(null);

    try {
      // Build URL with excluded images to prevent duplicates
      let url = getApiUrl(`/images/random?session_id=${sessionId}`);
      if (shownImages.length > 0) {
        url += `&exclude=${encodeURIComponent(shownImages.join(','))}`;
      }
      
      const response = await fetch(url);
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Unable to fetch image");
      }
      const data = await response.json();

      // Track this image as shown
      setShownImages(prev => [...prev, data.image_id]);
      setSurvey(data);
    } catch (error) {
      const errorMessage = error.message || "Failed to load image";
      addToast(errorMessage, "error");
      setImageError(errorMessage);
      setSurvey(null);
    } finally {
      setFetchingImage(false);
    }
  };

  // Handle submission
  const handleSubmit = async (formData) => {
    const payload = {
      participant_id: participantId,
      session_id: sessionId,
      image_id: survey.image_id,
      image_url: survey.image_url,
      description: formData.description,
      rating: formData.rating,
      feedback: formData.comments,
      time_spent_seconds: formData.timeSpentSeconds,
      is_survey: surveyCompleted === 0
    };

    const response = await fetch(getApiUrl('/submit'), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const data = await response.json();
      let errorMessage = data.error || "Submission failed";

      // Provide more specific error messages for common issues
      if (response.status === 400) {
        if (data.error && data.error.includes("participant_id is required")) {
          errorMessage = "Participant ID is missing. Please refresh the page and start again.";
        } else if (data.error && data.error.includes("Participant not found")) {
          errorMessage = "Participant not found. Please complete the registration process first.";
        } else if (data.error && data.error.includes("Minimum")) {
          errorMessage = data.error; // Keep the original word count error
        } else if (data.error && data.error.includes("rating is required")) {
          errorMessage = "Please select a rating for the image.";
        } else if (data.error && data.error.includes("comments must be at least")) {
          errorMessage = "Comments must be at least 5 characters long.";
        }
      } else if (response.status === 403) {
        if (data.error && data.error.includes("Payment required")) {
          errorMessage = "Payment is required before submitting responses.";
        } else if (data.error && data.error.includes("consent")) {
          errorMessage = "Consent is required. Please complete the consent process first.";
        }
      } else if (response.status === 409) {
        errorMessage = "This submission has already been recorded.";
      }

      throw new Error(errorMessage);
    }

    const result = await response.json();

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
    } else {
      setReadyForNext(true);
    }
  };

  // Handle next survey
  const handleNext = async () => {
    setReadyForNext(false);

    if (surveyCompleted >= 15) {
      setStage("finished");
      return;
    }

    await fetchImage();
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

  // Progress steps configuration
  const getProgressSteps = () => {
    const steps = [
      { id: "consent", label: "Consent" },
      { id: "user-details", label: "Details" },
      { id: "payment", label: "Payment" },
      { id: "survey", label: "Practice" },
      { id: "finished", label: "Complete" }
    ];
    return steps;
  };

  const getCurrentStepIndex = () => {
    const steps = getProgressSteps();
    return steps.findIndex(s => s.id === stage);
  };

  // Render progress bar for multi-step flows
  const renderProgressBar = () => {
    // Only show progress bar for consent -> details -> payment flow
    const flowStages = ["consent", "user-details", "payment"];
    if (!flowStages.includes(stage)) return null;

    const steps = [
      { id: "consent", label: "Consent" },
      { id: "user-details", label: "Your Details" },
      { id: "payment", label: "Payment" }
    ];
    const currentIndex = steps.findIndex(s => s.id === stage);

    return (
      <div className="progress-bar">
        {steps.map((step, index) => (
          <React.Fragment key={step.id}>
            <div className={`progress-step ${index === currentIndex ? "active" : ""} ${index < currentIndex ? "completed" : ""}`}>
              <span className="progress-step-number">{index < currentIndex ? "✓" : index + 1}</span>
              <span className="progress-step-label">{step.label}</span>
            </div>
            {index < steps.length - 1 && <div className="progress-step-divider" />}
          </React.Fragment>
        ))}
      </div>
    );
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
          <button className="primary" onClick={() => window.location.reload()}>
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
            onBack={() => setStage("consent")}
            systemReady={systemReady}
          />
        );
      
      case "payment":
        return (
          <PaymentPage
            onPaymentComplete={handlePaymentComplete}
            onBack={() => setStage("user-details")}
            systemReady={systemReady}
            participantId={participantId}
          />
        );
      
      case "survey":
        return (
          <SurveyPage
            survey={survey}
            participantId={participantId}
            sessionId={sessionId}
            onSubmit={handleSubmit}
            onNext={handleNext}
            onFinish={handleFinish}
            showNext={readyForNext}
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
        return <FinishedPage surveyCompleted={surveyCompleted} participantId={participantId} />;
      
      default:
        return <UserDetailsPage demographics={demographics} setDemographics={setDemographics} onSubmit={handleUserDetailsSubmit} onBack={() => setStage("consent")} systemReady={systemReady} />;
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

        {renderProgressBar()}
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
