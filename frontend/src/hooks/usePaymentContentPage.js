import { useCallback, useEffect, useState } from "react";
import { runtimeConfig } from "../config/runtime";
import { clearPendingFlag, getPendingFlag, setPendingFlag } from "../utils/storage";
import { useOnlineStatus } from "./useOnlineStatus";
import { useRetryCountdown } from "./useRetryCountdown";

export function usePaymentContentPage({ onNext }) {
  const [continuing, setContinuing] = useState(false);
  const [pendingContinue, setPendingContinue] = useState(false);
  const isOnline = useOnlineStatus();
  const pendingKey = runtimeConfig.storageKeys.paymentContentPending;
  const paymentAmountLabel = `₹${runtimeConfig.paymentAmount}`;
  const rewardAmountLabel = `₹${runtimeConfig.rewardAmount}`;
  const retryCountdown = useRetryCountdown(!isOnline && pendingContinue, runtimeConfig.serviceRetrySeconds);

  const handleContinue = useCallback(async () => {
    if (continuing) return;
    if (!isOnline) {
      setPendingFlag(pendingKey);
      setPendingContinue(true);
      return;
    }
    setContinuing(true);
    try {
      await onNext?.();
    } finally {
      setContinuing(false);
    }
  }, [continuing, isOnline, onNext, pendingKey]);

  useEffect(() => {
    if (!isOnline || continuing) return;
    const pending = getPendingFlag(pendingKey);
    if (!pending) return;
    clearPendingFlag(pendingKey);
    setPendingContinue(false);
    handleContinue();
  }, [continuing, handleContinue, isOnline, pendingKey]);

  useEffect(() => {
    setPendingContinue(getPendingFlag(pendingKey));
  }, [pendingKey]);

  return {
    continuing,
    isOnline,
    pendingContinue,
    retryCountdown,
    paymentAmountLabel,
    rewardAmountLabel,
    handleContinue,
  };
}
