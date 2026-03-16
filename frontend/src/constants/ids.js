import { REGEX_PATTERNS } from "./patterns";

export const ID_TEMPLATES = {
  uuidV4Fallback: "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx",
};

export function createFallbackUuid() {
  return ID_TEMPLATES.uuidV4Fallback.replace(REGEX_PATTERNS.uuidTemplateToken, (char) => {
    const randomValue = (Math.random() * 16) | 0;
    const value = char === "x" ? randomValue : (randomValue & 0x3) | 0x8;
    return value.toString(16);
  });
}
