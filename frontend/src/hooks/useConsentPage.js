import { useCallback, useEffect, useState } from "react";
import { getErrorMessage } from "../utils/errorRegistry.js";
import { runtimeConfig } from "../config/runtime";
import { clearPendingFlag, getPendingFlag, readExpiringValue, removeStoredKey, setPendingFlag, writeExpiringValue } from "../utils/storage";
import { uiText } from "../utils/uiText";
import { useOnlineStatus } from "./useOnlineStatus";

const CONSENT_DRAFT_SCHEMA_VERSION = runtimeConfig.consentDraftSchemaVersion;
const CONSENT_DRAFT_TTL_MS = runtimeConfig.consentDraftTtlMs;
const CONSENT_DRAFT_KEY = runtimeConfig.storageKeys.consentDraft;
const CONSENT_PENDING_KEY = runtimeConfig.storageKeys.consentPending;

const readConsentDraft = () => {
  return readExpiringValue(CONSENT_DRAFT_KEY, false, {
    schemaVersion: CONSENT_DRAFT_SCHEMA_VERSION,
    ttlMs: CONSENT_DRAFT_TTL_MS,
  }) === true;
};

const writeConsentDraft = (checked) => {
  writeExpiringValue(CONSENT_DRAFT_KEY, checked === true, {
    schemaVersion: CONSENT_DRAFT_SCHEMA_VERSION,
    ttlMs: CONSENT_DRAFT_TTL_MS,
  });
};

export function useConsentPage({ onConsentGiven, systemReady }) {
  const [consentChecked, setConsentChecked] = useState(() => readConsentDraft());
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const isOnline = useOnlineStatus();
  const paymentAmountLabel = `₹${runtimeConfig.paymentAmount}`;
  const rewardAmountLabel = `₹${runtimeConfig.rewardAmount}`;

  useEffect(() => {
    document.title = uiText("consent.documentTitle");
  }, []);

  useEffect(() => {
    if (!isOnline) return;
    writeConsentDraft(consentChecked);
  }, [consentChecked, isOnline]);

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
      setPendingFlag(CONSENT_PENDING_KEY);
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
      removeStoredKey(CONSENT_DRAFT_KEY);
    } catch (err) {
      setError(resolveConsentError(err));
    } finally {
      setSubmitting(false);
    }
  }, [consentChecked, isOnline, onConsentGiven, resolveConsentError, systemReady]);

  useEffect(() => {
    if (!isOnline || submitting) return;
    const pending = getPendingFlag(CONSENT_PENDING_KEY);
    if (!pending || !consentChecked) return;
    clearPendingFlag(CONSENT_PENDING_KEY);
    handleSubmit();
  }, [consentChecked, handleSubmit, isOnline, submitting]);

  return {
    consentChecked,
    setConsentChecked,
    error,
    setError,
    submitting,
    isOnline,
    paymentAmountLabel,
    rewardAmountLabel,
    handleSubmit,
  };
}
