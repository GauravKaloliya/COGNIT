import { useCallback, useEffect, useState } from "react";
import { runtimeConfig } from "../config/runtime";
import { clearPendingFlag, getPendingFlag, setPendingFlag } from "../utils/storage";
import { uiText } from "../utils/uiText";
import { useOnlineStatus } from "./useOnlineStatus";
import { useRetryCountdown } from "./useRetryCountdown";
import { APP_ROUTES } from "../constants/routes";
import { APP_FLOW } from "../config/appFlow";

const SURVEY_FEED_PENDING_CONTINUE_KEY = runtimeConfig.storageKeys.surveyFeedPendingContinue;
const SURVEY_FEED_PENDING_FINISH_KEY = runtimeConfig.storageKeys.surveyFeedPendingFinish;

export function usePostSurveyPage({
  publicId,
  clearUserStorage,
  setSurveyFeedbackReady,
  setStage,
  fetchNextSurvey,
}) {
  const [loadingNext, setLoadingNext] = useState(false);
  const [continueError, setContinueError] = useState("");
  const [pendingContinue, setPendingContinue] = useState(false);
  const [pendingFinish, setPendingFinish] = useState(false);
  const isOnline = useOnlineStatus();
  const retryCountdownContinue = useRetryCountdown(!isOnline && pendingContinue, runtimeConfig.serviceRetrySeconds);
  const retryCountdownFinish = useRetryCountdown(!isOnline && pendingFinish, runtimeConfig.serviceRetrySeconds);

  useEffect(() => {
    document.title = uiText("finish.documentTitle");
  }, [publicId]);

  const handleSurveyContinue = useCallback(async () => {
    if (loadingNext) return;
    if (!isOnline) {
      setContinueError(uiText("survey.feedOfflineContinue"));
      setPendingFlag(SURVEY_FEED_PENDING_CONTINUE_KEY);
      setPendingContinue(true);
      return;
    }
    if (typeof fetchNextSurvey !== "function") {
      setContinueError(uiText("survey.feedLoadFailed"));
      return;
    }
    setLoadingNext(true);
    setContinueError("");
    try {
      let data = await fetchNextSurvey({ clearCurrent: true, throwOnError: true });
      if (!data?.image_id) {
        // One immediate retry handles transient state/race conditions.
        data = await fetchNextSurvey({ clearCurrent: true, throwOnError: true });
      }
      if (!data?.image_id) {
        setContinueError(uiText("survey.feedLoadFailed"));
        return;
      }
      setSurveyFeedbackReady(false);
      setStage?.(APP_FLOW.stages.survey);
    } catch (error) {
      setContinueError(error?.message || uiText("survey.feedLoadFailed"));
    } finally {
      setLoadingNext(false);
    }
  }, [fetchNextSurvey, isOnline, loadingNext, setStage, setSurveyFeedbackReady]);

  const handleSurveyFinish = useCallback(() => {
    if (!isOnline) {
      setPendingFlag(SURVEY_FEED_PENDING_FINISH_KEY);
      setPendingFinish(true);
      return;
    }
    setSurveyFeedbackReady(false);
    setStage?.(APP_FLOW.stages.consent);
    clearUserStorage?.(publicId);
    window.location.href = APP_ROUTES.home;
  }, [clearUserStorage, isOnline, publicId, setStage, setSurveyFeedbackReady]);

  useEffect(() => {
    if (!isOnline || loadingNext) return;
    const shouldContinue = getPendingFlag(SURVEY_FEED_PENDING_CONTINUE_KEY);
    const shouldFinish = getPendingFlag(SURVEY_FEED_PENDING_FINISH_KEY);
    if (shouldContinue) {
      clearPendingFlag(SURVEY_FEED_PENDING_CONTINUE_KEY);
      setPendingContinue(false);
      handleSurveyContinue();
      return;
    }
    if (shouldFinish) {
      clearPendingFlag(SURVEY_FEED_PENDING_FINISH_KEY);
      setPendingFinish(false);
      handleSurveyFinish();
    }
  }, [handleSurveyContinue, handleSurveyFinish, isOnline, loadingNext]);

  useEffect(() => {
    setPendingContinue(getPendingFlag(SURVEY_FEED_PENDING_CONTINUE_KEY));
    setPendingFinish(getPendingFlag(SURVEY_FEED_PENDING_FINISH_KEY));
  }, []);

  return {
    minWords: runtimeConfig.minWords,
    loadingNext,
    continueError,
    isOnline,
    pendingContinue,
    pendingFinish,
    retryCountdownContinue,
    retryCountdownFinish,
    handleSurveyContinue,
    handleSurveyFinish,
  };
}
