import { useCallback } from "react";

export function useRenderProfiler(id, thresholdMs = 18) {
  return useCallback((_, phase, actualDuration) => {
    if (!import.meta.env.DEV) return;
    if (actualDuration < thresholdMs) return;
    // eslint-disable-next-line no-console
    console.debug(`[render-profiler] ${id} ${phase} ${actualDuration.toFixed(1)}ms`);
  }, [id, thresholdMs]);
}

export default useRenderProfiler;
