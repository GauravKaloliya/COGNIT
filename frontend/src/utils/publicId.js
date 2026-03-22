export const getPublicIdOrNull = (publicId) => {
  const value = String(publicId || "").trim();
  return value ? value : null;
};

export const requirePublicId = (publicId, onMissing) => {
  const value = getPublicIdOrNull(publicId);
  if (!value && typeof onMissing === "function") {
    onMissing();
  }
  return value;
};

export const assertPublicId = (publicId, onMissing, options = {}) => {
  const value = getPublicIdOrNull(publicId);
  if (value) return value;
  if (typeof onMissing === "function") {
    onMissing();
  }
  const { code = "NF_001_0001", message = "Account not found. Please register first." } = options || {};
  const err = new Error(message);
  err.code = code;
  throw err;
};
