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
      })
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      let errorMessage = data.error || "Failed to create participant";

      // Specific handling for 409 Conflict (duplicate participant)
      if (response.status === 409) {
        errorMessage = "Participant already exists. Please use a different username, email, or phone number.";
      }

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
        public_id: publicId
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
      // If participant already exists (409), show error message and do NOT continue
      if (err.message && (err.message.includes("already exists") || err.message.includes("different username"))) {
        addToast(err.message, "error");
        throw err;
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
      addToast("Participation confirmed successfully", "success");
    } catch (err) {
      addToast("Failed to load first survey image. Please try again.", "error");
      // Stay on survey page but show error
    }
  };

  // Fetch image
  const fetchImage = async () => {
    setReadyForNext(false);
    setSurveyFeedbackReady(false);
    setImageError(null);

    try {
      // Build URL with excluded images to prevent duplicates
      let url = getApiUrl('/images/random');
      if (shownImages.length > 0) {
        url += `?exclude=${encodeURIComponent(shownImages.join(','))}`;
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
    }
  };

  // Handle submission
  const handleSubmit = async (formData) => {
    const payload = {
      public_id: publicId,
      image_id: survey.image_id,
      description: formData.description,
      rating: formData.rating,
      feedback: formData.comments,
      time_spent_seconds: formData.timeSpentSeconds,
      is_survey: surveyCompleted === 0,
      survey_index: surveyCompleted === 0 ? 0 : surveyCompleted
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
        if (data.error && data.error.includes("public_id is required")) {
          errorMessage = "Public ID is missing. Please refresh the page and start again.";
        } else if (data.error && data.error.includes("not found")) {
          errorMessage = "Participant not found. Please complete the registration process first.";
        } else if (data.error && data.error.includes("words required")) {
          errorMessage = data.error; // Keep the original word count error
        } else if (data.error && data.error.includes("rating")) {
          errorMessage = "Please select a rating for the image.";
        } else if (data.error && data.error.includes("feedback")) {
          errorMessage = "Feedback must be at least 5 characters long.";
        }
      } else if (response.status === 403) {
        if (data.error && data.error.includes("consent")) {
          errorMessage = "Consent is required. Please complete the consent process first.";
        } else if (data.error && data.error.includes("flagged")) {
          errorMessage = "Your account has been flagged due to low attention scores.";
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
