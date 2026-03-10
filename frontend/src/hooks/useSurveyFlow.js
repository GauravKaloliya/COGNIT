import { useCallback, useRef, useState } from "react";
import { endpoints } from "../utils/api";
import { getErrorMessage } from "../utils/errorRegistry";
import { runtimeConfig } from "../config/runtime";

const normalizeSurveyPayload = (value) => {
  if (!value || typeof value !== "object") return null;
  const imageId = value.image_id || value.imageId || null;
  const imageUrl = value.url || value.image_url || value.imageUrl || "";
  return {
    ...value,
    image_id: imageId,
    url: imageUrl,
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

  const fetchImage = useCallback(async ({ clearCurrent = false, throwOnError = false } = {}) => {
    // Keep refresh/session-resumed survey stable: do not request a new image
    // unless caller explicitly asks to clear current survey.
    if (!clearCurrent && survey?.image_id && typeof survey?.url === "string" && survey.url.trim()) {
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

    try {
      const data = await endpoints.getRandomImage(shownImages, publicId, { signal: controller.signal });
      const normalizedData = normalizeSurveyPayload(data);
      if (!normalizedData?.image_id) {
        throw new Error(getErrorMessage("SYS_002_0016"));
      }
      setShownImages((prev) => [...prev, normalizedData.image_id]);
      setSurvey(normalizedData);
      return normalizedData;
    } catch (error) {
      if (error?.code === "REQ_ABORTED" || controller.signal.aborted) {
        return null;
      }
      const errorMessage = error.message || getErrorMessage("SYS_002_0016");
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
    if (submitAbortRef.current) {
      submitAbortRef.current.abort();
    }
    const controller = new AbortController();
    submitAbortRef.current = controller;

    try {
      const result = await endpoints.submitDescription({
        public_id: publicId,
        image_id: survey.image_id,
        description: formData.description,
        rating: formData.rating,
        feedback: formData.comments,
        time_spent_seconds: formData.timeSpentSeconds,
        is_survey: survey?.is_survey === true,
        is_attention_check: survey?.is_attention_check === true,
        survey_index: surveyCompleted + 1,
        tab_switch_count: engagementData.tabSwitchCount || 0,
        page_close_attempts: engagementData.pageCloseAttempts || 0,
        network_disconnects: engagementData.networkDisconnects || 0,
      }, { signal: controller.signal });

      const attentionStatus = result.attention_status || {};
      if (attentionStatus.is_attention_check && result.attention_passed === false) {
        if (attentionStatus.failure_reasons?.includes("too_fast_attention")) {
          addToast("Attention check failed: response was too fast. Please read image instructions carefully.", "warning");
        } else {
          addToast("Attention check failed: please follow the special instructions shown in the image.", "warning");
        }
      } else {
        addToast("Your response was saved!", "success");
      }

      if (attentionStatus.hard_flag_triggered) {
        addToast("Multiple attention failures detected. Please slow down and answer carefully.", "warning");
      }

      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), runtimeConfig.confettiDurationMs);

      const nextCompleted = surveyCompleted + 1;
      setSurveyCompleted(nextCompleted);
      setLastSubmissionSucceeded(true);
      setSurveyFeedbackReady(true);
    } catch (error) {
      if (error?.code === "REQ_ABORTED" || controller.signal.aborted) {
        return;
      }
      setLastSubmissionSucceeded(false);
      const errorMessage = error.message || getErrorMessage("SYS_002_0006");
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
