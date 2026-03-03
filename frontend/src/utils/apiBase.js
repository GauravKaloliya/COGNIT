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

export const API_BASE = normalizeApiBase(
  import.meta.env.VITE_API_BASE || resolveDefaultApiBase()
);

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
      const data = await response.json();
      return { ok: true, data };
    }
    return { ok: false, error: `HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, error: error.message };
  }
};
