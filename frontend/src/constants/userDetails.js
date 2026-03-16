export const USER_DETAIL_FIELDS = {
  username: "username",
  email: "email",
  phone: "phone",
  genderCode: "gender_code",
  age: "age",
  location: "location",
  languageCode: "language_code",
  priorExperience: "prior_experience",
  general: "general",
};

export const USER_DETAILS_DUPLICATE_ERROR_CODES = {
  username: "DUP_001_0001",
  email: "DUP_001_0002",
  phone: "DUP_001_0003",
  fallback: "DUP_001_0004",
};

export const USER_DETAILS_ERROR_CODE_TO_FIELD = {
  DUP_001_0001: USER_DETAIL_FIELDS.username,
  DUP_001_0002: USER_DETAIL_FIELDS.email,
  DUP_001_0003: USER_DETAIL_FIELDS.phone,
};

export const GEOLOCATION_MODES = {
  auto: "auto",
  manual: "manual",
};

export const GEOLOCATION_ERROR_CODES = {
  permissionDenied: 1,
};

export const USER_DETAILS_STATUS = {
  pendingFlag: "1",
};

export const REVERSE_GEOCODE_FIELDS = {
  nextAllowedAt: "next_allowed_at",
  failCount: "fail_count",
  expiresAt: "expires_at",
};
