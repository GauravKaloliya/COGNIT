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
  return readExpiringValue(key, false, { ...opts, area: "local" }) === true;
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
  const [saveError, setSaveError] = useState("");
  const [pendingSubmit, setPendingSubmit] = useState(false);
  const isOnline = useOnlineStatus();
  const draftSaveTimeoutRef = useRef(null);
  const lastSavedDraftRef = useRef();
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
    const last = lastSavedDraftRef.current;
    const current = JSON.stringify({ checked: consentChecked });
    if (last === current) return;
    if (draftSaveTimeoutRef.current) {
      clearScheduledTimeout(draftSaveTimeoutRef.current);
    }
    draftSaveTimeoutRef.current = scheduleTimeout(() => {
      try {
        writeConsentDraft(scope, consentChecked);
        lastSavedDraftRef.current = current;
      } catch {
        setSaveError(uiText("autosave.failed"));
      }
    }, 700);
  }, [consentChecked, isOnline, scope]);

  useEffect(() => () => {
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
      setError(getErrorMessage("UI_001_0001"));
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
    saveError,
    retryCountdown,
  };
}
