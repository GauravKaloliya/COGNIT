import { useCallback, useEffect, useRef, useState } from "react";
import { getErrorMessage } from "../utils/errorRegistry.js";
import { runtimeConfig } from "../config/runtime";
import { clearPendingFlag, forEachStorageArea, getPendingFlag, makeScopedKey, readExpiringValue, removeStoredKey, setPendingFlag, writeExpiringValue } from "../utils/storage";
import { uiText } from "../utils/uiText";
import { useOnlineStatus } from "./useOnlineStatus";
import { useRetryCountdown } from "./useRetryCountdown";
import { clearScheduledTimeout, scheduleTimeout } from "../utils/timing";

const CONSENT_DRAFT_SCHEMA_VERSION = runtimeConfig.consentDraftSchemaVersion;
const CONSENT_DRAFT_TTL_MS = runtimeConfig.consentDraftTtlMs;
const CONSENT_DRAFT_KEY = runtimeConfig.storageKeys.consentDraft;
const CONSENT_PENDING_KEY = runtimeConfig.storageKeys.consentPending;

const getConsentDraftKey = (scope) => makeScopedKey(CONSENT_DRAFT_KEY, scope);
const getConsentPendingKey = (scope) => makeScopedKey(CONSENT_PENDING_KEY, scope);

const readConsentDraft = (scope) => {
  const key = getConsentDraftKey(scope);
  const opts = { schemaVersion: CONSENT_DRAFT_SCHEMA_VERSION, ttlMs: CONSENT_DRAFT_TTL_MS };
  const localScoped = readExpiringValue(key, false, { ...opts, area: "local" }) === true;
  if (localScoped) return true;

  // Backward-compatible migration: consent draft used to live in sessionStorage and/or unscoped keys.
  const legacy =
    (readExpiringValue(key, false, { ...opts, area: "session" }) === true) ||
    (readExpiringValue(CONSENT_DRAFT_KEY, false, { ...opts, area: "local" }) === true) ||
    (readExpiringValue(CONSENT_DRAFT_KEY, false, { ...opts, area: "session" }) === true);
  if (legacy) {
    try {
      writeExpiringValue(key, true, { ...opts, area: "local" });
      removeStoredKey(key, "session");
      removeStoredKey(CONSENT_DRAFT_KEY, "local");
      removeStoredKey(CONSENT_DRAFT_KEY, "session");
    } catch {
      // Ignore migration failures.
    }
  }
  return legacy;
};

const writeConsentDraft = (scope, checked) => {
  writeExpiringValue(getConsentDraftKey(scope), checked === true, {
    area: "local",
    schemaVersion: CONSENT_DRAFT_SCHEMA_VERSION,
    ttlMs: CONSENT_DRAFT_TTL_MS,
  });
};

export function useConsentPage({ publicId, consentGiven = false, onConsentGiven, systemReady }) {
  const scope = String(publicId || "").trim() || "anon";
  const [consentChecked, setConsentChecked] = useState(() => (
    consentGiven || readConsentDraft(scope)
  ));
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [draftRestored] = useState(() => readConsentDraft(scope));
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [pendingSubmit, setPendingSubmit] = useState(false);
  const isOnline = useOnlineStatus();
  const saveTimeoutRef = useRef(null);
  const draftSaveTimeoutRef = useRef(null);
  const lastSavedAtRef = useRef(null);
  const retryCountdown = useRetryCountdown(!isOnline && pendingSubmit, runtimeConfig.serviceRetrySeconds);

  useEffect(() => {
    document.title = uiText("consent.documentTitle");
  }, []);

  useEffect(() => {
    if (consentGiven) {
      setConsentChecked(true);
    }
  }, [consentGiven]);

  useEffect(() => {
    if (!isOnline) return;
    setSaveError("");
    setIsSaving(true);
    if (draftSaveTimeoutRef.current) {
      clearScheduledTimeout(draftSaveTimeoutRef.current);
    }
    draftSaveTimeoutRef.current = scheduleTimeout(() => {
      try {
        writeConsentDraft(scope, consentChecked);
        const now = Date.now();
        lastSavedAtRef.current = now;
        setLastSavedAt(now);
      } catch {
        setSaveError(uiText("autosave.failed"));
        if (lastSavedAtRef.current) {
          setLastSavedAt(lastSavedAtRef.current);
        }
      } finally {
        if (saveTimeoutRef.current) {
          clearScheduledTimeout(saveTimeoutRef.current);
        }
        saveTimeoutRef.current = scheduleTimeout(() => setIsSaving(false), 400);
      }
    }, 700);
  }, [consentChecked, isOnline, scope]);

  useEffect(() => {
    if (!isOnline) setIsSaving(false);
  }, [isOnline]);

  useEffect(() => () => {
    if (saveTimeoutRef.current) clearScheduledTimeout(saveTimeoutRef.current);
    if (draftSaveTimeoutRef.current) clearScheduledTimeout(draftSaveTimeoutRef.current);
  }, []);

  const resolveConsentError = useCallback((err) => {
    const message = err?.message || "";
    if (message.toLowerCase().includes("expected pattern")) {
      return getErrorMessage("SYS_002_0001");
    }
    if (err?.code) {
      return getErrorMessage(err.code);
    }
    return getErrorMessage("SYS_002_0002");
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!isOnline) {
      setError(uiText("consent.offlineSubmit"));
      setPendingFlag(getConsentPendingKey(scope));
      setPendingSubmit(true);
      return;
    }
    if (!systemReady) {
      setError(getErrorMessage("SYS_002_0003"));
      return;
    }

    if (!consentChecked) {
      setError(getErrorMessage("AUTH_001_0001"));
      return;
    }

    setError(null);
    setSubmitting(true);

    try {
      await onConsentGiven();
      forEachStorageArea((area) => {
        removeStoredKey(CONSENT_DRAFT_KEY, area);
        removeStoredKey(getConsentDraftKey(scope), area);
      });
    } catch (err) {
      setError(resolveConsentError(err));
    } finally {
      setSubmitting(false);
    }
  }, [consentChecked, isOnline, onConsentGiven, resolveConsentError, scope, systemReady]);

  useEffect(() => {
    if (!isOnline || submitting) return;
    const pending = getPendingFlag(getConsentPendingKey(scope));
    if (!pending || !consentChecked) return;
    clearPendingFlag(getConsentPendingKey(scope));
    setPendingSubmit(false);
    handleSubmit();
  }, [consentChecked, handleSubmit, isOnline, scope, submitting]);

  return {
    consentChecked,
    setConsentChecked,
    error,
    setError,
    submitting,
    isOnline,
    handleSubmit,
    draftRestored,
    lastSavedAt,
    isSaving,
    saveError,
    retryCountdown,
  };
}
