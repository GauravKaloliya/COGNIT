import { useCallback, useEffect, useRef } from "react";
import { endpoints } from "../utils/api.js";
import { runtimeConfig } from "../config/runtime";
import { APP_FLOW } from "../config/appFlow";
import { saveStoredValue } from "../utils/storage";
import { writeCoreValue } from "../utils/appControllerState";
import { SURVEY_API_FIELDS } from "../constants/fields";
import { telemetryIncrement } from "../utils/clientTelemetry";
import { migratePreAuthScopeToPublic } from "../utils/preAuthMigration";
import { useDebouncedPersistence } from "./useDebouncedPersistence";
import { SURVEY_LOAD_STATES } from "../utils/surveyStateMachine";

const CORE_STATE_STORAGE_AREA = "local";
const PII_STATE_TTL_MS = runtimeConfig.piiStateTtlMs;
const initialSessionValidationState = {
  inflight: null,
  completedAt: 0,
};

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

function normalizeSurveyLoadState(value, fallback = SURVEY_LOAD_STATES.idle) {
  const normalized = String(value || "").trim();
  return Object.values(SURVEY_LOAD_STATES).includes(normalized) ? normalized : fallback;
}

function deriveSessionSurveyLoadState(session) {
  const stage = String(session?.workflow_status?.stage || "").trim();
  if (session?.current_survey) return SURVEY_LOAD_STATES.ready;
  if (stage === APP_FLOW.stages.survey && session?.workflow_status?.needs_image_allocation) {
    return SURVEY_LOAD_STATES.awaitingNextImage;
  }
  return SURVEY_LOAD_STATES.idle;
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
  const lastValidatedAtRef = useRef(0);
  const previousOnlineRef = useRef(isOnline);
  const bootGraceUntilRef = useRef(Date.now() + runtimeConfig.sessionValidationBootGraceMs);
  const lastVisibilityStateRef = useRef(
    typeof document !== "undefined" ? document.visibilityState : "visible"
  );
  const validationContextRef = useRef({
    publicId: "",
    sessionId: "",
    stage: APP_FLOW.stages.consent,
    consentGiven: false,
  });
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
    loadState,
    surveyCompleted,
    surveyFeedbackReady,
    lastSubmissionSucceeded,
    shownImages,
  } = surveyState;

  useEffect(() => {
    validationContextRef.current = {
      publicId: String(publicId || "").trim(),
      sessionId: String(sessionId || "").trim(),
      stage: String(stage || APP_FLOW.stages.consent).trim() || APP_FLOW.stages.consent,
      consentGiven: consentGiven === true,
    };
  }, [consentGiven, publicId, sessionId, stage]);

  const validateSession = useCallback(async ({
    forceFresh = false,
    dedupeInitial = false,
  } = {}) => {
    const now = Date.now();

    if (dedupeInitial) {
      if (initialSessionValidationState.inflight) {
        return initialSessionValidationState.inflight;
      }
      if (now - initialSessionValidationState.completedAt < runtimeConfig.sessionValidationCooldownMs) {
        setSessionHydrated(true);
        return null;
      }
    }

    if (validationInFlightRef.current) {
      return validationInFlightRef.current;
    }

    if (!forceFresh && now - lastValidatedAtRef.current < runtimeConfig.sessionValidationCooldownMs) {
      return null;
    }

    lastValidatedAtRef.current = now;
    const currentContext = validationContextRef.current;
    const localPublicId = currentContext.publicId;
    const localSessionId = currentContext.sessionId;
    const normalizedStage = currentContext.stage;
    if (normalizedStage === APP_FLOW.stages.postSurvey && localPublicId) {
      setSessionHydrated(true);
      return null;
    }
    const stageRequiresActiveSession = normalizedStage === APP_FLOW.stages.survey;
    const requiresActiveSession = Boolean(
      stageRequiresActiveSession && (localSessionId || (localPublicId && currentContext.consentGiven))
    );

    const request = (async () => {
      try {
        const session = await (
          forceFresh
            ? endpoints.getParticipantSessionFresh()
            : endpoints.getParticipantSession()
        );

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

        const effectiveScope = String(backendPublicId || localPublicId || "").trim();
        if (effectiveScope) {
          const backendSurvey = normalizeSurvey(session?.current_survey);
          const backendShownImages = Array.isArray(session?.shown_images)
            ? session.shown_images.map((imageId) => String(imageId || "").trim()).filter(Boolean)
            : [];
          const backendCompleted = Math.max(0, Number(session?.workflow_status?.survey_completed) || 0);
          const backendStage = String(session?.workflow_status?.stage || "").trim();
          const backendLoadState = deriveSessionSurveyLoadState(session);

          writeCoreValue(runtimeConfig.storageKeys.survey, backendSurvey, effectiveScope);
          writeCoreValue(runtimeConfig.storageKeys.surveyLoadState, backendLoadState, effectiveScope);
          writeCoreValue(runtimeConfig.storageKeys.surveyCompleted, backendCompleted, effectiveScope);
          writeCoreValue(runtimeConfig.storageKeys.shownImages, backendShownImages, effectiveScope);
          if (backendStage) {
            updateWorkflowState((prev) => ({ ...prev, stage: backendStage }));
          }
        }
      } catch {
        // Storage-first boot should still continue even when cookies fail.
      } finally {
        if (dedupeInitial) {
          initialSessionValidationState.completedAt = Date.now();
          initialSessionValidationState.inflight = null;
        }
        setSessionHydrated(true);
        validationInFlightRef.current = null;
      }
    })();

    validationInFlightRef.current = request;
    if (dedupeInitial) {
      initialSessionValidationState.inflight = request;
    }
    return request;
  }, [onSessionClosed, setSessionHydrated, updateWorkflowState]);

  useEffect(() => {
    bootGraceUntilRef.current = Date.now() + runtimeConfig.sessionValidationBootGraceMs;
    void validateSession({ dedupeInitial: true });
  }, [validateSession]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      const previousVisibilityState = lastVisibilityStateRef.current;
      const nextVisibilityState = document.visibilityState;
      lastVisibilityStateRef.current = nextVisibilityState;
      if (!isOnline) return;
      if (Date.now() < bootGraceUntilRef.current) return;
      if (previousVisibilityState !== "hidden" || nextVisibilityState !== "visible") return;
      void validateSession();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [isOnline, validateSession]);

  useEffect(() => {
    const wasOnline = previousOnlineRef.current;
    previousOnlineRef.current = isOnline;
    if (!isOnline || wasOnline) return;
    void validateSession({ forceFresh: true });
  }, [isOnline, validateSession]);

  useEffect(() => {
    const normalizedPublicId = String(publicId || "").trim();
    const normalizedSessionId = String(sessionId || "").trim();
    if (!isOnline) return;
    if (stage !== APP_FLOW.stages.survey) return;
    if (!normalizedPublicId || normalizedSessionId) return;
    void validateSession({ forceFresh: true });
  }, [isOnline, publicId, sessionId, stage, validateSession]);

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
    writeCoreValue(
      runtimeConfig.storageKeys.surveyLoadState,
      normalizeSurveyLoadState(loadState, survey ? SURVEY_LOAD_STATES.ready : SURVEY_LOAD_STATES.idle),
      scopeId
    );
  }, [canPersist, loadState, scopeId, survey]);

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
