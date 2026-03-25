import React from "react";
import PanelState from "./PanelState.jsx";
import PageSkeleton from "./PageSkeleton.jsx";
import { uiText } from "../utils/uiText.js";

export default function AsyncStatePanel({
  loading = false,
  error = "",
  retryLabel = "",
  onRetry = null,
  retryDisabled = false,
  loadingTitle = uiText("survey.loadingSurvey"),
  loadingSubtitle = uiText("survey.loadingSurveySubtitle"),
  errorTitle = uiText("survey.imageLoadFailed"),
  fallbackErrorMessage = uiText("survey.imageRestoreFailed"),
}) {
  if (loading) {
    return (
      <PageSkeleton
        title={loadingTitle}
        subtitle={loadingSubtitle}
        variant="survey"
      />
    );
  }

  if (error) {
    return (
      <PanelState
        variant="error"
        icon="!"
        title={errorTitle}
        message={error || fallbackErrorMessage}
        actionLabel={retryLabel}
        onAction={retryDisabled ? null : onRetry}
        disabled={retryDisabled}
      />
    );
  }

  return (
    <PageSkeleton
      title={loadingTitle}
      subtitle={loadingSubtitle}
      variant="survey"
    />
  );
}

