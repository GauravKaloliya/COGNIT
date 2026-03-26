import { useEffect, useRef, useState } from "react";
import { removeStoredKey } from "../utils/storage";
import { uiText } from "../utils/uiText";
import { useDebouncedPersistence } from "./useDebouncedPersistence";
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
  const initialDraftStateRef = useRef(null);
  const restoredDraftKeyRef = useRef("");

  const serializeDraftState = (value) => {
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  };

  const { markValueSaved, resetSavedValue } = useDebouncedPersistence({
    enabled: Boolean(isOnline && draftKey && surveyImageId),
    value: draftState,
    delayMs: 500,
    onSchedule: () => setSaveError(""),
    onWrite: (nextDraftState) => {
      writeSurveyDraft(draftKey, nextDraftState);
      writeSurveyDraft(activeDraftKey, nextDraftState);
    },
    onError: () => {
      setSaveError(uiText("autosave.failed"));
    },
  });

  useEffect(() => {
    setDraftRestored(false);
    initialDraftStateRef.current = serializeDraftState(draftState);
    restoredDraftKeyRef.current = "";
    resetSavedValue();
  }, [draftKey, draftState, resetSavedValue]);

  useEffect(() => {
    if (!surveyImageId) return;

    try {
      const saved = readSurveyDraft(draftKey) || readSurveyDraft(activeDraftKey);
      if (!saved) return;
      if (restoredDraftKeyRef.current === draftKey) return;

      const currentDraftSerialized = serializeDraftState(draftState);
      if (currentDraftSerialized !== initialDraftStateRef.current) return;

      restoredDraftKeyRef.current = draftKey;
      setDraftRestored(true);
      markValueSaved(saved);
      onRestore?.(saved);
    } catch {
      // Ignore malformed draft payload and continue with fresh inputs.
    }
  }, [activeDraftKey, draftKey, draftState, markValueSaved, onRestore, surveyImageId]);

  const clearDrafts = () => {
    if (draftKey) {
      removeStoredKey(draftKey, "session");
      removeStoredKey(draftKey, "local");
    }
    if (activeDraftKey) {
      removeStoredKey(activeDraftKey, "session");
      removeStoredKey(activeDraftKey, "local");
    }
    resetSavedValue();
  };

  return {
    draftKey,
    activeDraftKey,
    draftRestored,
    saveError,
    clearDrafts,
  };
}
