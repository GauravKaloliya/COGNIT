import { useCallback, useEffect } from "react";
import { runtimeConfig } from "../config/runtime";
import { useOnlineStatus } from "./useOnlineStatus";
import { uiText } from "../utils/uiText";
import { APP_ROUTES } from "../constants/routes";

export function useFinishedPage({ publicId, clearUserStorage }) {
  const isOnline = useOnlineStatus();
  const rewardAmountLabel = `₹${runtimeConfig.rewardAmount}`;

  useEffect(() => {
    document.title = uiText("finish.documentTitle");
  }, [publicId]);

  const handleFinish = useCallback(() => {
    clearUserStorage?.(publicId);
    window.location.href = APP_ROUTES.home;
  }, [clearUserStorage, publicId]);

  return {
    isOnline,
    rewardAmountLabel,
    handleFinish,
  };
}
