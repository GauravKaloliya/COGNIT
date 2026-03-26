import { APP_ROUTES } from "../constants/routes";

const normalizeApiBase = (baseValue) => {
  let trimmed = (baseValue || "").trim();
  if (!trimmed) return ""; // Empty string means use relative URLs (same origin)

  // Remove all trailing slashes
  trimmed = trimmed.replace(/\/+$/, "");

  // Remove any trailing whitespace that might have been hidden
  trimmed = trimmed.trim();

  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const u = new URL(trimmed);
      // Backend routes are rooted at "/"; guard against accidental "/api" suffix in env.
      if (u.pathname === APP_ROUTES.apiProxy || u.pathname === `${APP_ROUTES.apiProxy}/`) {
        u.pathname = "";
        return u.toString().replace(/\/+$/, "");
      }
      return trimmed;
    } catch {
      return trimmed;
    }
  }
  if (trimmed.startsWith("/")) return trimmed;
  return `${window.location.protocol}//${trimmed}`;
};

const isLocalHostName = (hostname) =>
  hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";

const resolveDefaultApiBase = () => {
  if (typeof window === "undefined") {
    return "";
  }
  return "";
};

const resolveConfiguredBase = () => {
  // In dev, always use the Vite proxy path for local API calls.
  if (import.meta.env.DEV) {
    return APP_ROUTES.apiProxy;
  }
  const rawBase = import.meta.env.VITE_API_BASE || resolveDefaultApiBase();
  const normalized = normalizeApiBase(rawBase);
  if (!normalized || typeof window === "undefined") {
    return normalized;
  }

  // If base is absolute and points to localhost from a non-local origin,
  // fall back to same-origin to avoid browser access-control failures.
  if (/^https?:\/\//i.test(normalized)) {
    try {
      const configuredUrl = new URL(normalized);
      const currentUrl = new URL(window.location.origin);

      if (
        isLocalHostName(configuredUrl.hostname) &&
        !isLocalHostName(currentUrl.hostname)
      ) {
        return "";
      }

      // If someone sets an absolute same-origin API base, collapse it to a path base.
      if (configuredUrl.origin === currentUrl.origin) {
        const pathBase = configuredUrl.pathname.replace(/\/+$/, "");
        return pathBase && pathBase !== "/" ? pathBase : "";
      }
    } catch {
      return normalized;
    }
  }

  return normalized;
};

export const API_BASE = resolveConfiguredBase();

export const getApiOriginUrl = () => {
  if (typeof window === "undefined") {
    return "/";
  }

  if (!API_BASE) {
    return `${window.location.origin}/`;
  }

  if (/^https?:\/\//i.test(API_BASE)) {
    return `${API_BASE.replace(/\/+$/, "")}/`;
  }

  return `${window.location.origin}${API_BASE.replace(/\/+$/, "")}/`;
};

// Helper to get full API URL
export const getApiUrl = (endpoint) => {
  // Ensure endpoint starts with / and remove any leading slashes to avoid doubles
  let cleanEndpoint = (endpoint || "").trim().replace(/^\/+/, "");
  // Defensive: if caller passes "/api/..." while base already points to backend root.
  cleanEndpoint = cleanEndpoint.replace(/^api\/+/, "");
  const normalizedEndpoint = `/${cleanEndpoint}`;

  if (API_BASE) {
    // API_BASE already has trailing slashes removed by normalizeApiBase
    return `${API_BASE}${normalizedEndpoint}`;
  }
  // If API_BASE is empty, use relative URL (same origin - works in production)
  return normalizedEndpoint;
};

// Health checks are handled in useSystemHealth.
