import { useEffect, useRef } from "react";
import { endpoints } from "../utils/api.js";
import { runtimeConfig } from "../config/runtime";
import { saveStoredValue } from "../utils/storage";
import { writeCoreValue } from "../utils/appControllerState";
import { SURVEY_API_FIELDS } from "../constants/fields";
import { telemetryIncrement } from "../utils/clientTelemetry";
import { migratePreAuthScopeToPublic } from "../utils/preAuthMigration";
import { useDebouncedPersistence } from "./useDebouncedPersistence";

const CORE_STATE_STORAGE_AREA = "local";
const PII_STATE_TTL_MS = runtimeConfig.piiStateTtlMs;

function normalizeSurvey(value) {
  if (!value || typeof value !== "object") return null;
  const imageId = String(value[SURVEY_API_FIELDS.imageId] || value.image_id || value.imageId || "").trim();
  const imageUrl = String(
    value[SURVEY_API_FIELDS.url] || value[SURVEY_API_FIELDS.imageUrl] || value.image_url || value.imageUrl || ""
  ).trim();
  if (!imageId || !imageUrl) return null;
  return {
    ...value,
    [SURVEY_API_FIELDS.imageId]: imageId,
    [SURVEY_API_FIELDS.url]: imageUrl,
  };
}

export function useWorkflowPersistence({
  workflowState,
  preAuthId,
  updateWorkflowState,
  onSessionClosed,
  scopeId,
  sessionHydrated,
  setSessionHydrated,
  isOnline,
  surveyState,
}) {
  const migratedScopePairRef = useRef("");
  const migrationOwnerIdRef = useRef(`tab_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`);
  const validationInFlightRef = useRef(null);
  const canPersist = Boolean(sessionHydrated && scopeId);
  const {
    publicId,
    sessionId,
    stage,
    consentGiven,
    userDetailsSubmitted,
    emailVerified,
    demographics,
  } = workflowState;
  const {
    survey,
    surveyCompleted,
    surveyFeedbackReady,
    lastSubmissionSucceeded,
    shownImages,
  } = surveyState;

  useEffect(() => {
    let cancelled = false;

    const validateSession = async () => {
      if (validationInFlightRef.current) {
        return validationInFlightRef.current;
      }

      const localPublicId = String(publicId || "").trim();
      const localSessionId = String(sessionId || "").trim();
      const requiresActiveSession = Boolean(localSessionId || (localPublicId && consentGiven));

      const request = (async () => {
        try {
          const session = await endpoints.getParticipantSessionFresh();
          if (cancelled) return;

          const backendPublicId = String(session?.public_id || "").trim();
          const backendSessionId = String(session?.session_id || "").trim();
          const backendClosed = session?.session_closed || session?.clear_client_state;

          if (backendClosed) {
            onSessionClosed?.(localPublicId || null);
            return;
          }

          if (requiresActiveSession && (!backendPublicId || !backendSessionId)) {
            onSessionClosed?.(localPublicId || null);
            return;
          }

          if (!localPublicId && (backendPublicId || backendSessionId)) {
            updateWorkflowState({
              ...(backendPublicId ? { publicId: backendPublicId } : {}),
              ...(backendSessionId ? { sessionId: backendSessionId } : {}),
            });
          } else if (backendPublicId || backendSessionId) {
            updateWorkflowState((prev) => ({
              ...(backendPublicId && !prev.publicId ? { publicId: backendPublicId } : {}),
              ...(backendSessionId && backendSessionId !== prev.sessionId ? { sessionId: backendSessionId } : {}),
            }));
          }
        } catch {
          // Storage-first boot should still continue even when cookies fail.
        } finally {
          if (!cancelled) {
            setSessionHydrated(true);
          }
          validationInFlightRef.current = null;
        }
      })();

      validationInFlightRef.current = request;
      return request;
    };

    void validateSession();

    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === "hidden") return;
      if (!isOnline) return;
      void validateSession();
    };

    window.addEventListener("focus", handleVisibilityOrFocus);
    document.addEventListener("visibilitychange", handleVisibilityOrFocus);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", handleVisibilityOrFocus);
      document.removeEventListener("visibilitychange", handleVisibilityOrFocus);
    };
  }, [
    consentGiven,
    isOnline,
    onSessionClosed,
    publicId,
    sessionId,
    setSessionHydrated,
    updateWorkflowState,
  ]);

  useEffect(() => {
    saveStoredValue(runtimeConfig.storageKeys.publicId, publicId, { area: CORE_STATE_STORAGE_AREA });
  }, [publicId]);

  useEffect(() => {
    saveStoredValue(runtimeConfig.storageKeys.preAuthId, preAuthId, { area: CORE_STATE_STORAGE_AREA });
  }, [preAuthId]);

  useEffect(() => {
    if (!sessionHydrated || !publicId || !preAuthId || publicId === preAuthId) return;
    const pair = `${preAuthId}->${publicId}`;
    if (migratedScopePairRef.current === pair) return;
    const result = migratePreAuthScopeToPublic(
      { preAuthId, publicId },
      {
        ownerId: migrationOwnerIdRef.current,
        onEvent: (eventName) => telemetryIncrement(eventName),
      }
    );
    if (result.status !== "failed") {
      migratedScopePairRef.current = pair;
    }
  }, [preAuthId, publicId, sessionHydrated]);

  useEffect(() => {
    if (!canPersist) return;
    writeCoreValue(runtimeConfig.storageKeys.stage, stage, scopeId);
  }, [canPersist, scopeId, stage]);

  useEffect(() => {
    if (!canPersist) return;
    writeCoreValue(runtimeConfig.storageKeys.sessionId, sessionId, scopeId);
  }, [canPersist, scopeId, sessionId]);

  useEffect(() => {
    if (!canPersist) return;
    writeCoreValue(runtimeConfig.storageKeys.consentGiven, consentGiven, scopeId);
  }, [canPersist, consentGiven, scopeId]);

  useEffect(() => {
    if (!canPersist) return;
    writeCoreValue(runtimeConfig.storageKeys.userDetailsSubmitted, userDetailsSubmitted, scopeId);
  }, [canPersist, scopeId, userDetailsSubmitted]);

  useEffect(() => {
    if (!canPersist) return;
    writeCoreValue(runtimeConfig.storageKeys.emailVerified, emailVerified, scopeId);
  }, [canPersist, emailVerified, scopeId]);

  useDebouncedPersistence({
    enabled: Boolean(canPersist && isOnline),
    value: demographics,
    delayMs: 400,
    onWrite: (nextDemographics) => {
      writeCoreValue(runtimeConfig.storageKeys.demographics, nextDemographics, scopeId, { ttlMs: PII_STATE_TTL_MS });
    },
  });

  useEffect(() => {
    if (!canPersist) return;
    writeCoreValue(runtimeConfig.storageKeys.survey, normalizeSurvey(survey), scopeId);
  }, [canPersist, scopeId, survey]);

  useEffect(() => {
    if (!canPersist) return;
    writeCoreValue(runtimeConfig.storageKeys.surveyCompleted, surveyCompleted, scopeId);
  }, [canPersist, scopeId, surveyCompleted]);

  useEffect(() => {
    if (!canPersist) return;
    writeCoreValue(runtimeConfig.storageKeys.surveyFeedbackReady, surveyFeedbackReady, scopeId);
  }, [canPersist, scopeId, surveyFeedbackReady]);

  useEffect(() => {
    if (!canPersist) return;
    writeCoreValue(runtimeConfig.storageKeys.lastSubmissionSucceeded, lastSubmissionSucceeded, scopeId);
  }, [canPersist, lastSubmissionSucceeded, scopeId]);

  useEffect(() => {
    if (!canPersist) return;
    writeCoreValue(runtimeConfig.storageKeys.shownImages, shownImages, scopeId);
  }, [canPersist, scopeId, shownImages]);
}
