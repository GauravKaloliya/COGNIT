import { useEffect, useRef, useState } from "react";
import { removeStoredKey } from "../utils/storage";
import { uiText } from "../utils/uiText";
import {
  getActiveSurveyDraftKey,
  getSurveyDraftKey,
  readSurveyDraft,
  writeSurveyDraft,
} from "../utils/surveyDraft";
import { clearScheduledTimeout, scheduleTimeout } from "../utils/timing";

export function useSurveyDraftPersistence({
  publicId,
  surveyImageId,
  isOnline,
  draftState,
  onRestore,
}) {
  const [draftRestored, setDraftRestored] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const saveTimeoutRef = useRef(null);
  const lastSavedAtRef = useRef(null);
  const draftKey = getSurveyDraftKey(publicId, surveyImageId);
  const activeDraftKey = getActiveSurveyDraftKey(publicId);

  useEffect(() => {
    setDraftRestored(false);
    if (!surveyImageId) return;

    try {
      const saved = readSurveyDraft(draftKey) || readSurveyDraft(activeDraftKey);
      if (saved) {
        setDraftRestored(true);
        onRestore?.(saved);
      }
    } catch {
      // Ignore malformed draft payload and continue with fresh inputs.
    }
  }, [activeDraftKey, draftKey, onRestore, surveyImageId]);

  useEffect(() => {
    if (!isOnline || !draftKey || !surveyImageId) return;
    setIsSaving(true);
    setSaveError("");

    try {
      writeSurveyDraft(draftKey, draftState);
      writeSurveyDraft(activeDraftKey, draftState);
      const now = Date.now();
      lastSavedAtRef.current = now;
      setLastSavedAt(now);
    } catch {
      setSaveError(uiText("autosave.failed"));
      if (lastSavedAtRef.current) {
        setLastSavedAt(lastSavedAtRef.current);
      }
    }

    if (saveTimeoutRef.current) {
      clearScheduledTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = scheduleTimeout(() => setIsSaving(false), 400);
  }, [activeDraftKey, draftKey, draftState, isOnline, surveyImageId]);

  useEffect(() => {
    if (!isOnline) setIsSaving(false);
  }, [isOnline]);

  useEffect(() => () => {
    if (saveTimeoutRef.current) clearScheduledTimeout(saveTimeoutRef.current);
  }, []);

  const clearDrafts = () => {
    if (draftKey) {
      removeStoredKey(draftKey, "session");
      removeStoredKey(draftKey, "local");
    }
    removeStoredKey(activeDraftKey, "session");
    removeStoredKey(activeDraftKey, "local");
  };

  return {
    draftKey,
    activeDraftKey,
    draftRestored,
    lastSavedAt,
    isSaving,
    saveError,
    clearDrafts,
  };
}
