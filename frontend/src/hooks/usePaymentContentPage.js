import { useCallback, useEffect, useState } from "react";
import { runtimeConfig } from "../config/runtime";
import { clearPendingFlag, getPendingFlag, setPendingFlag } from "../utils/storage";
import { useOnlineStatus } from "./useOnlineStatus";

export function usePaymentContentPage({ onNext }) {
  const [continuing, setContinuing] = useState(false);
  const isOnline = useOnlineStatus();
  const pendingKey = runtimeConfig.storageKeys.paymentContentPending;
  const paymentAmountLabel = `₹${runtimeConfig.paymentAmount}`;
  const rewardAmountLabel = `₹${runtimeConfig.rewardAmount}`;

  const handleContinue = useCallback(async () => {
    if (continuing) return;
    if (!isOnline) {
      setPendingFlag(pendingKey);
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
    handleContinue();
  }, [continuing, handleContinue, isOnline, pendingKey]);

  return {
    continuing,
    isOnline,
    paymentAmountLabel,
    rewardAmountLabel,
    handleContinue,
  };
}
