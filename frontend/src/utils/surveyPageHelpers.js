import { getApiUrl } from "./apiBase";
import { getErrorMessage } from "./errorRegistry";

const COLLAPSE_WHITESPACE_RE = /[\t\r\n]+/g;
const DISALLOWED_DESCRIPTION_CHAR_RE = /[^ \p{L}\p{N}.]/gu;
const NATURAL_LANGUAGE_WORD_RE = /\b[\p{L}][\p{L}\p{N}'-]*\b/gu;

function stripControlCharacters(value) {
  return Array.from(String(value || ""))
    .filter((char) => {
      const codePoint = char.codePointAt(0);
      if (typeof codePoint !== "number") return false;
      return !((codePoint <= 0x08) || codePoint === 0x0B || codePoint === 0x0C || (codePoint >= 0x0E && codePoint <= 0x1F) || codePoint === 0x7F);
    })
    .join("");
}

export function buildSurveyImageState(survey) {
  const resolvedImageId = survey?.image_id || survey?.imageId || null;
  const resolvedImageUrl = survey?.url || survey?.image_url || survey?.imageUrl || "";
  const imageSrc = resolvedImageUrl
    ? (resolvedImageUrl.startsWith("http") ? resolvedImageUrl : getApiUrl(resolvedImageUrl))
    : "";
  return {
    imageSrc,
    hasUsableSurveyImage: Boolean(resolvedImageId && imageSrc),
  };
}

export function getSubmitTooltip({
  imageReady,
  imageError,
  imageRecoveryTerminal = false,
  surveyLoaded = true,
  submitting,
  submitLocked,
  wordCount,
  minWords,
  descriptionCharCount,
  minDescriptionLength,
  maxDescriptionLength,
  difficultyRating,
  confidenceRating,
  comments,
  minFeedbackLength,
  maxFeedbackLength,
  getErrorMessage: _getErrorMessage,
  uiText,
}) {
  if (!surveyLoaded) return uiText("survey.footerLoadNextImage");
  if (!imageReady) {
    if (imageRecoveryTerminal) return uiText("survey.footerRestoreImageTerminal");
    return imageError ? uiText("survey.footerRestoreImage") : uiText("survey.footerLoadingImage");
  }
  if (submitting) return uiText("survey.submitBusy");
  if (submitLocked) return uiText("survey.submitLocked");
  if (wordCount < minWords) {
    return uiText("survey.footerNeedWords", { remaining: Math.max(0, minWords - wordCount) });
  }
  if (descriptionCharCount < minDescriptionLength) return uiText("survey.footerNeedDescriptionDetail");
  if (descriptionCharCount > maxDescriptionLength) return uiText("survey.footerDescriptionTooLong");
  if (difficultyRating === 0) return uiText("survey.footerNeedDifficulty");
  if (confidenceRating === 0) return uiText("survey.footerNeedConfidence");
  const commentsLength = countAlphaNumericChars(comments);
  if (commentsLength < minFeedbackLength) {
    return uiText("survey.footerNeedComments", { remaining: Math.max(0, minFeedbackLength - commentsLength) });
  }
  if (commentsLength > maxFeedbackLength) return uiText("survey.footerCommentsTooLong");
  return uiText("survey.submit");
}

export function getFriendlySurveySubmitErrorMessage(rawMessage, { uiText }) {
  const normalized = String(rawMessage || "").trim();
  if (!normalized) return "";
  if (normalized === uiText("survey.submit")) return "";
  if (normalized === uiText("survey.submitBusy")) return "";
  if (normalized === uiText("survey.submitLocked")) return "";
  if (normalized === uiText("survey.offlineSubmit")) return uiText("survey.footerOffline");
  if (normalized === uiText("survey.imageRestoreFailed")) return uiText("survey.footerRestoreImage");
  if (normalized === uiText("survey.imageRestoreTerminal")) return uiText("survey.footerRestoreImageTerminal");
  if (normalized === uiText("survey.feedLoadFailed")) return uiText("survey.footerLoadNextImage");
  if (normalized === getErrorMessage("UI_001_0002")) return uiText("survey.footerImageMissing");
  if (normalized.includes("At least") && normalized.includes("words")) return uiText("survey.footerNeedDescriptionDetail");
  if (normalized.includes("difficulty")) return uiText("survey.footerNeedDifficulty");
  if (normalized.includes("confidence")) return uiText("survey.footerNeedConfidence");
  if (normalized.includes("comments") || normalized.includes("feedback")) return uiText("survey.footerNeedComments", { remaining: "a few" });
  if (normalized.includes("Please wait")) return uiText("survey.submitLocked");
  return normalized || uiText("survey.footerGenericError");
}

export const sanitizeSurveyDescription = (value) =>
  stripControlCharacters(value)
    .replace(COLLAPSE_WHITESPACE_RE, " ")
    .replace(DISALLOWED_DESCRIPTION_CHAR_RE, "");

export const sanitizeAlphaNumericSpace = (value) =>
  value.replace(/[\t\r\n]+/g, " ").replace(/[^a-zA-Z0-9 ]+/g, "");

export const countSurveyDescriptionChars = (value) =>
  sanitizeSurveyDescription(value).trim().length;

export const countSurveyDescriptionWords = (value) => {
  const normalized = sanitizeSurveyDescription(value).trim();
  if (!normalized) return 0;
  const matches = normalized.match(NATURAL_LANGUAGE_WORD_RE);
  return Array.isArray(matches) ? matches.length : 0;
};

export const countAlphaNumericChars = (value) =>
  String(value || "").replace(/[^a-zA-Z0-9]+/g, "").length;

export const countAlphaNumericWords = (value) => {
  const normalized = String(value || "").trim().replace(/[^a-zA-Z0-9 ]+/g, " ");
  if (!normalized) return 0;
  return normalized.split(/\s+/).filter(Boolean).length;
};
