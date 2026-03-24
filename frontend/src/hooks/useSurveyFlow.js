import { useCallback, useEffect, useRef, useState } from "react";
import { endpoints } from "../utils/api";
import { getErrorMessage } from "../utils/errorRegistry";
import { getDisplayErrorMessage } from "../utils/appError";
import { runtimeConfig } from "../config/runtime";
import { uiText } from "../utils/uiText";
import { requirePublicId } from "../utils/publicId";
import { SURVEY_API_FIELDS } from "../constants/fields";
import { TOAST_VARIANTS } from "../constants/ui";
import { REQUEST_CODES } from "../constants/request";
import { scheduleTimeout } from "../utils/timing";
import { forEachStorageArea, makeScopedKey, removeStoredKey } from "../utils/storage";

const normalizeSurveyPayload = (value) => {
  if (!value || typeof value !== "object") return null;
  const imageId = value[SURVEY_API_FIELDS.imageId] || value.imageId || null;
  const imageUrl = value[SURVEY_API_FIELDS.url] || value[SURVEY_API_FIELDS.imageUrl] || value.imageUrl || "";
  return {
    ...value,
    [SURVEY_API_FIELDS.imageId]: imageId,
    [SURVEY_API_FIELDS.url]: imageUrl,
  };
};

export function useSurveyFlow({ publicId, addToast, initial }) {
  const [survey, setSurvey] = useState(normalizeSurveyPayload(initial?.survey));
  const [surveyCompleted, setSurveyCompleted] = useState(initial?.surveyCompleted || 0);
  const [surveyFeedbackReady, setSurveyFeedbackReady] = useState(initial?.surveyFeedbackReady || false);
  const [lastSubmissionSucceeded, setLastSubmissionSucceeded] = useState(
    initial?.lastSubmissionSucceeded || false
  );
  const [shownImages, setShownImages] = useState(initial?.shownImages || []);
  const [imageError, setImageError] = useState(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const [isFetchingImage, setIsFetchingImage] = useState(false);
  const inFlightRef = useRef(false);
  const imageAbortRef = useRef(null);
  const submitAbortRef = useRef(null);

  useEffect(() => {
    const restoredSurvey = normalizeSurveyPayload(initial?.survey);
    if (restoredSurvey?.[SURVEY_API_FIELDS.imageId]) {
      setImageError(null);
      setSurvey((prev) => {
        if (prev?.[SURVEY_API_FIELDS.imageId] === restoredSurvey[SURVEY_API_FIELDS.imageId]) {
          return prev;
        }
        if (prev?.[SURVEY_API_FIELDS.imageId] && prev?.[SURVEY_API_FIELDS.url]) {
          return prev;
        }
        return restoredSurvey;
      });
    }
    if (Number.isFinite(initial?.surveyCompleted)) {
      setSurveyCompleted((prev) => (prev > 0 ? prev : initial.surveyCompleted));
    }
    if (initial?.surveyFeedbackReady === true) {
      setSurveyFeedbackReady(true);
    }
    if (initial?.lastSubmissionSucceeded === true) {
      setLastSubmissionSucceeded(true);
    }
    if (Array.isArray(initial?.shownImages) && initial.shownImages.length > 0) {
      setShownImages((prev) => (prev.length > 0 ? prev : initial.shownImages));
    }
  }, [
    initial?.lastSubmissionSucceeded,
    initial?.shownImages,
    initial?.survey,
    initial?.surveyCompleted,
    initial?.surveyFeedbackReady,
    publicId,
  ]);

  const fetchImage = useCallback(async ({ clearCurrent = false, throwOnError = false } = {}) => {
    // Keep refresh/session-resumed survey stable: do not request a new image
    // unless caller explicitly asks to clear current survey.
    if (!clearCurrent && survey?.[SURVEY_API_FIELDS.imageId] && typeof survey?.[SURVEY_API_FIELDS.url] === "string" && survey[SURVEY_API_FIELDS.url].trim()) {
      return survey;
    }

    if (inFlightRef.current) {
      return null;
    }
    if (imageAbortRef.current) {
      imageAbortRef.current.abort();
    }
    const controller = new AbortController();
    imageAbortRef.current = controller;
    inFlightRef.current = true;
    setIsFetchingImage(true);
    setSurveyFeedbackReady(false);
    setLastSubmissionSucceeded(false);
    setImageError(null);
    if (clearCurrent) {
      setSurvey(null);
    }

    const effectivePublicId = requirePublicId(publicId, () => {
      // Refresh hydration can briefly lag behind the survey route boot.
      // Do not convert that transient state into a fatal image error.
    });
    if (!effectivePublicId) {
      setIsFetchingImage(false);
      inFlightRef.current = false;
      if (imageAbortRef.current === controller) {
        imageAbortRef.current = null;
      }
      return null;
    }

    try {
      const data = await endpoints.getRandomImage(shownImages, effectivePublicId, { signal: controller.signal });
      const normalizedData = normalizeSurveyPayload(data);
      if (!normalizedData?.[SURVEY_API_FIELDS.imageId]) {
        throw new Error(getErrorMessage("SYS_002_0016"));
      }
      setShownImages((prev) => [...prev, normalizedData[SURVEY_API_FIELDS.imageId]]);
      setSurvey(normalizedData);
      return normalizedData;
    } catch (error) {
      if (error?.code === "REQ_ABORTED" || controller.signal.aborted) {
        return null;
      }
      const errorMessage = getDisplayErrorMessage(error, "SYS_002_0016");
      addToast(errorMessage, "error");
      setImageError(errorMessage);
      setSurvey(null);
      if (throwOnError) {
        throw error;
      }
      return null;
    } finally {
      if (imageAbortRef.current === controller) {
        imageAbortRef.current = null;
      }
      inFlightRef.current = false;
      setIsFetchingImage(false);
    }
  }, [addToast, publicId, shownImages, survey]);

  const handleSubmit = useCallback(async (formData) => {
    const engagementData = formData.engagementData || {};
    const effectivePublicId = requirePublicId(publicId, () => {
      addToast(getErrorMessage("NF_001_0001"), "warning");
    });
    if (!effectivePublicId) throw new Error(getErrorMessage("NF_001_0001"));
    if (!publicId) {
      const errorMessage = getErrorMessage("NF_001_0001");
      addToast(errorMessage, TOAST_VARIANTS.warning);
      throw new Error(errorMessage);
    }
    if (submitAbortRef.current) {
      submitAbortRef.current.abort();
    }
    const controller = new AbortController();
    submitAbortRef.current = controller;

    try {
      const result = await endpoints.submitDescription({
        [SURVEY_API_FIELDS.publicId]: effectivePublicId,
        [SURVEY_API_FIELDS.imageId]: survey[SURVEY_API_FIELDS.imageId],
        description: formData.description,
        rating: formData.rating,
        feedback: formData.comments,
        [SURVEY_API_FIELDS.timeSpentSeconds]: formData.timeSpentSeconds,
        [SURVEY_API_FIELDS.isSurvey]: survey?.[SURVEY_API_FIELDS.isSurvey] === true,
        [SURVEY_API_FIELDS.isAttentionCheck]: survey?.[SURVEY_API_FIELDS.isAttentionCheck] === true,
        [SURVEY_API_FIELDS.surveyIndex]: surveyCompleted + 1,
        [SURVEY_API_FIELDS.tabSwitchCount]: engagementData.tabSwitchCount || 0,
        [SURVEY_API_FIELDS.pageCloseAttempts]: engagementData.pageCloseAttempts || 0,
        [SURVEY_API_FIELDS.networkDisconnects]: engagementData.networkDisconnects || 0,
      }, { signal: controller.signal });

      const attentionStatus = result[SURVEY_API_FIELDS.attentionStatus] || {};
      if (attentionStatus[SURVEY_API_FIELDS.isAttentionCheck] && result[SURVEY_API_FIELDS.attentionPassed] === false) {
        if (attentionStatus[SURVEY_API_FIELDS.failureReasons]?.includes("too_fast_attention")) {
          addToast(uiText("survey.attentionTooFast"), TOAST_VARIANTS.warning);
        } else {
          addToast(uiText("survey.attentionFailed"), TOAST_VARIANTS.warning);
        }
      } else {
        addToast(uiText("survey.saved"), TOAST_VARIANTS.success);
      }

      if (attentionStatus[SURVEY_API_FIELDS.hardFlagTriggered]) {
        addToast(uiText("survey.attentionHardFlag"), TOAST_VARIANTS.warning);
      }

      setShowConfetti(true);
      scheduleTimeout(() => setShowConfetti(false), runtimeConfig.confettiDurationMs);

      const nextCompleted = surveyCompleted + 1;
      setSurveyCompleted(nextCompleted);
      setLastSubmissionSucceeded(true);
      setSurveyFeedbackReady(true);

      // OTP state is only needed for gating email verification; once the user is successfully submitting surveys,
      // clear it to avoid stale "OTP in progress" state on future refreshes.
      const scope = String(publicId || "").trim() || "anon";
      forEachStorageArea((area) => {
        removeStoredKey(runtimeConfig.storageKeys.emailOtpState, area);
        removeStoredKey(makeScopedKey(runtimeConfig.storageKeys.emailOtpState, scope), area);
        removeStoredKey(makeScopedKey(runtimeConfig.storageKeys.emailOtpState, "anon"), area);
      });
    } catch (error) {
      if (error?.code === REQUEST_CODES.aborted || controller.signal.aborted) {
        return;
      }
      setLastSubmissionSucceeded(false);
      const errorMessage = getDisplayErrorMessage(error, "SYS_002_0006");
      throw new Error(errorMessage);
    } finally {
      if (submitAbortRef.current === controller) {
        submitAbortRef.current = null;
      }
    }
  }, [addToast, publicId, survey, surveyCompleted]);

  const cancelInFlightRequests = useCallback(() => {
    if (imageAbortRef.current) {
      imageAbortRef.current.abort();
      imageAbortRef.current = null;
    }
    if (submitAbortRef.current) {
      submitAbortRef.current.abort();
      submitAbortRef.current = null;
    }
  }, []);

  return {
    survey,
    setSurvey,
    surveyCompleted,
    setSurveyCompleted,
    surveyFeedbackReady,
    setSurveyFeedbackReady,
    lastSubmissionSucceeded,
    setLastSubmissionSucceeded,
    shownImages,
    setShownImages,
    imageError,
    setImageError,
    isFetchingImage,
    showConfetti,
    fetchImage,
    handleSubmit,
    cancelInFlightRequests,
  };
}
