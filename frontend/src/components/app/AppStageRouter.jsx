import React from "react";
import ConsentPage from "../../pages/ConsentPage.jsx";
import UserDetailsPage from "../../pages/UserDetailsPage.jsx";
import SurveyPage from "../../pages/SurveyPage.jsx";
import PostSurveyPage from "../../pages/PostSurveyPage.jsx";
import PageSkeleton from "../PageSkeleton.jsx";
import { uiText } from "../../utils/uiText.js";

export default function AppStageRouter({
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
  handleSubmit,
  imageError,
  isFetchingImage,
}) {
  if (systemChecking && !systemReady) {
    return (
      <PageSkeleton
        title={uiText("status.loadingApp")}
        subtitle={uiText("status.checkingConnectivity")}
        variant="app"
      />
    );
  }

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
}
