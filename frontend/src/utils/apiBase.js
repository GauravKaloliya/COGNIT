const normalizeApiBase = (baseValue) => {
  let trimmed = (baseValue || "").trim();
  if (!trimmed) return ""; // Empty string means use relative URLs (same origin)

  // Remove all trailing slashes
  trimmed = trimmed.replace(/\/+$/, "");

  // Remove any trailing whitespace that might have been hidden
  trimmed = trimmed.trim();

  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("/")) return trimmed;
  return `${window.location.protocol}//${trimmed}`;
};

const isLocalHostName = (hostname) =>
  hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";

const resolveConfiguredBase = () => {
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

const resolveDefaultApiBase = () => {
  if (typeof window === "undefined") {
    return "";
  }
  // In dev, route API calls through Vite proxy to avoid host/CORS mismatch.
  // Keep production behavior unchanged (same-origin when not in dev).
  if (import.meta.env.DEV) {
    return "/api";
  }
  return "";
};

export const API_BASE = resolveConfiguredBase();

// Helper to get full API URL
export const getApiUrl = (endpoint) => {
  // Ensure endpoint starts with / and remove any leading slashes to avoid doubles
  const cleanEndpoint = (endpoint || "").trim().replace(/^\/+/, "");
  const normalizedEndpoint = `/${cleanEndpoint}`;

  if (API_BASE) {
    // API_BASE already has trailing slashes removed by normalizeApiBase
    return `${API_BASE}${normalizedEndpoint}`;
  }
  // If API_BASE is empty, use relative URL (same origin - works in production)
  return normalizedEndpoint;
};

// Health check helper
export const checkApiHealth = async () => {
  try {
    const response = await fetch(getApiUrl('/health'));
    if (response.ok) {
      const payload = await response.json();
      const data = payload?.success === true ? (payload.data || {}) : (payload || {});
      return { ok: true, data };
    }
    return { ok: false, error: `HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, error: error.message };
  }
};
