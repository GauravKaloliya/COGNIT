import { useCallback, useEffect, useRef, useState } from "react";
import { runtimeConfig } from "../config/runtime";
import { clearScheduledInterval, scheduleInterval } from "../utils/timing";

const EMPTY_ENGAGEMENT = {
  tabSwitchCount: 0,
  pageCloseAttempts: 0,
  networkDisconnects: 0,
};

export function useSurveyEngagement({ copyPasteDisabled }) {
  const [engagementData, setEngagementData] = useState(EMPTY_ENGAGEMENT);
  const [elapsed, setElapsed] = useState(0);
  const [timerActive, setTimerActive] = useState(false);
  const descriptionRef = useRef(null);
  const commentsRef = useRef(null);
  const surveyStartTime = useRef(Date.now());
  const timerIntervalRef = useRef(null);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden) {
        setEngagementData((prev) => ({ ...prev, tabSwitchCount: prev.tabSwitchCount + 1 }));
      }
    };
    const onBeforeUnload = (event) => {
      setEngagementData((prev) => ({ ...prev, pageCloseAttempts: prev.pageCloseAttempts + 1 }));
      delete event.returnValue;
    };
    const onOffline = () => {
      setEngagementData((prev) => ({ ...prev, networkDisconnects: prev.networkDisconnects + 1 }));
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("offline", onOffline);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    if (!timerActive) {
      if (timerIntervalRef.current) {
        clearScheduledInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
      return undefined;
    }

    timerIntervalRef.current = scheduleInterval(() => {
      setElapsed((prev) => prev + 1);
    }, runtimeConfig.surveyTimerTickMs);

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
  }, [copyPasteDisabled]);

  const preventClipboardShortcuts = useCallback((event) => {
    if (!copyPasteDisabled) return;
    if ((event.ctrlKey || event.metaKey) && ["c", "x", "v", "insert"].includes(String(event.key || "").toLowerCase())) {
      event.preventDefault();
    }
    if (event.shiftKey && event.key === "Insert") {
      event.preventDefault();
    }
  }, [copyPasteDisabled]);

  useEffect(() => {
    if (!copyPasteDisabled) return undefined;
    const elements = [descriptionRef.current, commentsRef.current].filter(Boolean);
    elements.forEach((element) => {
      element.addEventListener("copy", preventCopyPaste);
      element.addEventListener("cut", preventCopyPaste);
      element.addEventListener("paste", preventCopyPaste);
      element.addEventListener("contextmenu", preventCopyPaste);
    });
    return () => {
      elements.forEach((element) => {
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
    setEngagementData(EMPTY_ENGAGEMENT);
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
