import React, { useEffect, useState, useCallback, useRef } from "react";
import UserDetailsPage from "./pages/UserDetailsPage.jsx";
import ConsentPage from "./pages/ConsentPage.jsx";
import PaymentContentPage from "./pages/PaymentContentPage.jsx";
import PaymentLinkPage from "./pages/PaymentLinkPage.jsx";
import SurveyPage from "./pages/SurveyPage.jsx";
import SurveyFeedPage from "./pages/SurveyFeedPage.jsx";
import FinishedPage from "./pages/FinishedPage.jsx";
import ServiceUnavailablePage from "./components/ServiceUnavailablePage.jsx";
import PageSkeleton from "./components/PageSkeleton.jsx";
import { endpoints } from "./utils/api.js";
import { getErrorMessage } from "./utils/errorRegistry.js";
import { uiText } from "./utils/uiText.js";
import { useSystemHealth } from "./hooks/useSystemHealth";
import { usePaymentFlow } from "./hooks/usePaymentFlow";
import { useSurveyFlow } from "./hooks/useSurveyFlow";
import { runtimeConfig } from "./config/runtime";

const UI_STATE_SCHEMA_VERSION = runtimeConfig.uiStateSchemaVersion;
const UI_STATE_TTL_MS = runtimeConfig.uiStateTtlMs;
const ACTIVE_TAB_LOCK_KEY = "cognit_active_tab_lock_v1";
const ACTIVE_TAB_LOCK_SCHEMA_VERSION = runtimeConfig.activeTabLockSchemaVersion;
const ACTIVE_TAB_HEARTBEAT_MS = runtimeConfig.activeTabHeartbeatMs;
const ACTIVE_TAB_STALE_MS = runtimeConfig.activeTabStaleMs;

function createId() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function normalizePhoneForApi(rawPhone) {
  const digits = String(rawPhone ?? "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  return digits;
}

function getStoredValue(key, fallback) {
  // Client storage is UX-only and user-controllable.
  // Backend must remain source of truth for security-critical decisions.
  try {
    const stored = sessionStorage.getItem(key);
    if (!stored) return fallback;
    const parsed = JSON.parse(stored);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      parsed.__schema_version !== UI_STATE_SCHEMA_VERSION ||
      typeof parsed.saved_at !== "number" ||
      typeof parsed.expires_at !== "number"
    ) {
      return fallback;
    }
    if (Date.now() > parsed.expires_at) {
      sessionStorage.removeItem(key);
      return fallback;
    }
    return parsed.data ?? fallback;
  } catch {
    return fallback;
  }
}

function saveStoredValue(key, value) {
  // Client storage is UX-only and user-controllable.
  // Backend must remain source of truth for security-critical decisions.
  try {
    const now = Date.now();
    sessionStorage.setItem(
      key,
      JSON.stringify({
        __schema_version: UI_STATE_SCHEMA_VERSION,
        saved_at: now,
        expires_at: now + UI_STATE_TTL_MS,
        data: value
      })
    );
  } catch {
    // Ignore storage failures; app should remain usable.
  }
}

const STAGE_ORDER = ["consent", "user-details", "payment", "survey", "finished"];

const validateStageTransition = (currentStage, targetStage, paymentVerified = false) => {
  const currentIndex = STAGE_ORDER.indexOf(currentStage);
  const targetIndex = STAGE_ORDER.indexOf(targetStage);
  if (targetIndex <= currentIndex) return true;

  switch (currentStage) {
    case "consent":
      return targetStage === "user-details";
    case "user-details":
      return targetStage === "payment";
    case "payment":
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
  const tabIdRef = useRef(createId());
  const [isActiveTabOwner, setIsActiveTabOwner] = useState(true);
  const [darkMode, setDarkMode] = useState(getStoredValue("darkMode", false));
  const [stage, setStage] = useState(getStoredValue("stage", "consent"));
  const [paymentSubStage, setPaymentSubStage] = useState(getStoredValue("paymentSubStage", "content"));
  const [publicId, setPublicId] = useState(() => getStoredValue("publicId", createId()));
  const [sessionId, setSessionId] = useState(() => getStoredValue("sessionId", createId()));
  const [consentGiven, setConsentGiven] = useState(() => getStoredValue("consentGiven", false));
  const [paymentVerified, setPaymentVerified] = useState(() => getStoredValue("paymentVerified", false));
  const [demographics, setDemographics] = useState(
    getStoredValue("demographics", {
      username: "",
      email: "",
      phone: "",
      gender_code: "",
      age: "",
      location: "",
      language_code: "",
      prior_experience: "",
    })
  );
  const [toasts, setToasts] = useState([]);
  const [surveyTransitionInFlight, setSurveyTransitionInFlight] = useState(false);
  const toastRef = useRef(new Map());
  const participantStatusAbortRef = useRef(null);
  const submitFlowAbortRef = useRef(null);

  const claimActiveTabLock = useCallback(() => {
    const now = Date.now();
    const tabId = tabIdRef.current;
    try {
      const raw = localStorage.getItem(ACTIVE_TAB_LOCK_KEY);
      if (!raw) {
        localStorage.setItem(
          ACTIVE_TAB_LOCK_KEY,
          JSON.stringify({
            __schema_version: ACTIVE_TAB_LOCK_SCHEMA_VERSION,
            tab_id: tabId,
            updated_at: now
          })
        );
        setIsActiveTabOwner(true);
        return true;
      }

      const parsed = JSON.parse(raw);
      const currentOwner = parsed?.tab_id;
      const updatedAt = Number(parsed?.updated_at || 0);
      const stale = !updatedAt || now - updatedAt > ACTIVE_TAB_STALE_MS;

      if (currentOwner === tabId || stale) {
        localStorage.setItem(
          ACTIVE_TAB_LOCK_KEY,
          JSON.stringify({
            __schema_version: ACTIVE_TAB_LOCK_SCHEMA_VERSION,
            tab_id: tabId,
            updated_at: now
          })
        );
        setIsActiveTabOwner(true);
        return true;
      }

      setIsActiveTabOwner(false);
      return false;
    } catch {
      setIsActiveTabOwner(true);
      return true;
    }
  }, []);

  useEffect(() => {
    claimActiveTabLock();

    const heartbeat = window.setInterval(() => {
      claimActiveTabLock();
    }, ACTIVE_TAB_HEARTBEAT_MS);

    const onStorage = (event) => {
      if (event.key === ACTIVE_TAB_LOCK_KEY) {
        claimActiveTabLock();
      }
    };

    const releaseLockIfOwner = () => {
      try {
        const raw = localStorage.getItem(ACTIVE_TAB_LOCK_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (parsed?.tab_id === tabIdRef.current) {
          localStorage.removeItem(ACTIVE_TAB_LOCK_KEY);
        }
      } catch {
        // Ignore lock release failures.
      }
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener("beforeunload", releaseLockIfOwner);
    return () => {
      window.clearInterval(heartbeat);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("beforeunload", releaseLockIfOwner);
      releaseLockIfOwner();
    };
  }, [claimActiveTabLock]);

  const addToast = useCallback((message, type = "info", action) => {
    const dedupeKey = `${type}:${message}`;
    const now = Date.now();
    const lastShownAt = toastRef.current.get(dedupeKey) || 0;
    if (now - lastShownAt < runtimeConfig.toastDedupeWindowMs) {
      return;
    }
    toastRef.current.set(dedupeKey, now);
    const id = createId();
    setToasts((prev) => [...prev, { id, message, type, action }]);
    setTimeout(
      () => setToasts((prev) => prev.filter((toast) => toast.id !== id)),
      runtimeConfig.toastAutoDismissMs
    );
  }, []);

  const {
    survey,
    surveyCompleted,
    surveyFeedbackReady,
    setSurveyFeedbackReady,
    shownImages,
    imageError,
    isFetchingImage,
    showConfetti,
    fetchImage,
    handleSubmit,
    cancelInFlightRequests,
  } = useSurveyFlow({
    publicId,
    addToast,
    initial: {
      survey: getStoredValue("survey", null),
      surveyCompleted: getStoredValue("surveyCompleted", 0),
      surveyFeedbackReady: getStoredValue("surveyFeedbackReady", false),
      shownImages: getStoredValue("shownImages", []),
    },
  });

  const {
    systemReady,
    systemError,
    systemChecking,
    online,
    retryHealthCheck,
  } = useSystemHealth({
    publicId,
    stage,
    paymentVerified,
    pauseSurveyPaymentGuard: surveyTransitionInFlight,
    setPaymentVerified,
    setStage,
    setPaymentSubStage,
    addToast,
  });

  const transitionToSurvey = useCallback(async () => {
    setSurveyTransitionInFlight(true);
    setPaymentVerified(true);
    setPaymentSubStage("content");
    try {
      const image = await fetchImage({ clearCurrent: true, throwOnError: true });
      if (!image?.image_id) {
        setPaymentVerified(false);
        return false;
      }
      if (validateStageTransition("payment", "survey", true)) {
        setStage("survey");
      }
      return true;
    } catch {
      setPaymentVerified(false);
      return false;
    } finally {
      setSurveyTransitionInFlight(false);
    }
  }, [fetchImage, setPaymentSubStage, setPaymentVerified, setStage]);

  const {
    handlePaymentComplete,
    handlePaymentContentToLink,
    handlePaymentBack,
  } = usePaymentFlow({
    publicId,
    stage,
    paymentSubStage,
    setStage,
    setPaymentSubStage,
    setPaymentVerified,
    addToast,
    transitionToSurvey,
  });

  useEffect(() => saveStoredValue("publicId", publicId), [publicId]);
  useEffect(() => saveStoredValue("sessionId", sessionId), [sessionId]);
  useEffect(() => saveStoredValue("consentGiven", consentGiven), [consentGiven]);
  useEffect(() => saveStoredValue("paymentVerified", paymentVerified), [paymentVerified]);
  useEffect(() => saveStoredValue("demographics", demographics), [demographics]);
  useEffect(() => saveStoredValue("stage", stage), [stage]);
  useEffect(() => saveStoredValue("paymentSubStage", paymentSubStage), [paymentSubStage]);
  useEffect(() => saveStoredValue("survey", survey), [survey]);
  useEffect(() => saveStoredValue("surveyCompleted", surveyCompleted), [surveyCompleted]);
  useEffect(() => saveStoredValue("surveyFeedbackReady", surveyFeedbackReady), [surveyFeedbackReady]);
  useEffect(() => saveStoredValue("shownImages", shownImages), [shownImages]);
  useEffect(() => {
    saveStoredValue("darkMode", darkMode);
    document.body.classList.toggle("dark", darkMode);
  }, [darkMode]);

  // Server-backed guard for direct navigation to late stages.
  useEffect(() => {
    const verifyStagePrerequisites = async () => {
      if (!systemReady || !isActiveTabOwner) return;
      if (!["survey", "finished"].includes(stage)) return;

      if (participantStatusAbortRef.current) {
        participantStatusAbortRef.current.abort();
      }
      const controller = new AbortController();
      participantStatusAbortRef.current = controller;

      try {
        const status = await endpoints.getParticipantPaymentStatus(publicId, { signal: controller.signal });
        const verified = status?.is_verified === true;
        setPaymentVerified(verified);

        if ((stage === "survey" || stage === "finished") && !verified) {
          setStage("payment");
          setPaymentSubStage("content");
          addToast(getErrorMessage("PAY_001_0005"), "warning");
        }
      } catch (error) {
        if (error?.code === "REQ_ABORTED" || controller.signal.aborted) {
          return;
        }
        setStage("user-details");
        setPaymentSubStage("content");
        setPaymentVerified(false);
        if (error?.status === 404 || error?.code === "NF_001_0001") {
          addToast(getErrorMessage("NF_001_0001"), "warning");
        }
      } finally {
        if (participantStatusAbortRef.current === controller) {
          participantStatusAbortRef.current = null;
        }
      }
    };

    verifyStagePrerequisites();
    return () => {
      if (participantStatusAbortRef.current) {
        participantStatusAbortRef.current.abort();
        participantStatusAbortRef.current = null;
      }
    };
  }, [
    stage,
    systemReady,
    publicId,
    setPaymentVerified,
    setStage,
    setPaymentSubStage,
    addToast,
    isActiveTabOwner
  ]);

  useEffect(() => {
    return () => {
      cancelInFlightRequests?.();
      if (participantStatusAbortRef.current) {
        participantStatusAbortRef.current.abort();
        participantStatusAbortRef.current = null;
      }
      if (submitFlowAbortRef.current) {
        submitFlowAbortRef.current.abort();
        submitFlowAbortRef.current = null;
      }
    };
  }, [cancelInFlightRequests]);

  useEffect(() => {
    if (stage !== "survey" || !systemReady || !paymentVerified || surveyFeedbackReady) return;
    if (!survey || !survey.image_id) fetchImage({ clearCurrent: false });
  }, [stage, systemReady, paymentVerified, surveyFeedbackReady, survey, fetchImage]);

  const createParticipant = async () => {
    if (submitFlowAbortRef.current) {
      submitFlowAbortRef.current.abort();
    }
    const controller = new AbortController();
    submitFlowAbortRef.current = controller;
    try {
      const participant = await endpoints.createParticipant({
        username: demographics.username,
        email: demographics.email,
        phone: normalizePhoneForApi(demographics.phone),
        gender_code: demographics.gender_code,
        age: parseInt(demographics.age),
        location: demographics.location,
        language_code: demographics.language_code,
        prior_experience: demographics.prior_experience,
      }, { signal: controller.signal });
      if (participant?.public_id) setPublicId(participant.public_id);
      if (participant?.session_id) setSessionId(participant.session_id);
      return participant;
    } catch (error) {
      if (error?.code === "REQ_ABORTED" || controller.signal.aborted) {
        throw error;
      }
      throw new Error(error.message || getErrorMessage("SYS_002_0022"));
    } finally {
      if (submitFlowAbortRef.current === controller) {
        submitFlowAbortRef.current = null;
      }
    }
  };

  const recordConsent = async (publicIdOverride = null) => {
    if (submitFlowAbortRef.current) {
      submitFlowAbortRef.current.abort();
    }
    const controller = new AbortController();
    submitFlowAbortRef.current = controller;
    try {
      const consentPublicId = publicIdOverride || publicId;
      return await endpoints.recordConsent(consentPublicId, { signal: controller.signal });
    } catch (error) {
      if (error?.code === "REQ_ABORTED" || controller.signal.aborted) {
        throw error;
      }
      throw new Error(error.message || getErrorMessage("SYS_002_0002"));
    } finally {
      if (submitFlowAbortRef.current === controller) {
        submitFlowAbortRef.current = null;
      }
    }
  };

  const handleUserDetailsSubmit = async () => {
    try {
      const participant = await createParticipant();
      const consentPublicId = participant?.public_id || publicId;
      if (consentGiven) await recordConsent(consentPublicId);
      if (validateStageTransition("user-details", "payment")) setStage("payment");
      addToast("Details submitted successfully", "success");
    } catch (err) {
      addToast(err.message, "error");
      throw err;
    }
  };

  const handleConsentGiven = async () => {
    setConsentGiven(true);
    if (validateStageTransition("consent", "user-details")) setStage("user-details");
    addToast("Consent recorded successfully", "success");
  };

  const handleUserDetailsBack = () => setStage("consent");

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
          <PaymentLinkPage onNext={handlePaymentComplete} onBack={handlePaymentBack} publicId={publicId} />
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
            </div>
          </header>
          <div className="panel status-panel">
            <h2>Another Tab Is Active</h2>
            <p className="status-message">
              This tab is read-only to prevent multi-tab state conflicts. Continue in the other tab or close it to resume here.
            </p>
            <button className="primary" onClick={() => claimActiveTabLock()}>
              Try Reclaiming This Tab
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
          onToggleDarkMode={() => setDarkMode((prev) => !prev)}
        />
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary onError={() => addToast(getErrorMessage("SYS_002_0017"), "error")}>
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
            <div className={`status-dot ${online ? "online" : "offline"}`}>{online ? "Online" : "Offline"}</div>
          </div>
        </header>

        {!online && systemReady && (
          <div className="banner warning">
            You appear to be offline. Submissions will fail until connectivity is restored.
          </div>
        )}

        <div className="route-transition">
          {renderContent()}
        </div>

        <div className="branding-footer">Created by Gaurav Kaloliya</div>
      </div>

      <Confetti show={showConfetti} />
      <Toasts toasts={toasts} onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))} />
    </ErrorBoundary>
  );
}
