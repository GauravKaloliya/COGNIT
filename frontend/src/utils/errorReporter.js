import { API_ROUTES } from "../constants/routes";
import { REQUEST_HEADERS, REQUEST_METHODS } from "../constants/request";
import { BROWSER_EVENTS } from "../constants/browser";
import { runtimeConfig } from "../config/runtime";
import { getApiUrl } from "./apiBase";
import { readJsonValue, removeStoredKey, writeJsonValue, STORAGE_AREAS } from "./storage";

const TELEMETRY_KEY = runtimeConfig.storageKeys.telemetry;
const TELEMETRY_BLOCKED_KEY = runtimeConfig.storageKeys.telemetryBlocked;
const MAX_QUEUE = runtimeConfig.clientErrorMaxQueue;
const MAX_FIELD_LENGTH = runtimeConfig.clientErrorMaxFieldLength;
const BASE_BACKOFF_MS = Math.max(1000, runtimeConfig.serviceRetrySeconds * 1000);
const MAX_SEND_ATTEMPTS = runtimeConfig.clientErrorMaxSendAttempts;
const MAX_BACKOFF_MS = runtimeConfig.clientErrorMaxBackoffMs;
const BLOCK_COOLDOWN_MS = runtimeConfig.clientErrorBlockCooldownMs;

const truncate = (value) => {
  if (typeof value !== "string") return value;
  return value.length > MAX_FIELD_LENGTH ? `${value.slice(0, MAX_FIELD_LENGTH)}…` : value;
};

const sanitizePayload = (payload = {}) => {
  const safe = {
    message: truncate(payload.message || ""),
    stack: truncate(payload.stack || ""),
    context: truncate(payload.context || ""),
    route: truncate(payload.route || ""),
    tag: truncate(payload.tag || ""),
    meta: payload.meta && typeof payload.meta === "object" ? payload.meta : undefined,
  };
  if (!safe.message && !safe.stack && !safe.context) return null;
  return safe;
};

const readQueue = () => readJsonValue(TELEMETRY_KEY, [], STORAGE_AREAS.session) || [];

const writeQueue = (queue) => writeJsonValue(TELEMETRY_KEY, queue.slice(-MAX_QUEUE), STORAGE_AREAS.session);

const readBlocked = () => readJsonValue(TELEMETRY_BLOCKED_KEY, {}, STORAGE_AREAS.session) || {};

const writeBlocked = (blocked) => writeJsonValue(TELEMETRY_BLOCKED_KEY, blocked || {}, STORAGE_AREAS.session);

const isBlocked = (dedupeKey, now) => {
  const blocked = readBlocked();
  const until = blocked?.[dedupeKey] || 0;
  if (!until) return false;
  if (until <= now) return false;
  return true;
};

const blockKey = (dedupeKey, now) => {
  if (!dedupeKey) return;
  const blocked = readBlocked();
  const next = { ...(blocked || {}) };
  next[dedupeKey] = now + Math.max(0, BLOCK_COOLDOWN_MS || 0);
  Object.keys(next).forEach((key) => {
    if ((next[key] || 0) <= now) delete next[key];
  });
  writeBlocked(next);
};

const buildDedupeKey = (payload) => {
  const message = payload?.message || "";
  const context = payload?.context || "";
  const route = payload?.route || "";
  const tag = payload?.tag || "";
  return `${message}::${context}::${route}::${tag}`;
};

export const enqueueClientError = (payload) => {
  const safe = sanitizePayload(payload);
  if (!safe) return;
  const queue = readQueue();
  const key = buildDedupeKey(safe);
  const now = Date.now();
  if (isBlocked(key, now)) return;
  const existingIndex = queue.findIndex((item) => item?.dedupeKey === key);
  if (existingIndex >= 0) {
    const existing = queue[existingIndex];
    const nextAllowedAt = Math.max(existing.nextAllowedAt || 0, now + BASE_BACKOFF_MS);
    queue[existingIndex] = {
      ...existing,
      count: (existing.count || 1) + 1,
      lastSeenAt: now,
      nextAllowedAt,
    };
  } else {
    queue.push({
      ...safe,
      ts: now,
      dedupeKey: key,
      count: 1,
      lastSeenAt: now,
      nextAllowedAt: now,
      sendAttempts: 0,
    });
  }
  writeQueue(queue);
};

export const flushClientErrors = async () => {
  if (typeof navigator !== "undefined" && !navigator.onLine) return;
  const queue = readQueue();
  if (!queue.length) return;
  const now = Date.now();
  const nextIndex = queue.findIndex((item) => (item?.nextAllowedAt || 0) <= now);
  if (nextIndex < 0) return;
  const next = queue[nextIndex];
  try {
    const res = await fetch(getApiUrl(API_ROUTES.clientError), {
      method: REQUEST_METHODS.post,
      headers: {
        [REQUEST_HEADERS.contentType]: "application/json",
      },
      body: JSON.stringify(next),
      keepalive: true,
    });
    if (!res?.ok) {
      throw new Error();
    }
    const remaining = [...queue.slice(0, nextIndex), ...queue.slice(nextIndex + 1)];
    if (remaining.length) {
      writeQueue(remaining);
    } else {
      removeStoredKey(TELEMETRY_KEY, STORAGE_AREAS.session);
    }
  } catch {
    const attempts = (next.sendAttempts || 0) + 1;
    if (attempts >= MAX_SEND_ATTEMPTS) {
      blockKey(next.dedupeKey, Date.now());
      const remaining = [...queue.slice(0, nextIndex), ...queue.slice(nextIndex + 1)];
      if (remaining.length) {
        writeQueue(remaining);
      } else {
        removeStoredKey(TELEMETRY_KEY, STORAGE_AREAS.session);
      }
      return;
    }
    const backoff = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * Math.pow(2, attempts - 1));
    queue[nextIndex] = {
      ...next,
      sendAttempts: attempts,
      nextAllowedAt: Date.now() + backoff,
    };
    writeQueue(queue);
  }
};

export const reportClientError = async (payload) => {
  enqueueClientError(payload);
  await flushClientErrors();
};

export const initErrorReporter = () => {
  if (typeof window === "undefined") return () => {};
  const handleOnline = () => {
    flushClientErrors();
  };
  window.addEventListener(BROWSER_EVENTS.online, handleOnline);
  return () => window.removeEventListener(BROWSER_EVENTS.online, handleOnline);
};
