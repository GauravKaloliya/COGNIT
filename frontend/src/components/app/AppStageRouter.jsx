import React from "react";
import PageSkeleton from "../PageSkeleton.jsx";
import { uiText } from "../../utils/uiText.js";
import { telemetryPageView } from "../../utils/clientTelemetry.js";

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
  stage,
  systemChecking,
  systemReady,
  publicId,
  consentGiven,
  demographics,
  setDemographics,
  handleConsentGiven,
  handleUserDetailsSubmit,
  handleEmailVerified,
  addToast,
  survey,
  surveyCompleted,
  surveyFeedbackReady,
  setSurveyFeedbackReady,
  clearUserStorage,
  fetchImage,
  prefetchNextImage,
  handleSubmit,
  imageError,
  isFetchingImage,
}) {
  const renderStage = () => {
    if (stage === "consent") {
      return (
        <ConsentPage
          publicId={publicId}
          consentGiven={consentGiven}
          onConsentGiven={handleConsentGiven}
          systemReady={systemReady}
        />
      );
    }

    if (stage === "user-details") {
      return (
        <UserDetailsPage
          publicId={publicId}
          demographics={demographics}
          setDemographics={setDemographics}
          onSubmit={handleUserDetailsSubmit}
          onEmailVerified={handleEmailVerified}
          addToast={addToast}
          systemReady={systemReady}
        />
      );
    }

    if (stage === "survey" && surveyFeedbackReady) {
      return (
        <PostSurveyPage
          surveyCompleted={surveyCompleted}
          setSurveyFeedbackReady={setSurveyFeedbackReady}
          clearUserStorage={clearUserStorage}
          publicId={publicId}
          fetchNextSurvey={fetchImage}
        />
      );
    }

    if (stage === "survey") {
      return (
        <SurveyPage
          survey={survey}
          publicId={publicId}
          surveyCompleted={surveyCompleted}
          onSubmit={handleSubmit}
          fetchError={imageError}
          onRetry={fetchImage}
          onWarmNextSurvey={prefetchNextImage}
          isFetchingImage={isFetchingImage}
        />
      );
    }

    if (stage === "finished") {
      return (
        <PostSurveyPage
          surveyCompleted={surveyCompleted}
          publicId={publicId}
          clearUserStorage={clearUserStorage}
        />
      );
    }

    return (
      <ConsentPage
        publicId={publicId}
        consentGiven={consentGiven}
        onConsentGiven={handleConsentGiven}
        systemReady={systemReady}
      />
    );
  };

  const activePageName = React.useMemo(() => {
    if (stage === "consent") return "consent";
    if (stage === "user-details") return "user-details";
    if (stage === "survey" && surveyFeedbackReady) return "post-survey";
    if (stage === "survey") return "survey";
    if (stage === "finished") return "finished";
    return "consent";
  }, [stage, surveyFeedbackReady]);

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
