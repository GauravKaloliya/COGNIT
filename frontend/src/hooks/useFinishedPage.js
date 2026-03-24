import { useCallback, useEffect } from "react";
import { useOnlineStatus } from "./useOnlineStatus";
import { uiText } from "../utils/uiText";
import { APP_ROUTES } from "../constants/routes";

export function useFinishedPage({ publicId, clearUserStorage }) {
  const isOnline = useOnlineStatus();

  useEffect(() => {
    document.title = uiText("finish.documentTitle");
  }, [publicId]);

  const handleFinish = useCallback(() => {
    if (!isOnline) return;
    clearUserStorage?.(publicId);
    window.location.href = APP_ROUTES.home;
  }, [clearUserStorage, isOnline, publicId]);

  return {
    isOnline,
    handleFinish,
  };
}
