import React from "react";
import PageSkeleton from "../PageSkeleton.jsx";
import { uiText } from "../../utils/uiText.js";
import { resetSurveyTelemetry, telemetryPageView } from "../../utils/clientTelemetry.js";
import { normalizeAppStage } from "../../config/appFlow.js";

const loadConsentPage = () => import("../../pages/ConsentPage.jsx");
const loadUserDetailsPage = () => import("../../pages/UserDetailsPage.jsx");
const loadSurveyPage = () => import("../../pages/SurveyPage.jsx");
const loadPostSurveyPage = () => import("../../pages/PostSurveyPage.jsx");

const ConsentPage = React.lazy(loadConsentPage);
const UserDetailsPage = React.lazy(loadUserDetailsPage);
const SurveyPage = React.lazy(loadSurveyPage);
const PostSurveyPage = React.lazy(loadPostSurveyPage);

export function prefetchLikelyNextChunks(stage) {
  if (stage === "user-details") {
    void loadSurveyPage();
    return;
  }
  if (stage === "survey") {
    void loadPostSurveyPage();
    return;
  }
  if (stage === "post-survey") {
    void loadSurveyPage();
  }
}

export function prefetchBehaviorChunks({
  fromStage,
  userDetailsLikelyComplete = false,
  surveyLikelyComplete = false,
} = {}) {
  if (fromStage === "user-details" && userDetailsLikelyComplete) {
    void loadSurveyPage();
    return;
  }
  if (fromStage === "survey" && surveyLikelyComplete) {
    void loadPostSurveyPage();
  }
}

function AppStageRouter({
  appState,
  workflowState,
  surveyState,
  systemState,
  actions,
}) {
  const {
    stage,
    publicId,
    storageScope,
    sessionHydrated,
    consentGiven,
  } = appState;
  const { demographics } = workflowState;
  const {
    survey,
    surveyCompleted,
    imageError,
    isFetchingImage,
    isTransitioningToNext,
  } = surveyState;
  const { systemChecking, systemReady } = systemState;
  const {
    setDemographics,
    handleConsentGiven,
    handleUserDetailsSubmit,
    handleEmailVerified,
    handleAccountFlagged,
    addToast,
    clearUserStorage,
    resetWorkflowToConsent,
    fetchImage,
    prefetchNextImage,
    handleSubmit,
  } = actions;
  const normalizedStage = normalizeAppStage(stage);

  const renderStage = () => {
    if (normalizedStage === "consent") {
      return (
        <ConsentPage
          storageScope={storageScope}
          sessionHydrated={sessionHydrated}
          consentGiven={consentGiven}
          onConsentGiven={handleConsentGiven}
          systemReady={systemReady}
        />
      );
    }

    if (normalizedStage === "user-details") {
      return (
        <UserDetailsPage
          storageScope={storageScope}
          publicId={publicId}
          sessionHydrated={sessionHydrated}
          demographics={demographics}
          setDemographics={setDemographics}
          onSubmit={handleUserDetailsSubmit}
          onEmailVerified={handleEmailVerified}
          addToast={addToast}
          systemReady={systemReady}
        />
      );
    }

    if (normalizedStage === "survey") {
      return (
        <SurveyPage
          survey={survey}
          publicId={publicId}
          surveyCompleted={surveyCompleted}
          onSubmit={handleSubmit}
          onAccountFlagged={handleAccountFlagged}
          fetchError={imageError}
          onRetry={fetchImage}
          onWarmNextSurvey={prefetchNextImage}
          isFetchingImage={isFetchingImage}
          isTransitioningToNext={isTransitioningToNext}
        />
      );
    }

    if (normalizedStage === "post-survey") {
      return (
        <PostSurveyPage
          surveyCompleted={surveyCompleted}
          publicId={publicId}
          email={demographics?.email || ""}
          clearUserStorage={clearUserStorage}
          resetWorkflowToConsent={resetWorkflowToConsent}
        />
      );
    }

    return (
      <ConsentPage
        storageScope={storageScope}
        sessionHydrated={sessionHydrated}
        consentGiven={consentGiven}
        onConsentGiven={handleConsentGiven}
        systemReady={systemReady}
      />
    );
  };

  const activePageName = React.useMemo(() => {
    if (normalizedStage === "consent") return "consent";
    if (normalizedStage === "user-details") return "user-details";
    if (normalizedStage === "survey") return "survey";
    if (normalizedStage === "post-survey") return "post-survey";
    return "consent";
  }, [normalizedStage]);

  const previousPageNameRef = React.useRef(activePageName);

  React.useEffect(() => {
    const previousPageName = previousPageNameRef.current;
    if (activePageName === "survey" && previousPageName !== "survey") {
      resetSurveyTelemetry("survey");
    }
    previousPageNameRef.current = activePageName;
  }, [activePageName]);

  React.useEffect(() => {
    telemetryPageView(activePageName);
  }, [activePageName]);

  if (systemChecking && !systemReady) {
    return (
      <PageSkeleton
        title={uiText("status.loadingApp")}
        subtitle={uiText("status.checkingConnectivity")}
        variant="app"
      />
    );
  }

  return (
    <React.Suspense
      fallback={(
        <PageSkeleton
          title={uiText("status.loadingApp")}
          subtitle={uiText("status.checkingConnectivity")}
          variant="app"
        />
      )}
    >
      {renderStage()}
    </React.Suspense>
  );
}

export default React.memo(AppStageRouter);
