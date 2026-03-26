import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { removeStoredKey } from "../utils/storage";
import { uiText } from "../utils/uiText";
import { useDebouncedPersistence } from "./useDebouncedPersistence";
import {
  getActiveSurveyDraftKey,
  getSurveyDraftKey,
  readSurveyDraft,
  writeSurveyDraft,
} from "../utils/surveyDraft";

function safeSerialize(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

export function useSurveyDraftPersistence({
  publicId,
  surveyImageId,
  isOnline,
  draftState,
  onRestore,
}) {
  const [saveError, setSaveError] = useState("");
  const draftKey = useMemo(() => getSurveyDraftKey(publicId, surveyImageId), [publicId, surveyImageId]);
  const activeDraftKey = useMemo(() => getActiveSurveyDraftKey(publicId), [publicId]);
  const initialDraftRef = useRef("");
  const restoredDraftKeyRef = useRef("");
  const latestDraftStateRef = useRef(draftState);
  latestDraftStateRef.current = draftState;

  const { markValueSaved, resetSavedValue } = useDebouncedPersistence({
    enabled: Boolean(isOnline && draftKey && surveyImageId),
    value: draftState,
    delayMs: 500,
    onSchedule: () => setSaveError(""),
    onWrite: (nextDraftState) => {
      if (draftKey) writeSurveyDraft(draftKey, nextDraftState);
      if (activeDraftKey) writeSurveyDraft(activeDraftKey, nextDraftState);
    },
    onError: () => setSaveError(uiText("autosave.failed")),
  });

  useEffect(() => {
    restoredDraftKeyRef.current = "";
    initialDraftRef.current = safeSerialize(latestDraftStateRef.current);
    resetSavedValue();
  }, [draftKey, resetSavedValue, surveyImageId]);

  useEffect(() => {
    if (!surveyImageId || !draftKey || restoredDraftKeyRef.current === draftKey) return;
    const savedDraft = readSurveyDraft(draftKey) || readSurveyDraft(activeDraftKey);
    if (!savedDraft) return;
    if (safeSerialize(draftState) !== initialDraftRef.current) return;
    restoredDraftKeyRef.current = draftKey;
    initialDraftRef.current = safeSerialize(savedDraft);
    markValueSaved(savedDraft);
    onRestore?.(savedDraft);
  }, [activeDraftKey, draftKey, draftState, markValueSaved, onRestore, surveyImageId]);

  const clearDrafts = useCallback(() => {
    if (draftKey) {
      removeStoredKey(draftKey, "local");
      removeStoredKey(draftKey, "session");
    }
    if (activeDraftKey) {
      removeStoredKey(activeDraftKey, "local");
      removeStoredKey(activeDraftKey, "session");
    }
    resetSavedValue();
  }, [activeDraftKey, draftKey, resetSavedValue]);

  return {
    saveError,
    clearDrafts,
  };
}
