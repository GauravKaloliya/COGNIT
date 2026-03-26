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

const getConsentDraftKey = (scope) => (scope ? makeScopedKey(CONSENT_DRAFT_KEY, scope) : null);
const getConsentPendingKey = (scope) => (scope ? makeScopedKey(CONSENT_PENDING_KEY, scope) : null);

const readConsentDraft = (scope) => {
  const key = getConsentDraftKey(scope);
  if (!key) return false;
  const opts = { schemaVersion: CONSENT_DRAFT_SCHEMA_VERSION, ttlMs: CONSENT_DRAFT_TTL_MS };
  return readExpiringValue(key, false, { ...opts, area: "local" }) === true;
};

const writeConsentDraft = (scope, checked) => {
  const key = getConsentDraftKey(scope);
  if (!key) return;
  writeExpiringValue(key, checked === true, {
    area: "local",
    schemaVersion: CONSENT_DRAFT_SCHEMA_VERSION,
    ttlMs: CONSENT_DRAFT_TTL_MS,
  });
};

export function useConsentPage({
  storageScope,
  consentGiven = false,
  onConsentGiven,
  systemReady,
  sessionHydrated = false,
}) {
  const scope = String(storageScope || "").trim();
  const canPersistScoped = Boolean(sessionHydrated && scope);
  const [consentChecked, setConsentChecked] = useState(() => (
    consentGiven || (canPersistScoped ? readConsentDraft(scope) : false)
  ));
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [draftRestored] = useState(() => (canPersistScoped ? readConsentDraft(scope) : false));
  const [saveError, setSaveError] = useState("");
  const [pendingSubmit, setPendingSubmit] = useState(false);
  const isOnline = useOnlineStatus();
  const draftSaveTimeoutRef = useRef(null);
  const retryCountdown = useRetryCountdown(!isOnline && pendingSubmit, runtimeConfig.serviceRetrySeconds);

  useEffect(() => {
    document.title = uiText("consent.documentTitle");
  }, []);

  useEffect(() => {
    if (consentGiven) {
      setConsentChecked(true);
      return;
    }
    if (canPersistScoped) {
      setConsentChecked(readConsentDraft(scope));
    }
  }, [canPersistScoped, consentGiven, scope]);

  useEffect(() => {
    if (!isOnline || !canPersistScoped) return;
    setSaveError("");
    if (draftSaveTimeoutRef.current) {
      clearScheduledTimeout(draftSaveTimeoutRef.current);
    }
    draftSaveTimeoutRef.current = scheduleTimeout(() => {
      try {
        writeConsentDraft(scope, consentChecked);
      } catch {
        setSaveError(uiText("autosave.failed"));
      }
    }, 700);
  }, [canPersistScoped, consentChecked, isOnline, scope]);

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
      const pendingKey = canPersistScoped ? getConsentPendingKey(scope) : null;
      if (pendingKey) {
        setPendingFlag(pendingKey);
      }
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
        const draftKey = canPersistScoped ? getConsentDraftKey(scope) : null;
        if (draftKey) {
          removeStoredKey(draftKey, area);
        }
      });
    } catch (err) {
      setError(resolveConsentError(err));
    } finally {
      setSubmitting(false);
    }
  }, [canPersistScoped, consentChecked, isOnline, onConsentGiven, resolveConsentError, scope, systemReady]);

  useEffect(() => {
    if (!isOnline || submitting) return;
    const pendingKey = canPersistScoped ? getConsentPendingKey(scope) : null;
    if (!pendingKey) return;
    const pending = getPendingFlag(pendingKey);
    if (!pending || !consentChecked) return;
    clearPendingFlag(pendingKey);
    setPendingSubmit(false);
    handleSubmit();
  }, [canPersistScoped, consentChecked, handleSubmit, isOnline, scope, submitting]);

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
