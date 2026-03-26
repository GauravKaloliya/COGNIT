import { useEffect, useState } from "react";
import { removeStoredKey } from "../utils/storage";
import { uiText } from "../utils/uiText";
import {
  getActiveSurveyDraftKey,
  getSurveyDraftKey,
  readSurveyDraft,
  writeSurveyDraft,
} from "../utils/surveyDraft";

export function useSurveyDraftPersistence({
  publicId,
  surveyImageId,
  isOnline,
  draftState,
  onRestore,
}) {
  const [draftRestored, setDraftRestored] = useState(false);
  const [saveError, setSaveError] = useState("");
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
    setSaveError("");

    try {
      writeSurveyDraft(draftKey, draftState);
      writeSurveyDraft(activeDraftKey, draftState);
    } catch {
      setSaveError(uiText("autosave.failed"));
    }
  }, [activeDraftKey, draftKey, draftState, isOnline, surveyImageId]);

  const clearDrafts = () => {
    if (draftKey) {
      removeStoredKey(draftKey, "session");
      removeStoredKey(draftKey, "local");
    }
    if (activeDraftKey) {
      removeStoredKey(activeDraftKey, "session");
      removeStoredKey(activeDraftKey, "local");
    }
  };

  return {
    draftKey,
    activeDraftKey,
    draftRestored,
    saveError,
    clearDrafts,
  };
}
