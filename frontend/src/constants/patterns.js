export const REGEX_PATTERNS = {
  username: /^[a-zA-Z0-9_]+$/,
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  digitsOnly: /^\d+$/,
  indianPhone: /^[6-9]\d{9}$/,
  uuidTemplateToken: /[xy]/g,
};

export const STRING_PREFIXES = {
  countryCode91: "91",
};

export const STORAGE_EVENTS = {
  storage: "storage",
};
