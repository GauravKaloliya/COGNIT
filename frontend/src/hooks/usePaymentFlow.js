import { useCallback, useRef } from "react";
import { endpoints } from "../utils/api";
import { getErrorMessage } from "../utils/errorRegistry";

export function usePaymentFlow({
  publicId,
  stage,
  paymentSubStage,
  setStage,
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
        addToast("Participation confirmed successfully", "success");
      } else {
        addToast(getErrorMessage("SYS_002_0015"), "error");
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
          addToast("Participation confirmed successfully", "success");
        } else {
          addToast(getErrorMessage("SYS_002_0015"), "error");
        }
      } else {
        addToast(getErrorMessage("PAY_001_0005"), "error");
      }
    } catch (error) {
      if (error?.code === "REQ_ABORTED") {
        return;
      }
      const errorMessage = error.message || getErrorMessage("PAY_001_0005");
      addToast(errorMessage, "error");
      setPaymentVerified(false);
      if (stage !== "payment") {
        setStage("payment");
        setPaymentSubStage("content");
      }
    } finally {
      verifyAbortRef.current = null;
    }
  }, [addToast, publicId, setPaymentSubStage, setPaymentVerified, setStage, stage, transitionToSurvey]);

  const handlePaymentContentToLink = useCallback(() => {
    setPaymentSubStage("link");
  }, [setPaymentSubStage]);

  const handlePaymentBack = useCallback(() => {
    if (paymentSubStage === "link") {
      setPaymentSubStage("content");
    } else {
      setStage("user-details");
      setPaymentVerified(false);
      setPaymentSubStage("content");
    }
  }, [paymentSubStage, setPaymentSubStage, setPaymentVerified, setStage]);

  return {
    handlePaymentComplete,
    handlePaymentContentToLink,
    handlePaymentBack,
  };
}
