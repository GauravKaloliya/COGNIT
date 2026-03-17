import { useCallback, useEffect } from "react";
import { runtimeConfig } from "../config/runtime";
import { readExpiringValue, removeStoredKey, writeExpiringValue } from "../utils/storage";
import { useOnlineStatus } from "./useOnlineStatus";
import { uiText } from "../utils/uiText";
import { APP_ROUTES } from "../constants/routes";

export function useFinishedPage({ publicId }) {
  const isOnline = useOnlineStatus();
  const rewardAmountLabel = `₹${runtimeConfig.rewardAmount}`;

  useEffect(() => {
    document.title = uiText("finish.documentTitle");
  }, [publicId]);

  const handleFinish = useCallback(() => {
    let darkMode = null;
    darkMode = readExpiringValue(runtimeConfig.storageKeys.darkMode, null);

    [
      runtimeConfig.storageKeys.stage,
      runtimeConfig.storageKeys.paymentSubStage,
      runtimeConfig.storageKeys.consentGiven,
      runtimeConfig.storageKeys.paymentVerified,
      runtimeConfig.storageKeys.demographics,
      runtimeConfig.storageKeys.survey,
      runtimeConfig.storageKeys.surveyCompleted,
      runtimeConfig.storageKeys.surveyFeedbackReady,
      runtimeConfig.storageKeys.shownImages,
      runtimeConfig.storageKeys.paymentId,
      runtimeConfig.storageKeys.paymentTimerExpires,
      runtimeConfig.storageKeys.paymentState,
      runtimeConfig.storageKeys.consentDraft,
    ].forEach((key) => {
      removeStoredKey(key);
    });

    if (typeof darkMode === "boolean") {
      writeExpiringValue(runtimeConfig.storageKeys.darkMode, darkMode, {
        schemaVersion: runtimeConfig.uiStateSchemaVersion,
        ttlMs: runtimeConfig.uiStateTtlMs,
      });
    }

    window.location.href = APP_ROUTES.home;
  }, []);

  return {
    isOnline,
    rewardAmountLabel,
    handleFinish,
  };
}
