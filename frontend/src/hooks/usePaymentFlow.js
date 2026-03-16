import { useCallback, useRef } from "react";
import { endpoints } from "../utils/api";
import { getErrorMessage } from "../utils/errorRegistry";
import { uiText } from "../utils/uiText";
import { APP_FLOW } from "../config/appFlow";
import { runtimeConfig } from "../config/runtime";
import { TOAST_VARIANTS } from "../constants/ui";
import { REQUEST_CODES } from "../constants/request";
import { clearPendingFlag } from "../utils/storage";

export function usePaymentFlow({
  publicId,
  stage,
  paymentSubStage,
  setStage,
  setStageManual,
  setPaymentSubStage,
  setPaymentVerified,
  addToast,
  transitionToSurvey,
}) {
  const verifyAbortRef = useRef(null);

  const handlePaymentComplete = useCallback(async (options = {}) => {
    const skipVerification = options?.skipVerification === true;

    if (skipVerification) {
        const switched = await transitionToSurvey();
        if (switched) {
          addToast(uiText("payment.successConfirm"), TOAST_VARIANTS.success);
        } else {
          addToast(getErrorMessage("SYS_002_0015"), TOAST_VARIANTS.error);
        }
      return;
    }

    try {
      if (verifyAbortRef.current) {
        verifyAbortRef.current.abort();
      }
      const controller = new AbortController();
      verifyAbortRef.current = controller;
      const paymentStatus = await endpoints.getParticipantPaymentStatus(publicId, { signal: controller.signal });
      if (paymentStatus.is_verified) {
        const switched = await transitionToSurvey();
        if (switched) {
          addToast(uiText("payment.successConfirm"), TOAST_VARIANTS.success);
        } else {
          addToast(getErrorMessage("SYS_002_0015"), TOAST_VARIANTS.error);
        }
      } else {
        addToast(getErrorMessage("PAY_001_0005"), TOAST_VARIANTS.error);
      }
    } catch (error) {
      if (error?.code === REQUEST_CODES.aborted) {
        return;
      }
      const errorMessage = error.message || getErrorMessage("PAY_001_0005");
      addToast(errorMessage, TOAST_VARIANTS.error);
      setPaymentVerified(false);
      if (stage !== APP_FLOW.stages.payment) {
        setStage(APP_FLOW.stages.payment);
        setPaymentSubStage(APP_FLOW.paymentSubStages.content);
      }
    } finally {
      verifyAbortRef.current = null;
    }
  }, [addToast, publicId, setPaymentSubStage, setPaymentVerified, setStage, stage, transitionToSurvey]);

  const handlePaymentContentToLink = useCallback(() => {
    setPaymentSubStage(APP_FLOW.paymentSubStages.link);
  }, [setPaymentSubStage]);

  const handlePaymentBack = useCallback(() => {
    if (paymentSubStage === APP_FLOW.paymentSubStages.link) {
      // If a previous offline "continue" was queued, it can auto-forward back to link.
      // Clearing it makes Back behave deterministically.
      clearPendingFlag(runtimeConfig.storageKeys.paymentContentPending);
      setPaymentSubStage(APP_FLOW.paymentSubStages.content);
    } else {
      if (setStageManual) {
        setStageManual(APP_FLOW.stages.userDetails);
      } else {
        setStage(APP_FLOW.stages.userDetails);
      }
      setPaymentVerified(false);
      setPaymentSubStage(APP_FLOW.paymentSubStages.content);
    }
  }, [paymentSubStage, setPaymentSubStage, setPaymentVerified, setStage, setStageManual]);

  return {
    handlePaymentComplete,
    handlePaymentContentToLink,
    handlePaymentBack,
  };
}
