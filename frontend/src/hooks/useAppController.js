import { useCallback, useEffect, useRef, useState } from "react";
import { endpoints } from "../utils/api.js";
import { getErrorMessage } from "../utils/errorRegistry.js";
import { useOnlineStatus } from "./useOnlineStatus";
import { useSystemHealth } from "./useSystemHealth";
import { usePaymentFlow } from "./usePaymentFlow";
import { useSurveyFlow } from "./useSurveyFlow";
import { runtimeConfig } from "../config/runtime";
import { uiText } from "../utils/uiText";
import { getStoredValue, readJsonValue, removeStoredKey, saveStoredValue, writeJsonValue } from "../utils/storage";
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
const MIN_SURVEYS_BEFORE_FINISH = Math.max(1, runtimeConfig.surveyUiTotalSteps || 1);

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

const deriveMaxAllowedStage = ({
  consentGiven,
  hasParticipant,
  userDetailsSubmitted,
  demographicsComplete,
  paymentVerified,
  surveyCompleted,
  surveyFeedbackReady,
  lastSubmissionSucceeded,
}) => {
  if (!consentGiven) return APP_FLOW.stages.consent;
  if (!hasParticipant || !userDetailsSubmitted || !demographicsComplete) return APP_FLOW.stages.userDetails;
  if (!paymentVerified) return APP_FLOW.stages.payment;
  if (surveyFeedbackReady && !lastSubmissionSucceeded) return APP_FLOW.stages.survey;
  if (surveyCompleted < MIN_SURVEYS_BEFORE_FINISH) return APP_FLOW.stages.survey;
  if (!surveyFeedbackReady && !(surveyCompleted > 0)) return APP_FLOW.stages.survey;
  return APP_FLOW.stages.finished;
};

export function useAppController() {
  const manualStageRef = useRef(null);
  const tabIdRef = useRef(createId());
  const demographicsSaveTimeoutRef = useRef(null);
  const isOnline = useOnlineStatus();
  const [isActiveTabOwner, setIsActiveTabOwner] = useState(true);
  const [darkMode, setDarkMode] = useState(getStoredValue(runtimeConfig.storageKeys.darkMode, false));
  const [stage, setStage] = useState(getStoredValue(runtimeConfig.storageKeys.stage, APP_FLOW.stages.consent));
  const [paymentSubStage, setPaymentSubStage] = useState(getStoredValue(runtimeConfig.storageKeys.paymentSubStage, APP_FLOW.paymentSubStages.content));
  const [publicId, setPublicId] = useState(() => getStoredValue(runtimeConfig.storageKeys.publicId, ""));
  const [sessionId, setSessionId] = useState(() => getStoredValue(runtimeConfig.storageKeys.sessionId, ""));
  const [consentGiven, setConsentGiven] = useState(() => getStoredValue(runtimeConfig.storageKeys.consentGiven, false));
  const [userDetailsSubmitted, setUserDetailsSubmitted] = useState(() => getStoredValue(runtimeConfig.storageKeys.userDetailsSubmitted, false));
  const [paymentVerified, setPaymentVerified] = useState(() => getStoredValue(runtimeConfig.storageKeys.paymentVerified, false));
  const [sessionHydrated, setSessionHydrated] = useState(false);
  const [demographics, setDemographics] = useState(
    getStoredValue(runtimeConfig.storageKeys.demographics, {
      username: "",
      email: "",
      phone: "",
      gender_code: "",
      age: "",
      location: "",
      language_code: "",
      prior_experience: "",
    })
  );
  const [toasts, setToasts] = useState([]);
  const [surveyTransitionInFlight, setSurveyTransitionInFlight] = useState(false);
  const toastRef = useRef(new Map());
  const participantStatusAbortRef = useRef(null);
  const submitFlowAbortRef = useRef(null);

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

  useEffect(() => {
    removeStoredKey(runtimeConfig.storageKeys.sessionId);
    removeStoredKey(runtimeConfig.storageKeys.publicId);
  }, []);

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
      survey: getStoredValue(runtimeConfig.storageKeys.survey, null),
      surveyCompleted: getStoredValue(runtimeConfig.storageKeys.surveyCompleted, 0),
      surveyFeedbackReady: getStoredValue(runtimeConfig.storageKeys.surveyFeedbackReady, false),
      lastSubmissionSucceeded: getStoredValue(runtimeConfig.storageKeys.lastSubmissionSucceeded, false),
      shownImages: getStoredValue(runtimeConfig.storageKeys.shownImages, []),
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
    paymentSubStage,
    setStage,
    setStageManual,
    setPaymentSubStage,
    setPaymentVerified,
    addToast,
    transitionToSurvey,
  });

  const { handlePaymentComplete, handlePaymentContentToLink, handlePaymentBack } = paymentFlow;

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

  useEffect(() => saveStoredValue(runtimeConfig.storageKeys.consentGiven, consentGiven), [consentGiven]);
  useEffect(() => saveStoredValue(runtimeConfig.storageKeys.userDetailsSubmitted, userDetailsSubmitted), [userDetailsSubmitted]);
  useEffect(() => saveStoredValue(runtimeConfig.storageKeys.paymentVerified, paymentVerified), [paymentVerified]);
  useEffect(() => saveStoredValue(runtimeConfig.storageKeys.publicId, publicId), [publicId]);
  useEffect(() => saveStoredValue(runtimeConfig.storageKeys.sessionId, sessionId), [sessionId]);
  useEffect(() => {
    if (!isOnline) return;
    if (demographicsSaveTimeoutRef.current) {
      clearScheduledTimeout(demographicsSaveTimeoutRef.current);
    }
    demographicsSaveTimeoutRef.current = scheduleTimeout(() => {
      saveStoredValue(runtimeConfig.storageKeys.demographics, demographics);
    }, 700);
  }, [demographics, isOnline]);
  useEffect(() => () => {
    if (demographicsSaveTimeoutRef.current) {
      clearScheduledTimeout(demographicsSaveTimeoutRef.current);
    }
  }, []);
  useEffect(() => saveStoredValue(runtimeConfig.storageKeys.stage, stage), [stage]);
  useEffect(() => saveStoredValue(runtimeConfig.storageKeys.paymentSubStage, paymentSubStage), [paymentSubStage]);
  useEffect(() => saveStoredValue(runtimeConfig.storageKeys.survey, survey), [survey]);
  useEffect(() => saveStoredValue(runtimeConfig.storageKeys.surveyCompleted, surveyCompleted), [surveyCompleted]);
  useEffect(() => saveStoredValue(runtimeConfig.storageKeys.surveyFeedbackReady, surveyFeedbackReady), [surveyFeedbackReady]);
  useEffect(() => saveStoredValue(runtimeConfig.storageKeys.lastSubmissionSucceeded, lastSubmissionSucceeded), [lastSubmissionSucceeded]);
  useEffect(() => saveStoredValue(runtimeConfig.storageKeys.shownImages, shownImages), [shownImages]);
  useEffect(() => {
    saveStoredValue(runtimeConfig.storageKeys.darkMode, darkMode);
    document.body.classList.toggle("dark", darkMode);
  }, [darkMode]);

  useEffect(() => {
    if (!sessionHydrated) return;
    if (manualStageRef.current && stage === manualStageRef.current) {
      manualStageRef.current = null;
      return;
    }
    const maxAllowedStage = deriveMaxAllowedStage({
      consentGiven,
      hasParticipant: Boolean(publicId),
      userDetailsSubmitted,
      demographicsComplete: isDemographicsComplete(demographics),
      paymentVerified,
      surveyCompleted,
      surveyFeedbackReady,
      lastSubmissionSucceeded,
    });
    const currentIndex = APP_STAGE_ORDER.indexOf(stage);
    const maxAllowedIndex = APP_STAGE_ORDER.indexOf(maxAllowedStage);
    if (currentIndex > maxAllowedIndex && maxAllowedIndex >= 0) {
      setStage(maxAllowedStage);
      if (maxAllowedStage === APP_FLOW.stages.payment) {
        setPaymentSubStage(APP_FLOW.paymentSubStages.content);
      }
    }
    if (surveyFeedbackReady && !lastSubmissionSucceeded) {
      setSurveyFeedbackReady(false);
    }
  }, [
    consentGiven,
    demographics,
    lastSubmissionSucceeded,
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
  }, [addToast, isActiveTabOwner, publicId, stage, systemReady]);

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
      if (validateStageTransition(APP_FLOW.stages.userDetails, APP_FLOW.stages.payment)) setStage(APP_FLOW.stages.payment);
      addToast(uiText("user.detailsSaved"), "success");
    } catch (err) {
      addToast(err.message, "error");
      throw err;
    }
  }, [addToast, consentGiven, createParticipant, publicId, recordConsent]);

  const handleConsentGiven = useCallback(async () => {
    setConsentGiven(true);
    if (validateStageTransition(APP_FLOW.stages.consent, APP_FLOW.stages.userDetails)) setStage(APP_FLOW.stages.userDetails);
    addToast(uiText("consent.saved"), "success");
  }, [addToast]);

  const handleUserDetailsBack = useCallback(() => setStageManual(APP_FLOW.stages.consent), [setStageManual]);
  const toggleDarkMode = useCallback(() => setDarkMode((prev) => !prev), []);
  const handleAppError = useCallback(() => addToast(getErrorMessage("SYS_002_0017"), "error"), [addToast]);

  return {
    isOnline,
    isActiveTabOwner,
    darkMode,
    stage,
    paymentSubStage,
    publicId,
    sessionId,
    demographics,
    setDemographics,
    setStage,
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
    toggleDarkMode,
    handleConsentGiven,
    handleUserDetailsSubmit,
    handleUserDetailsBack,
    handlePaymentComplete,
    handlePaymentContentToLink,
    handlePaymentBack,
    handleAppError,
  };
}
