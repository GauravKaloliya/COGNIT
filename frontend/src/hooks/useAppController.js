import { useCallback, useEffect, useRef, useState } from "react";
import { endpoints } from "../utils/api.js";
import { getErrorMessage } from "../utils/errorRegistry.js";
import { useOnlineStatus } from "./useOnlineStatus";
import { useSystemHealth } from "./useSystemHealth";
import { usePaymentFlow } from "./usePaymentFlow";
import { useSurveyFlow } from "./useSurveyFlow";
import { runtimeConfig } from "../config/runtime";
import { uiText } from "../utils/uiText";
import { ALL_STORAGE_AREAS, forEachStorageArea, getStoredValue, makeScopedKey, readExpiringValue, readJsonValue, removeStoredKey, saveStoredValue, writeExpiringValue, writeJsonValue } from "../utils/storage";
import { APP_FLOW, APP_STAGE_ORDER } from "../config/appFlow";
import { ACTIVE_TAB_LOCK_FIELDS } from "../constants/fields";
import { BROWSER_EVENTS } from "../constants/browser";
import { TOAST_VARIANTS } from "../constants/ui";
import { REGEX_PATTERNS, STORAGE_EVENTS, STRING_PREFIXES } from "../constants/patterns";
import { createFallbackUuid } from "../constants/ids";
import { clearScheduledInterval, clearScheduledTimeout, scheduleInterval, scheduleTimeout } from "../utils/timing";

const ACTIVE_TAB_LOCK_KEY = runtimeConfig.storageKeys.activeTabLock;
const ACTIVE_TAB_LOCK_SCHEMA_VERSION = runtimeConfig.activeTabLockSchemaVersion;
const ACTIVE_TAB_HEARTBEAT_MS = runtimeConfig.activeTabHeartbeatMs;
const ACTIVE_TAB_STALE_MS = runtimeConfig.activeTabStaleMs;
const MIN_SURVEYS_BEFORE_FINISH = 1;
const CORE_STATE_STORAGE_AREA = "local";
const CORE_STATE_STORAGE_AREA_SESSION = "session";
const CLOSE_CLEAR_KEY = runtimeConfig.storageKeys.clearOnClose;
const SESSION_ALIVE_KEY = runtimeConfig.storageKeys.sessionAlive;
const CORE_STATE_SCHEMA_VERSION = runtimeConfig.uiStateSchemaVersion;
const CORE_STATE_TTL_MS = runtimeConfig.uiStateTtlMs;
const PII_STATE_TTL_MS = runtimeConfig.piiStateTtlMs;
const CORE_SCOPE_ANON = "anon";
const CORE_SCOPED_KEYS = [
  runtimeConfig.storageKeys.stage,
  runtimeConfig.storageKeys.paymentSubStage,
  runtimeConfig.storageKeys.sessionId,
  runtimeConfig.storageKeys.consentGiven,
  runtimeConfig.storageKeys.userDetailsSubmitted,
  runtimeConfig.storageKeys.emailVerified,
  runtimeConfig.storageKeys.paymentVerified,
  runtimeConfig.storageKeys.demographics,
  runtimeConfig.storageKeys.survey,
  runtimeConfig.storageKeys.surveyCompleted,
  runtimeConfig.storageKeys.surveyFeedbackReady,
  runtimeConfig.storageKeys.lastSubmissionSucceeded,
  runtimeConfig.storageKeys.shownImages,
];

const STORAGE_PREFIX_KEYS = [
  runtimeConfig.storageKeys.surveyDraftPrefix,
  runtimeConfig.storageKeys.surveyDraftActivePrefix,
];

const clearAppStorage = (scopes = []) => {
  const scopeIds = scopes.filter(Boolean);
  const allKeys = Object.values(runtimeConfig.storageKeys);
  ALL_STORAGE_AREAS.forEach((area) => {
    const storage = area === CORE_STATE_STORAGE_AREA ? localStorage : sessionStorage;
    allKeys.forEach((key) => {
      removeStoredKey(key, area);
      scopeIds.forEach((scope) => removeStoredKey(makeScopedKey(key, scope), area));
    });
    for (let i = storage.length - 1; i >= 0; i -= 1) {
      const k = storage.key(i);
      if (!k) continue;
      if (STORAGE_PREFIX_KEYS.some((prefix) => k.startsWith(prefix))) {
        storage.removeItem(k);
      }
    }
  });
};

function getScopeId(publicId) {
  const value = String(publicId || "").trim();
  return value || CORE_SCOPE_ANON;
}

function readCoreValue(baseKey, fallback, scopeId, { ttlMs } = {}) {
  const scopedKey = makeScopedKey(baseKey, getScopeId(scopeId));
  const options = { schemaVersion: CORE_STATE_SCHEMA_VERSION, ttlMs: ttlMs ?? CORE_STATE_TTL_MS };
  const localScoped = readExpiringValue(scopedKey, undefined, { area: CORE_STATE_STORAGE_AREA, ...options });
  if (localScoped !== undefined) return localScoped;
  const sessionScoped = readExpiringValue(scopedKey, undefined, { area: CORE_STATE_STORAGE_AREA_SESSION, ...options });
  if (sessionScoped !== undefined) return sessionScoped;
  const localUnscoped = readExpiringValue(baseKey, undefined, { area: CORE_STATE_STORAGE_AREA, ...options });
  if (localUnscoped !== undefined) return localUnscoped;
  const sessionUnscoped = readExpiringValue(baseKey, undefined, { area: CORE_STATE_STORAGE_AREA_SESSION, ...options });
  if (sessionUnscoped !== undefined) return sessionUnscoped;
  return fallback;
}

function writeCoreValue(baseKey, value, scopeId, { ttlMs } = {}) {
  const scopedKey = makeScopedKey(baseKey, getScopeId(scopeId));
  writeExpiringValue(scopedKey, value, {
    area: CORE_STATE_STORAGE_AREA,
    schemaVersion: CORE_STATE_SCHEMA_VERSION,
    ttlMs: ttlMs ?? CORE_STATE_TTL_MS,
  });
}

function createId() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return createFallbackUuid();
}

function normalizePhoneForApi(rawPhone) {
  const digits = String(rawPhone ?? "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith(STRING_PREFIXES.countryCode91)) return digits.slice(2);
  return digits;
}

const validateStageTransition = (currentStage, targetStage, paymentVerified = false) => {
  const currentIndex = APP_STAGE_ORDER.indexOf(currentStage);
  const targetIndex = APP_STAGE_ORDER.indexOf(targetStage);
  if (targetIndex <= currentIndex) return true;
  switch (currentStage) {
    case APP_FLOW.stages.consent:
      return targetStage === APP_FLOW.stages.userDetails;
    case APP_FLOW.stages.userDetails:
      return targetStage === APP_FLOW.stages.payment;
    case APP_FLOW.stages.payment:
      return targetStage === APP_FLOW.stages.survey && paymentVerified;
    case APP_FLOW.stages.survey:
      return targetStage === APP_FLOW.stages.finished;
    default:
      return false;
  }
};

const isDemographicsComplete = (demographics) => {
  const username = String(demographics?.username || "").trim();
  const email = String(demographics?.email || "").trim().toLowerCase();
  const phoneDigits = String(demographics?.phone || "").replace(/\D/g, "");
  const gender = String(demographics?.gender_code || "").trim();
  const ageRaw = String(demographics?.age || "").trim();
  const location = String(demographics?.location || "").trim();
  const language = String(demographics?.language_code || "").trim();
  const prior = String(demographics?.prior_experience || "").trim();
  const usernameOk = username.length >= runtimeConfig.usernameMinLength;
  const emailOk = REGEX_PATTERNS.email.test(email);
  const phoneOk = REGEX_PATTERNS.indianPhone.test(phoneDigits) || (
    phoneDigits.length === 12 &&
    phoneDigits.startsWith(STRING_PREFIXES.countryCode91) &&
    REGEX_PATTERNS.indianPhone.test(phoneDigits.slice(2))
  );
  const ageNum = Number(ageRaw);
  const ageOk = Number.isFinite(ageNum) && ageNum >= runtimeConfig.ageMin && ageNum <= runtimeConfig.ageMax;
  const locationOk = location.length >= runtimeConfig.locationMinLength;
  return usernameOk && emailOk && phoneOk && gender && ageOk && locationOk && language && prior;
};

const hasAnyDemographicsValue = (demographics) => {
  if (!demographics) return false;
  const fields = [
    demographics.username,
    demographics.email,
    demographics.phone,
    demographics.gender_code,
    demographics.age,
    demographics.location,
    demographics.language_code,
    demographics.prior_experience,
  ];
  return fields.some((value) => String(value || "").trim().length > 0);
};

const deriveMaxAllowedStage = ({
  currentStage,
  consentGiven,
  hasParticipant,
  userDetailsSubmitted,
  demographicsComplete,
  emailVerified,
  paymentVerified,
  surveyCompleted,
  surveyFeedbackReady,
  lastSubmissionSucceeded,
}) => {
  if (!consentGiven) return APP_FLOW.stages.consent;
  if (!hasParticipant || !userDetailsSubmitted || !demographicsComplete) return APP_FLOW.stages.userDetails;
  if (!emailVerified) return APP_FLOW.stages.userDetails;
  if (!paymentVerified) return APP_FLOW.stages.payment;
  if (surveyFeedbackReady && !lastSubmissionSucceeded) return APP_FLOW.stages.survey;
  if (surveyCompleted < MIN_SURVEYS_BEFORE_FINISH) return APP_FLOW.stages.survey;
  // Do not auto-advance to Finished; allow unlimited survey submissions.
  // Only permit Finished when the user explicitly navigates there (e.g. via SurveyFeedPage "Finish").
  if (currentStage === APP_FLOW.stages.finished) return APP_FLOW.stages.finished;
  return APP_FLOW.stages.survey;
};

export function useAppController() {
  const manualStageRef = useRef(null);
  const tabIdRef = useRef(createId());
  const demographicsSaveTimeoutRef = useRef(null);
  const isOnline = useOnlineStatus();
  const [isActiveTabOwner, setIsActiveTabOwner] = useState(true);
  const [publicId, setPublicId] = useState(() => (
    getStoredValue(runtimeConfig.storageKeys.publicId, "", { area: CORE_STATE_STORAGE_AREA }) ||
    getStoredValue(runtimeConfig.storageKeys.publicId, "", { area: CORE_STATE_STORAGE_AREA_SESSION }) ||
    ""
  ));
  const scopeId = getScopeId(publicId);
  const [sessionId, setSessionId] = useState(() => readCoreValue(runtimeConfig.storageKeys.sessionId, "", scopeId));
  const [stage, setStage] = useState(() => readCoreValue(runtimeConfig.storageKeys.stage, APP_FLOW.stages.consent, scopeId));
  const [paymentSubStage, setPaymentSubStage] = useState(() => readCoreValue(runtimeConfig.storageKeys.paymentSubStage, APP_FLOW.paymentSubStages.content, scopeId));
  const [consentGiven, setConsentGiven] = useState(() => readCoreValue(runtimeConfig.storageKeys.consentGiven, false, scopeId));
  const [userDetailsSubmitted, setUserDetailsSubmitted] = useState(() => readCoreValue(runtimeConfig.storageKeys.userDetailsSubmitted, false, scopeId));
  const [emailVerified, setEmailVerified] = useState(() => readCoreValue(runtimeConfig.storageKeys.emailVerified, false, scopeId));
  const [paymentVerified, setPaymentVerified] = useState(() => readCoreValue(runtimeConfig.storageKeys.paymentVerified, false, scopeId));
  const [sessionHydrated, setSessionHydrated] = useState(false);
  const [demographics, setDemographics] = useState(
    readCoreValue(runtimeConfig.storageKeys.demographics, {
      username: "",
      email: "",
      phone: "",
      gender_code: "",
      age: "",
      location: "",
      language_code: "",
      prior_experience: "",
    }, scopeId, { ttlMs: PII_STATE_TTL_MS })
  );
  const [toasts, setToasts] = useState([]);
  const [surveyTransitionInFlight, setSurveyTransitionInFlight] = useState(false);
  const toastRef = useRef(new Map());
  const participantStatusAbortRef = useRef(null);
  const submitFlowAbortRef = useRef(null);
  const clearUserStorage = useCallback((scopeOverride = null) => {
    let darkMode = null;
    darkMode = readExpiringValue(runtimeConfig.storageKeys.darkMode, null, {
      area: "local",
      schemaVersion: runtimeConfig.uiStateSchemaVersion,
      ttlMs: runtimeConfig.uiStateTtlMs,
    });
    if (typeof darkMode !== "boolean") {
      darkMode = readExpiringValue(runtimeConfig.storageKeys.darkMode, null, {
        area: "session",
        schemaVersion: runtimeConfig.uiStateSchemaVersion,
        ttlMs: runtimeConfig.uiStateTtlMs,
      });
    }

    const scope = String(scopeOverride || publicId || "").trim() || CORE_SCOPE_ANON;
    const keysToClear = [
      runtimeConfig.storageKeys.publicId,
      runtimeConfig.storageKeys.stage,
      runtimeConfig.storageKeys.paymentSubStage,
      runtimeConfig.storageKeys.consentGiven,
      runtimeConfig.storageKeys.userDetailsSubmitted,
      runtimeConfig.storageKeys.emailVerified,
      runtimeConfig.storageKeys.paymentVerified,
      runtimeConfig.storageKeys.demographics,
      runtimeConfig.storageKeys.survey,
      runtimeConfig.storageKeys.surveyCompleted,
      runtimeConfig.storageKeys.surveyFeedbackReady,
      runtimeConfig.storageKeys.lastSubmissionSucceeded,
      runtimeConfig.storageKeys.shownImages,
      runtimeConfig.storageKeys.sessionId,
      runtimeConfig.storageKeys.emailOtpState,
      runtimeConfig.storageKeys.paymentId,
      runtimeConfig.storageKeys.paymentTimerExpires,
      runtimeConfig.storageKeys.paymentState,
      runtimeConfig.storageKeys.paymentPendingCreate,
      runtimeConfig.storageKeys.paymentPendingVerify,
      runtimeConfig.storageKeys.consentDraft,
      runtimeConfig.storageKeys.consentPending,
      runtimeConfig.storageKeys.userDetailsPending,
      runtimeConfig.storageKeys.surveyPendingSubmit,
      runtimeConfig.storageKeys.surveyFeedPendingContinue,
      runtimeConfig.storageKeys.surveyFeedPendingFinish,
    ];
    keysToClear.forEach((key) => {
      forEachStorageArea((area) => {
        removeStoredKey(key, area);
        removeStoredKey(makeScopedKey(key, scope), area);
        removeStoredKey(makeScopedKey(key, CORE_SCOPE_ANON), area);
      });
    });

    if (typeof darkMode === "boolean") {
      writeExpiringValue(runtimeConfig.storageKeys.darkMode, darkMode, {
        area: "local",
        schemaVersion: runtimeConfig.uiStateSchemaVersion,
        ttlMs: runtimeConfig.uiStateTtlMs,
      });
    }
  }, [publicId]);

  useEffect(() => {
    if (stage === "email-verify") {
      setStage(APP_FLOW.stages.userDetails);
    }
  }, [stage, setStage]);

  useEffect(() => {
    let sameTab = false;
    try {
      sameTab = sessionStorage.getItem(SESSION_ALIVE_KEY) === "1";
      sessionStorage.setItem(SESSION_ALIVE_KEY, "1");
    } catch {
      sameTab = true;
    }

    if (!sameTab) {
      const shouldClear = localStorage.getItem(CLOSE_CLEAR_KEY) === "1";
      if (shouldClear) {
        clearAppStorage([CORE_SCOPE_ANON]);
      }
    }

    try {
      localStorage.removeItem(CLOSE_CLEAR_KEY);
    } catch {
      // Ignore storage failures.
    }
  }, []);

  const claimActiveTabLock = useCallback(() => {
    const now = Date.now();
    const tabId = tabIdRef.current;
    try {
      const parsed = readJsonValue(ACTIVE_TAB_LOCK_KEY, null, "local");
      if (!parsed) {
        writeJsonValue(ACTIVE_TAB_LOCK_KEY, {
          __schema_version: ACTIVE_TAB_LOCK_SCHEMA_VERSION,
          [ACTIVE_TAB_LOCK_FIELDS.tabId]: tabId,
          [ACTIVE_TAB_LOCK_FIELDS.updatedAt]: now,
        }, "local");
        setIsActiveTabOwner(true);
        return true;
      }

      const currentOwner = parsed?.[ACTIVE_TAB_LOCK_FIELDS.tabId];
      const updatedAt = Number(parsed?.[ACTIVE_TAB_LOCK_FIELDS.updatedAt] || 0);
      const stale = !updatedAt || now - updatedAt > ACTIVE_TAB_STALE_MS;

      if (currentOwner === tabId || stale) {
        writeJsonValue(ACTIVE_TAB_LOCK_KEY, {
          __schema_version: ACTIVE_TAB_LOCK_SCHEMA_VERSION,
          [ACTIVE_TAB_LOCK_FIELDS.tabId]: tabId,
          [ACTIVE_TAB_LOCK_FIELDS.updatedAt]: now,
        }, "local");
        setIsActiveTabOwner(true);
        return true;
      }

      setIsActiveTabOwner(false);
      return false;
    } catch {
      setIsActiveTabOwner(true);
      return true;
    }
  }, []);

  useEffect(() => {
    claimActiveTabLock();
    const heartbeat = scheduleInterval(() => {
      claimActiveTabLock();
    }, ACTIVE_TAB_HEARTBEAT_MS);
    const onStorage = (event) => {
      if (event.key === ACTIVE_TAB_LOCK_KEY) {
        claimActiveTabLock();
      }
    };
    const releaseLockIfOwner = () => {
      try {
        const parsed = readJsonValue(ACTIVE_TAB_LOCK_KEY, null, "local");
        if (parsed?.[ACTIVE_TAB_LOCK_FIELDS.tabId] === tabIdRef.current) {
          removeStoredKey(ACTIVE_TAB_LOCK_KEY, "local");
        }
      } catch {
        // Ignore lock release failures.
      }
    };
    window.addEventListener(STORAGE_EVENTS.storage, onStorage);
    window.addEventListener(BROWSER_EVENTS.beforeUnload, releaseLockIfOwner);
    return () => {
      clearScheduledInterval(heartbeat);
      window.removeEventListener(STORAGE_EVENTS.storage, onStorage);
      window.removeEventListener(BROWSER_EVENTS.beforeUnload, releaseLockIfOwner);
      releaseLockIfOwner();
    };
  }, [claimActiveTabLock]);

  const addToast = useCallback((message, type = TOAST_VARIANTS.info, action) => {
    const dedupeKey = `${type}:${message}`;
    const now = Date.now();
    const lastShownAt = toastRef.current.get(dedupeKey) || 0;
    if (now - lastShownAt < runtimeConfig.toastDedupeWindowMs) {
      return;
    }
    toastRef.current.set(dedupeKey, now);
    const id = createId();
    setToasts((prev) => [...prev, { id, message, type, action }]);
    scheduleTimeout(
      () => setToasts((prev) => prev.filter((toast) => toast.id !== id)),
      runtimeConfig.toastAutoDismissMs
    );
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const surveyFlow = useSurveyFlow({
    publicId,
    addToast,
    initial: {
      survey: readCoreValue(runtimeConfig.storageKeys.survey, null, scopeId),
      surveyCompleted: readCoreValue(runtimeConfig.storageKeys.surveyCompleted, 0, scopeId),
      surveyFeedbackReady: readCoreValue(runtimeConfig.storageKeys.surveyFeedbackReady, false, scopeId),
      lastSubmissionSucceeded: readCoreValue(runtimeConfig.storageKeys.lastSubmissionSucceeded, false, scopeId),
      shownImages: readCoreValue(runtimeConfig.storageKeys.shownImages, [], scopeId),
    },
  });

  const {
    survey,
    surveyCompleted,
    surveyFeedbackReady,
    setSurveyFeedbackReady,
    lastSubmissionSucceeded,
    shownImages,
    imageError,
    isFetchingImage,
    showConfetti,
    fetchImage,
    handleSubmit,
    cancelInFlightRequests,
  } = surveyFlow;

  const systemHealth = useSystemHealth({
    publicId,
    stage,
    paymentVerified,
    isActiveTabOwner,
    pauseSurveyPaymentGuard: surveyTransitionInFlight,
    setPaymentVerified,
    setStage,
    setPaymentSubStage,
    addToast,
  });

  const { systemReady, systemError, systemChecking, online, lastSyncAt, retryHealthCheck } = systemHealth;

  const transitionToSurvey = useCallback(async () => {
    setSurveyTransitionInFlight(true);
    setPaymentVerified(true);
    setPaymentSubStage(APP_FLOW.paymentSubStages.content);
    try {
      const image = await fetchImage({ clearCurrent: true, throwOnError: true });
      if (!image?.image_id) {
        setPaymentVerified(false);
        return false;
      }
      if (validateStageTransition(APP_FLOW.stages.payment, APP_FLOW.stages.survey, true)) {
        setStage(APP_FLOW.stages.survey);
      }
      return true;
    } catch {
      setPaymentVerified(false);
      return false;
    } finally {
      setSurveyTransitionInFlight(false);
    }
  }, [fetchImage]);

  const setStageManual = useCallback((nextStage) => {
    manualStageRef.current = nextStage;
    setStage(nextStage);
  }, [setStage]);

  const paymentFlow = usePaymentFlow({
    publicId,
    stage,
    setStage,
    setPaymentSubStage,
    setPaymentVerified,
    addToast,
    transitionToSurvey,
  });

  const { handlePaymentComplete, handlePaymentContentToLink } = paymentFlow;

  useEffect(() => {
    let cancelled = false;
    const hydrateFromCookies = async () => {
      if (publicId) {
        if (!cancelled) setSessionHydrated(true);
        return;
      }
      try {
        const session = await endpoints.getParticipantSession();
        if (cancelled) return;
        if (session?.public_id) setPublicId(session.public_id);
        if (session?.session_id) setSessionId(session.session_id);
      } catch {
        // Ignore; user can still continue fresh.
      } finally {
        if (!cancelled) setSessionHydrated(true);
      }
    };
    hydrateFromCookies();
    return () => {
      cancelled = true;
    };
  }, [publicId]);

  // Migration on boot: move previous sessionStorage / unscoped values into localStorage scoped-by-participant keys.
  useEffect(() => {
    CORE_SCOPED_KEYS.forEach((baseKey) => {
      const ttlMs = baseKey === runtimeConfig.storageKeys.demographics ? PII_STATE_TTL_MS : CORE_STATE_TTL_MS;
      const targetKey = makeScopedKey(baseKey, scopeId);

      const localScoped = readExpiringValue(targetKey, undefined, { area: CORE_STATE_STORAGE_AREA, schemaVersion: CORE_STATE_SCHEMA_VERSION, ttlMs });
      if (localScoped !== undefined) {
        // Clear any legacy/unscoped copies so reads are deterministic.
        removeStoredKey(targetKey, CORE_STATE_STORAGE_AREA_SESSION);
        removeStoredKey(baseKey, CORE_STATE_STORAGE_AREA);
        removeStoredKey(baseKey, CORE_STATE_STORAGE_AREA_SESSION);
        return;
      }

      const sessionScoped = readExpiringValue(targetKey, undefined, { area: CORE_STATE_STORAGE_AREA_SESSION, schemaVersion: CORE_STATE_SCHEMA_VERSION, ttlMs });
      if (sessionScoped !== undefined) {
        writeExpiringValue(targetKey, sessionScoped, { area: CORE_STATE_STORAGE_AREA, schemaVersion: CORE_STATE_SCHEMA_VERSION, ttlMs });
        removeStoredKey(targetKey, CORE_STATE_STORAGE_AREA_SESSION);
        removeStoredKey(baseKey, CORE_STATE_STORAGE_AREA);
        removeStoredKey(baseKey, CORE_STATE_STORAGE_AREA_SESSION);
        return;
      }

      const localUnscoped = readExpiringValue(baseKey, undefined, { area: CORE_STATE_STORAGE_AREA, schemaVersion: CORE_STATE_SCHEMA_VERSION, ttlMs });
      if (localUnscoped !== undefined) {
        writeExpiringValue(targetKey, localUnscoped, { area: CORE_STATE_STORAGE_AREA, schemaVersion: CORE_STATE_SCHEMA_VERSION, ttlMs });
        removeStoredKey(baseKey, CORE_STATE_STORAGE_AREA);
        removeStoredKey(baseKey, CORE_STATE_STORAGE_AREA_SESSION);
        return;
      }

      const sessionUnscoped = readExpiringValue(baseKey, undefined, { area: CORE_STATE_STORAGE_AREA_SESSION, schemaVersion: CORE_STATE_SCHEMA_VERSION, ttlMs });
      if (sessionUnscoped !== undefined) {
        writeExpiringValue(targetKey, sessionUnscoped, { area: CORE_STATE_STORAGE_AREA, schemaVersion: CORE_STATE_SCHEMA_VERSION, ttlMs });
        removeStoredKey(baseKey, CORE_STATE_STORAGE_AREA_SESSION);
      }
    });
  }, [scopeId]);

  // Persist the current participant id (unscoped) as a fallback when cookies aren't available.
  useEffect(() => saveStoredValue(runtimeConfig.storageKeys.publicId, publicId, { area: CORE_STATE_STORAGE_AREA }), [publicId]);

  // Persist scoped workflow state in localStorage.
  useEffect(() => writeCoreValue(runtimeConfig.storageKeys.stage, stage, scopeId), [scopeId, stage]);
  useEffect(() => writeCoreValue(runtimeConfig.storageKeys.paymentSubStage, paymentSubStage, scopeId), [paymentSubStage, scopeId]);
  useEffect(() => writeCoreValue(runtimeConfig.storageKeys.sessionId, sessionId, scopeId), [scopeId, sessionId]);
  useEffect(() => writeCoreValue(runtimeConfig.storageKeys.consentGiven, consentGiven, scopeId), [consentGiven, scopeId]);
  useEffect(() => writeCoreValue(runtimeConfig.storageKeys.userDetailsSubmitted, userDetailsSubmitted, scopeId), [scopeId, userDetailsSubmitted]);
  useEffect(() => writeCoreValue(runtimeConfig.storageKeys.emailVerified, emailVerified, scopeId), [emailVerified, scopeId]);
  useEffect(() => writeCoreValue(runtimeConfig.storageKeys.paymentVerified, paymentVerified, scopeId), [paymentVerified, scopeId]);
  useEffect(() => {
    if (!isOnline) return;
    if (demographicsSaveTimeoutRef.current) {
      clearScheduledTimeout(demographicsSaveTimeoutRef.current);
    }
    demographicsSaveTimeoutRef.current = scheduleTimeout(() => {
      writeCoreValue(runtimeConfig.storageKeys.demographics, demographics, scopeId, { ttlMs: PII_STATE_TTL_MS });
    }, 700);
  }, [demographics, isOnline, scopeId]);
  useEffect(() => () => {
    if (demographicsSaveTimeoutRef.current) {
      clearScheduledTimeout(demographicsSaveTimeoutRef.current);
    }
  }, []);
  useEffect(() => writeCoreValue(runtimeConfig.storageKeys.survey, survey, scopeId), [scopeId, survey]);
  useEffect(() => writeCoreValue(runtimeConfig.storageKeys.surveyCompleted, surveyCompleted, scopeId), [scopeId, surveyCompleted]);
  useEffect(() => writeCoreValue(runtimeConfig.storageKeys.surveyFeedbackReady, surveyFeedbackReady, scopeId), [scopeId, surveyFeedbackReady]);
  useEffect(() => writeCoreValue(runtimeConfig.storageKeys.lastSubmissionSucceeded, lastSubmissionSucceeded, scopeId), [lastSubmissionSucceeded, scopeId]);
  useEffect(() => writeCoreValue(runtimeConfig.storageKeys.shownImages, shownImages, scopeId), [scopeId, shownImages]);

  // When participant id becomes available, migrate anon-scoped state to this participant (first-time create flow).
  useEffect(() => {
    if (!publicId) return;
    const fromScope = CORE_SCOPE_ANON;
    const toScope = publicId;
    CORE_SCOPED_KEYS.forEach((baseKey) => {
      const ttlMs = baseKey === runtimeConfig.storageKeys.demographics ? PII_STATE_TTL_MS : CORE_STATE_TTL_MS;
      const fromKey = makeScopedKey(baseKey, fromScope);
      const toKey = makeScopedKey(baseKey, toScope);
      const already = readExpiringValue(toKey, undefined, { area: CORE_STATE_STORAGE_AREA, schemaVersion: CORE_STATE_SCHEMA_VERSION, ttlMs });
      if (already !== undefined) return;
      const fromVal = readExpiringValue(fromKey, undefined, { area: CORE_STATE_STORAGE_AREA, schemaVersion: CORE_STATE_SCHEMA_VERSION, ttlMs });
      if (fromVal === undefined) return;
      writeExpiringValue(toKey, fromVal, { area: CORE_STATE_STORAGE_AREA, schemaVersion: CORE_STATE_SCHEMA_VERSION, ttlMs });
      removeStoredKey(fromKey, CORE_STATE_STORAGE_AREA);
    });

    const readScoped = (baseKey, fallback, ttlMs) => {
      const scopedKey = makeScopedKey(baseKey, publicId);
      const stored = readExpiringValue(scopedKey, undefined, { area: CORE_STATE_STORAGE_AREA, schemaVersion: CORE_STATE_SCHEMA_VERSION, ttlMs });
      return stored === undefined ? { hasValue: false, value: fallback } : { hasValue: true, value: stored };
    };

    // Rehydrate current in-memory state from the participant scope after migration.
    const sessionStored = readScoped(runtimeConfig.storageKeys.sessionId, "", CORE_STATE_TTL_MS);
    setSessionId((prev) => (sessionStored.hasValue ? sessionStored.value : prev));
    const stageStored = readScoped(runtimeConfig.storageKeys.stage, APP_FLOW.stages.consent, CORE_STATE_TTL_MS);
    setStage((prev) => (stageStored.hasValue ? stageStored.value : prev));
    const paymentSubStageStored = readScoped(runtimeConfig.storageKeys.paymentSubStage, APP_FLOW.paymentSubStages.content, CORE_STATE_TTL_MS);
    setPaymentSubStage((prev) => (paymentSubStageStored.hasValue ? paymentSubStageStored.value : prev));
    const consentStored = readScoped(runtimeConfig.storageKeys.consentGiven, false, CORE_STATE_TTL_MS);
    setConsentGiven((prev) => (consentStored.hasValue ? consentStored.value : prev));
    const userDetailsStored = readScoped(runtimeConfig.storageKeys.userDetailsSubmitted, false, CORE_STATE_TTL_MS);
    setUserDetailsSubmitted((prev) => (userDetailsStored.hasValue ? userDetailsStored.value : prev));
    const emailStored = readScoped(runtimeConfig.storageKeys.emailVerified, false, CORE_STATE_TTL_MS);
    setEmailVerified((prev) => (emailStored.hasValue ? emailStored.value : prev));
    const paymentStored = readScoped(runtimeConfig.storageKeys.paymentVerified, false, CORE_STATE_TTL_MS);
    setPaymentVerified((prev) => (paymentStored.hasValue ? paymentStored.value : prev));
    const storedDemographics = readCoreValue(runtimeConfig.storageKeys.demographics, {
      username: "",
      email: "",
      phone: "",
      gender_code: "",
      age: "",
      location: "",
      language_code: "",
      prior_experience: "",
    }, publicId, { ttlMs: PII_STATE_TTL_MS });
    setDemographics((prev) => (hasAnyDemographicsValue(storedDemographics) ? storedDemographics : prev));
  }, [publicId]);

  useEffect(() => {
    if (!sessionHydrated) return;
    if (manualStageRef.current && stage === manualStageRef.current) {
      manualStageRef.current = null;
      return;
    }
    const maxAllowedStage = deriveMaxAllowedStage({
      currentStage: stage,
      consentGiven,
      hasParticipant: Boolean(publicId),
      userDetailsSubmitted,
      demographicsComplete: isDemographicsComplete(demographics),
      emailVerified,
      paymentVerified,
      surveyCompleted,
      surveyFeedbackReady,
      lastSubmissionSucceeded,
    });
    const currentIndex = APP_STAGE_ORDER.indexOf(stage);
    const maxAllowedIndex = APP_STAGE_ORDER.indexOf(maxAllowedStage);
    if (maxAllowedIndex >= 0) {
      if (currentIndex > maxAllowedIndex) {
        setStage(maxAllowedStage);
        if (maxAllowedStage === APP_FLOW.stages.payment) {
          setPaymentSubStage(APP_FLOW.paymentSubStages.content);
        }
      } else if (currentIndex >= 0 && currentIndex < maxAllowedIndex) {
        // On refresh, stage can be missing/stale in storage even though prerequisite flags are present.
        // Fast-forward to the furthest valid stage without skipping gated transitions.
        let nextStage = stage;
        let nextIndex = currentIndex;
        while (nextIndex < maxAllowedIndex) {
          const candidate = APP_STAGE_ORDER[nextIndex + 1];
          if (!validateStageTransition(nextStage, candidate, paymentVerified)) break;
          nextStage = candidate;
          nextIndex += 1;
        }
        if (nextStage !== stage) {
          setStage(nextStage);
        }
      }
    }
    if (surveyFeedbackReady && !lastSubmissionSucceeded) {
      setSurveyFeedbackReady(false);
    }
  }, [
    consentGiven,
    demographics,
    lastSubmissionSucceeded,
    emailVerified,
    paymentVerified,
    publicId,
    sessionHydrated,
    stage,
    surveyCompleted,
    surveyFeedbackReady,
    setSurveyFeedbackReady,
    userDetailsSubmitted,
  ]);

  useEffect(() => {
    const handleExit = () => {
      try {
        localStorage.setItem(CLOSE_CLEAR_KEY, "1");
      } catch {
        // Ignore storage failures.
      }
    };
    window.addEventListener("beforeunload", handleExit);
    window.addEventListener("pagehide", handleExit);
    return () => {
      window.removeEventListener("beforeunload", handleExit);
      window.removeEventListener("pagehide", handleExit);
    };
  }, []);

  useEffect(() => {
    const verifyStagePrerequisites = async () => {
      if (!systemReady || !isActiveTabOwner) return;
      if (![APP_FLOW.stages.survey, APP_FLOW.stages.finished].includes(stage)) return;
      if (participantStatusAbortRef.current) {
        participantStatusAbortRef.current.abort();
      }
      const controller = new AbortController();
      participantStatusAbortRef.current = controller;
      try {
        const status = await endpoints.getParticipantPaymentStatus(publicId, { signal: controller.signal });
        const verified = status?.is_verified === true;
        setPaymentVerified(verified);
        if ((stage === APP_FLOW.stages.survey || stage === APP_FLOW.stages.finished) && !verified) {
          setStage(APP_FLOW.stages.payment);
          setPaymentSubStage(APP_FLOW.paymentSubStages.content);
          addToast(getErrorMessage("PAY_001_0005"), "warning");
        }
      } catch (error) {
        if (error?.code === "REQ_ABORTED" || controller.signal.aborted) return;
        setStage(APP_FLOW.stages.userDetails);
        setPaymentSubStage(APP_FLOW.paymentSubStages.content);
        setPaymentVerified(false);
        if (error?.status === 404 || error?.code === "NF_001_0001") {
          addToast(getErrorMessage("NF_001_0001"), "warning");
        }
      } finally {
        if (participantStatusAbortRef.current === controller) {
          participantStatusAbortRef.current = null;
        }
      }
    };
    verifyStagePrerequisites();
    return () => {
      if (participantStatusAbortRef.current) {
        participantStatusAbortRef.current.abort();
        participantStatusAbortRef.current = null;
      }
    };
  }, [addToast, emailVerified, isActiveTabOwner, publicId, stage, systemReady, userDetailsSubmitted]);

  useEffect(() => () => {
    cancelInFlightRequests?.();
    if (participantStatusAbortRef.current) participantStatusAbortRef.current.abort();
    if (submitFlowAbortRef.current) submitFlowAbortRef.current.abort();
  }, [cancelInFlightRequests]);

  useEffect(() => {
    if (stage !== APP_FLOW.stages.survey || !systemReady || !paymentVerified || surveyFeedbackReady) return;
    const restoredImageUrl = survey?.url || survey?.image_url || survey?.imageUrl || "";
    if (!survey || !survey.image_id || !String(restoredImageUrl).trim()) {
      fetchImage({ clearCurrent: false });
    }
  }, [fetchImage, paymentVerified, stage, survey, surveyFeedbackReady, systemReady]);

  const createParticipant = useCallback(async () => {
    if (submitFlowAbortRef.current) {
      submitFlowAbortRef.current.abort();
    }
    const controller = new AbortController();
    submitFlowAbortRef.current = controller;
    try {
      const participant = await endpoints.createParticipant({
        username: demographics.username,
        email: demographics.email,
        phone: normalizePhoneForApi(demographics.phone),
        gender_code: demographics.gender_code,
        age: parseInt(demographics.age),
        location: demographics.location,
        language_code: demographics.language_code,
        prior_experience: demographics.prior_experience,
      }, { signal: controller.signal });
      if (participant?.public_id) setPublicId(participant.public_id);
      if (participant?.session_id) setSessionId(participant.session_id);
      setUserDetailsSubmitted(true);
      return participant;
    } catch (error) {
      if (error?.code === "REQ_ABORTED" || controller.signal.aborted) throw error;
      throw new Error(error.message || getErrorMessage("SYS_002_0022"));
    } finally {
      if (submitFlowAbortRef.current === controller) {
        submitFlowAbortRef.current = null;
      }
    }
  }, [demographics]);

  const recordConsent = useCallback(async (publicIdOverride = null) => {
    if (submitFlowAbortRef.current) {
      submitFlowAbortRef.current.abort();
    }
    const controller = new AbortController();
    submitFlowAbortRef.current = controller;
    try {
      const consentPublicId = publicIdOverride || publicId;
      return await endpoints.recordConsent(consentPublicId, { signal: controller.signal });
    } catch (error) {
      if (error?.code === "REQ_ABORTED" || controller.signal.aborted) throw error;
      throw new Error(error.message || getErrorMessage("SYS_002_0002"));
    } finally {
      if (submitFlowAbortRef.current === controller) {
        submitFlowAbortRef.current = null;
      }
    }
  }, [publicId]);

  const handleUserDetailsSubmit = useCallback(async () => {
    try {
      const participant = await createParticipant();
      const consentPublicId = participant?.public_id || publicId;
      if (consentGiven) await recordConsent(consentPublicId);
      setEmailVerified(false);
      addToast(uiText("user.detailsSaved"), "success");
      return participant;
    } catch (err) {
      addToast(err.message, "error");
      throw err;
    }
  }, [addToast, consentGiven, createParticipant, publicId, recordConsent, setEmailVerified]);

  const handleConsentGiven = useCallback(async () => {
    setConsentGiven(true);
    if (validateStageTransition(APP_FLOW.stages.consent, APP_FLOW.stages.userDetails)) setStage(APP_FLOW.stages.userDetails);
    addToast(uiText("consent.saved"), "success");
  }, [addToast]);

  const handleUserDetailsBack = useCallback(() => setStageManual(APP_FLOW.stages.consent), [setStageManual]);
  const handleEmailVerified = useCallback(() => {
    setEmailVerified(true);
    if (validateStageTransition(APP_FLOW.stages.userDetails, APP_FLOW.stages.payment)) {
      setStage(APP_FLOW.stages.payment);
    }
  }, [setEmailVerified, setStage]);
  const handleAppError = useCallback(() => addToast(getErrorMessage("SYS_002_0017"), "error"), [addToast]);

  return {
    isOnline,
    isActiveTabOwner,
    stage,
    paymentSubStage,
    publicId,
    sessionId,
    demographics,
    setDemographics,
    setStage,
    emailVerified,
    toasts,
    addToast,
    systemReady,
    systemError,
    systemChecking,
    online,
    lastSyncAt,
    retryHealthCheck,
    survey,
    surveyCompleted,
    surveyFeedbackReady,
    setSurveyFeedbackReady,
    imageError,
    isFetchingImage,
    showConfetti,
    fetchImage,
    handleSubmit,
    claimActiveTabLock,
    dismissToast,
    handleConsentGiven,
    handleUserDetailsSubmit,
    handleUserDetailsBack,
    handleEmailVerified,
    handlePaymentComplete,
    handlePaymentContentToLink,
    handleAppError,
    clearUserStorage,
  };
}
