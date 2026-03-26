import { useCallback, useEffect, useState } from "react";
import { runtimeConfig } from "../config/runtime";
import { clearPendingFlag, getPendingFlag, setPendingFlag } from "../utils/storage";
import { uiText } from "../utils/uiText";
import { useOnlineStatus } from "./useOnlineStatus";
import { APP_ROUTES } from "../constants/routes";
import { APP_FLOW } from "../config/appFlow";
const SURVEY_FEED_PENDING_FINISH_KEY = runtimeConfig.storageKeys.surveyFeedPendingFinish;

export function usePostSurveyPage({
  publicId,
  clearUserStorage,
  resetWorkflowToConsent,
  setSurveyFeedbackReady,
  setStage,
}) {
  const [pendingFinish, setPendingFinish] = useState(false);
  const isOnline = useOnlineStatus();

  useEffect(() => {
    document.title = uiText("finish.documentTitle");
  }, []);

  const handleSurveyFinish = useCallback(() => {
    if (!isOnline) {
      setPendingFlag(SURVEY_FEED_PENDING_FINISH_KEY);
      setPendingFinish(true);
      return;
    }
    if (typeof resetWorkflowToConsent === "function") {
      resetWorkflowToConsent(publicId);
    } else {
      setSurveyFeedbackReady(false);
      setStage?.(APP_FLOW.stages.consent);
      clearUserStorage?.(publicId);
    }
    window.location.href = APP_ROUTES.home;
  }, [clearUserStorage, isOnline, publicId, resetWorkflowToConsent, setStage, setSurveyFeedbackReady]);

  useEffect(() => {
    if (!isOnline) return;
    if (!getPendingFlag(SURVEY_FEED_PENDING_FINISH_KEY)) return;
    clearPendingFlag(SURVEY_FEED_PENDING_FINISH_KEY);
    setPendingFinish(false);
    handleSurveyFinish();
  }, [handleSurveyFinish, isOnline]);

  useEffect(() => {
    setPendingFinish(getPendingFlag(SURVEY_FEED_PENDING_FINISH_KEY));
  }, []);

  return {
    isOnline,
    pendingFinish,
    handleSurveyFinish,
  };
}
