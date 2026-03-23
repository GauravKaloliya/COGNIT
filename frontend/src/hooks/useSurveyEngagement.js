import { useCallback, useEffect, useRef, useState } from "react";
import { runtimeConfig } from "../config/runtime";
import { clearScheduledInterval, scheduleInterval } from "../utils/timing";

export function useSurveyEngagement({ copyPasteDisabled }) {
  const [engagementData, setEngagementData] = useState({
    tabSwitchCount: 0,
    pageCloseAttempts: 0,
    networkDisconnects: 0,
  });
  const [elapsed, setElapsed] = useState(0);
  const [timerActive, setTimerActive] = useState(false);
  const descriptionRef = useRef(null);
  const commentsRef = useRef(null);
  const surveyStartTime = useRef(Date.now());
  const timerIntervalRef = useRef(null);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        setEngagementData((prev) => ({ ...prev, tabSwitchCount: prev.tabSwitchCount + 1 }));
      }
    };
    const handleBeforeUnload = (event) => {
      setEngagementData((prev) => ({ ...prev, pageCloseAttempts: prev.pageCloseAttempts + 1 }));
      delete event.returnValue;
    };
    const handleOffline = () => {
      setEngagementData((prev) => ({ ...prev, networkDisconnects: prev.networkDisconnects + 1 }));
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("offline", handleOffline);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    if (timerActive) {
      timerIntervalRef.current = scheduleInterval(() => {
        setElapsed((prev) => prev + 1);
      }, runtimeConfig.surveyTimerTickMs);
    } else if (timerIntervalRef.current) {
      clearScheduledInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    return () => {
      if (timerIntervalRef.current) {
        clearScheduledInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    };
  }, [timerActive]);

  const preventCopyPaste = useCallback((event) => {
    if (!copyPasteDisabled) return;
    event.preventDefault();
    return false;
  }, [copyPasteDisabled]);

  const preventClipboardShortcuts = useCallback((event) => {
    if (!copyPasteDisabled) return;
    if ((event.ctrlKey || event.metaKey) && ["c", "x", "v", "insert"].includes(event.key.toLowerCase())) {
      event.preventDefault();
    }
    if (event.shiftKey && event.key === "Insert") {
      event.preventDefault();
    }
  }, [copyPasteDisabled]);

  useEffect(() => {
    if (!copyPasteDisabled) return;
    const refs = [descriptionRef.current, commentsRef.current].filter(Boolean);
    refs.forEach((element) => {
      element.addEventListener("copy", preventCopyPaste);
      element.addEventListener("cut", preventCopyPaste);
      element.addEventListener("paste", preventCopyPaste);
      element.addEventListener("contextmenu", preventCopyPaste);
    });
    return () => {
      refs.forEach((element) => {
        element.removeEventListener("copy", preventCopyPaste);
        element.removeEventListener("cut", preventCopyPaste);
        element.removeEventListener("paste", preventCopyPaste);
        element.removeEventListener("contextmenu", preventCopyPaste);
      });
    };
  }, [copyPasteDisabled, preventCopyPaste]);

  const resetEngagement = useCallback(() => {
    setElapsed(0);
    setTimerActive(false);
    setEngagementData({ tabSwitchCount: 0, pageCloseAttempts: 0, networkDisconnects: 0 });
    surveyStartTime.current = Date.now();
    if (timerIntervalRef.current) {
      clearScheduledInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
  }, []);

  return {
    engagementData,
    setEngagementData,
    elapsed,
    setElapsed,
    timerActive,
    setTimerActive,
    descriptionRef,
    commentsRef,
    surveyStartTime,
    preventCopyPaste,
    preventClipboardShortcuts,
    resetEngagement,
  };
}
