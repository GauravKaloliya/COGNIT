import { useCallback, useEffect } from "react";
import { runtimeConfig } from "../config/runtime";
import { forEachStorageArea, makeScopedKey, readExpiringValue, removeStoredKey, writeExpiringValue } from "../utils/storage";
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

    const scope = String(publicId || "").trim() || "anon";
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
        removeStoredKey(makeScopedKey(key, "anon"), area);
      });
    });

    if (typeof darkMode === "boolean") {
      writeExpiringValue(runtimeConfig.storageKeys.darkMode, darkMode, {
        area: "local",
        schemaVersion: runtimeConfig.uiStateSchemaVersion,
        ttlMs: runtimeConfig.uiStateTtlMs,
      });
    }

    window.location.href = APP_ROUTES.home;
  }, [publicId]);

  return {
    isOnline,
    rewardAmountLabel,
    handleFinish,
  };
}
