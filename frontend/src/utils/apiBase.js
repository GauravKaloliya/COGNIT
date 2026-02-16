const normalizeApiBase = (baseValue) => {
  const trimmed = (baseValue || "").trim().replace(/\/+$/, "");
  if (!trimmed) return ""; // Empty string means use relative URLs (same origin)
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("/")) return trimmed;
  return `${window.location.protocol}//${trimmed}`;
};

const resolveDefaultApiBase = () => {
  if (typeof window === "undefined") {
    return "";
  }
  return "";
};

export const API_BASE = normalizeApiBase(
  import.meta.env.VITE_API_BASE || resolveDefaultApiBase()
);

// Helper to get full API URL
export const getApiUrl = (endpoint) => {
  // Ensure endpoint starts with /
  const normalizedEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;

  if (API_BASE) {
    if (API_BASE.endsWith("/api") && normalizedEndpoint.startsWith("/api/")) {
      return `${API_BASE}${normalizedEndpoint.slice(4)}`;
    }
    return `${API_BASE}${normalizedEndpoint}`;
  }
  // If API_BASE is empty, use relative URL (same origin - works in production)
  return normalizedEndpoint;
};

// Health check helper
export const checkApiHealth = async () => {
  try {
    const response = await fetch(getApiUrl('/api/health'));
    if (response.ok) {
      const data = await response.json();
      return { ok: true, data };
    }
    return { ok: false, error: `HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, error: error.message };
  }
};
