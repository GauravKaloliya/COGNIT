import { useEffect, useState } from "react";
import { SECOND_MS, scheduleInterval, clearScheduledInterval } from "../utils/timing";

export function useRetryCountdown(active, initialSeconds) {
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    if (!active || !initialSeconds || initialSeconds <= 0) {
      setSecondsLeft(0);
      return undefined;
    }
    setSecondsLeft(initialSeconds);
    const interval = scheduleInterval(() => {
      setSecondsLeft((prev) => (prev > 0 ? prev - 1 : 0));
    }, SECOND_MS);
    return () => clearScheduledInterval(interval);
  }, [active, initialSeconds]);

  return secondsLeft;
}
