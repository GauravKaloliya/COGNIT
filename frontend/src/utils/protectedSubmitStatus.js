import { startTransition, useCallback, useMemo, useState } from "react";
import { uiText } from "./uiText";

export const PROTECTED_SUBMIT_PHASES = {
  idle: "idle",
  verifyingSecurity: "verifying-security",
  submitting: "submitting",
};

function normalizeProtectedSubmitPhase(phase) {
  const normalized = String(phase || "").trim();
  return Object.values(PROTECTED_SUBMIT_PHASES).includes(normalized)
    ? normalized
    : PROTECTED_SUBMIT_PHASES.idle;
}

export function getProtectedSubmitMessage(
  phase,
  {
    verifyingSecurityKey = "common.verifyingSecurity",
    submittingKey = "common.submitting",
  } = {}
) {
  switch (normalizeProtectedSubmitPhase(phase)) {
    case PROTECTED_SUBMIT_PHASES.verifyingSecurity:
      return uiText(verifyingSecurityKey);
    case PROTECTED_SUBMIT_PHASES.submitting:
      return uiText(submittingKey);
    default:
      return "";
  }
}

export function useProtectedSubmitStatus(options = {}) {
  const [phase, setPhaseState] = useState(PROTECTED_SUBMIT_PHASES.idle);
  const setPhase = useCallback((nextPhase) => {
    startTransition(() => {
      setPhaseState(normalizeProtectedSubmitPhase(nextPhase));
    });
  }, []);
  const resetPhase = useCallback(() => {
    setPhase(PROTECTED_SUBMIT_PHASES.idle);
  }, [setPhase]);
  const optimisticMessage = useMemo(
    () => getProtectedSubmitMessage(phase, options),
    [options, phase]
  );
  return {
    submitPhase: phase,
    optimisticMessage,
    setSubmitPhase: setPhase,
    resetSubmitPhase: resetPhase,
    isBusy:
      phase === PROTECTED_SUBMIT_PHASES.verifyingSecurity
      || phase === PROTECTED_SUBMIT_PHASES.submitting,
  };
}
