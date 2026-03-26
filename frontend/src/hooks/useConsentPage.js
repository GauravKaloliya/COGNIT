import { useCallback, useEffect, useRef, useState } from "react";
import { getErrorMessage } from "../utils/errorRegistry.js";
import { runtimeConfig } from "../config/runtime";
import { clearPendingFlag, forEachStorageArea, getPendingFlag, makeScopedKey, readExpiringValue, removeStoredKey, setPendingFlag, writeExpiringValue } from "../utils/storage";
import { uiText } from "../utils/uiText";
import { useOnlineStatus } from "./useOnlineStatus";
import { useRetryCountdown } from "./useRetryCountdown";
import { useDebouncedPersistence } from "./useDebouncedPersistence";

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
  const [consentChecked, setConsentCheckedState] = useState(() => (
    consentGiven || (canPersistScoped ? readConsentDraft(scope) : false)
  ));
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [draftRestored, setDraftRestored] = useState(() => (canPersistScoped ? readConsentDraft(scope) : false));
  const [saveError, setSaveError] = useState("");
  const [pendingSubmit, setPendingSubmit] = useState(false);
  const isOnline = useOnlineStatus();
  const restoredScopeRef = useRef("");
  const userTouchedConsentRef = useRef(false);
  const retryCountdown = useRetryCountdown(!isOnline && pendingSubmit, runtimeConfig.serviceRetrySeconds);

  const setConsentChecked = useCallback((nextValue) => {
    userTouchedConsentRef.current = true;
    setConsentCheckedState(typeof nextValue === "function" ? nextValue : Boolean(nextValue));
  }, []);

  const { markValueSaved, resetSavedValue } = useDebouncedPersistence({
    enabled: Boolean(isOnline && canPersistScoped),
    value: consentChecked,
    delayMs: 500,
    onSchedule: () => setSaveError(""),
    onWrite: (nextConsentChecked) => {
      writeConsentDraft(scope, nextConsentChecked);
    },
    onError: () => {
      setSaveError(uiText("autosave.failed"));
    },
  });

  useEffect(() => {
    document.title = uiText("consent.documentTitle");
  }, []);

  useEffect(() => {
    if (consentGiven) {
      setConsentCheckedState(true);
      markValueSaved(true);
      return;
    }
    if (!canPersistScoped) return;
    if (restoredScopeRef.current === scope) return;
    if (userTouchedConsentRef.current) return;

    const restored = readConsentDraft(scope);
    restoredScopeRef.current = scope;
    setDraftRestored(restored === true);
    setConsentCheckedState(restored);
    markValueSaved(restored);
  }, [canPersistScoped, consentGiven, markValueSaved, scope]);

  useEffect(() => {
    restoredScopeRef.current = "";
    userTouchedConsentRef.current = false;
    resetSavedValue();
  }, [scope, resetSavedValue]);

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
      resetSavedValue();
    } catch (err) {
      setError(resolveConsentError(err));
    } finally {
      setSubmitting(false);
    }
  }, [canPersistScoped, consentChecked, isOnline, onConsentGiven, resetSavedValue, resolveConsentError, scope, systemReady]);

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
