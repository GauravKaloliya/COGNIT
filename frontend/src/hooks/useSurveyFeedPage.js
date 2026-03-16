import { useCallback, useEffect, useState } from "react";
import { runtimeConfig } from "../config/runtime";
import { clearPendingFlag, getPendingFlag, setPendingFlag } from "../utils/storage";
import { uiText } from "../utils/uiText";
import { useOnlineStatus } from "./useOnlineStatus";

const MIN_WORDS = parseInt(import.meta.env.VITE_MIN_WORDS || "60", 10);
const SURVEY_FEED_PENDING_CONTINUE_KEY = runtimeConfig.storageKeys.surveyFeedPendingContinue;
const SURVEY_FEED_PENDING_FINISH_KEY = runtimeConfig.storageKeys.surveyFeedPendingFinish;

export function useSurveyFeedPage({
  setSurveyFeedbackReady,
  setStage,
  fetchNextSurvey,
}) {
  const [loadingNext, setLoadingNext] = useState(false);
  const [continueError, setContinueError] = useState("");
  const isOnline = useOnlineStatus();

  const handleSurveyContinue = useCallback(async () => {
    if (loadingNext) return;
    if (!isOnline) {
      setContinueError(uiText("survey.feedOfflineContinue"));
      setPendingFlag(SURVEY_FEED_PENDING_CONTINUE_KEY);
      return;
    }
    setLoadingNext(true);
    setContinueError("");
    setSurveyFeedbackReady(false);
    const data = await fetchNextSurvey({ clearCurrent: true });
    if (!data?.image_id) {
      setSurveyFeedbackReady(true);
      setContinueError(uiText("survey.feedLoadFailed"));
    }
    setLoadingNext(false);
  }, [fetchNextSurvey, isOnline, loadingNext, setSurveyFeedbackReady]);

  const handleSurveyFinish = useCallback(() => {
    if (!isOnline) {
      setPendingFlag(SURVEY_FEED_PENDING_FINISH_KEY);
      return;
    }
    setSurveyFeedbackReady(false);
    setStage("finished");
  }, [isOnline, setStage, setSurveyFeedbackReady]);

  useEffect(() => {
    if (!isOnline || loadingNext) return;
    const pendingContinue = getPendingFlag(SURVEY_FEED_PENDING_CONTINUE_KEY);
    const pendingFinish = getPendingFlag(SURVEY_FEED_PENDING_FINISH_KEY);
    if (pendingContinue) {
      clearPendingFlag(SURVEY_FEED_PENDING_CONTINUE_KEY);
      handleSurveyContinue();
      return;
    }
    if (pendingFinish) {
      clearPendingFlag(SURVEY_FEED_PENDING_FINISH_KEY);
      handleSurveyFinish();
    }
  }, [handleSurveyContinue, handleSurveyFinish, isOnline, loadingNext]);

  return {
    minWords: MIN_WORDS,
    loadingNext,
    continueError,
    isOnline,
    handleSurveyContinue,
    handleSurveyFinish,
  };
}
