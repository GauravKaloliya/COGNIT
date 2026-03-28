import { useEffect, useState } from "react";
import { SECOND_MS, scheduleInterval, clearScheduledInterval } from "../utils/timing";

export function useRetryCountdown(active, initialSeconds, paused = false) {
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    const duration = Math.max(0, Number(initialSeconds) || 0);
    if (!active || duration === 0) {
      setSecondsLeft(0);
      return undefined;
    }
    setSecondsLeft(duration);
    return undefined;
  }, [active, initialSeconds]);

  useEffect(() => {
    if (!active || paused || secondsLeft === 0) return undefined;
    const intervalId = scheduleInterval(() => {
      setSecondsLeft((prev) => (prev > 0 ? prev - 1 : 0));
    }, SECOND_MS);
    return () => clearScheduledInterval(intervalId);
  }, [active, paused, secondsLeft]);

  return secondsLeft;
}
