export const SECOND_MS = 1000;

export const secondsToMs = (seconds) => Math.max(0, Number(seconds || 0) * SECOND_MS);

export const scheduleTimeout = (fn, ms) => window.setTimeout(fn, ms);

export const clearScheduledTimeout = (id) => {
  if (id) window.clearTimeout(id);
};

export const scheduleInterval = (fn, ms) => window.setInterval(fn, ms);

export const clearScheduledInterval = (id) => {
  if (id) window.clearInterval(id);
};
