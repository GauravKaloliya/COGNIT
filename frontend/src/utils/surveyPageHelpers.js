import { getApiUrl } from "./apiBase";

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
  getErrorMessage,
  uiText,
}) {
  if (!imageReady) return getErrorMessage("SYS_002_0018");
  if (submitting || submitLocked) return uiText("survey.submitBusy");
  if (wordCount < minWords) {
    return getErrorMessage("VAL_002_0004", "en", { min_words: minWords, actual: wordCount });
  }
  if (descriptionCharCount < minDescriptionLength) return getErrorMessage("VAL_002_0002");
  if (descriptionCharCount > maxDescriptionLength) return getErrorMessage("VAL_002_0003");
  if (difficultyRating === 0) return uiText("survey.difficultyRequired");
  if (confidenceRating === 0) return uiText("survey.confidenceRequired");
  const commentsLength = countAlphaNumericChars(comments);
  if (commentsLength < minFeedbackLength) return getErrorMessage("VAL_002_0006");
  if (commentsLength > maxFeedbackLength) return getErrorMessage("VAL_002_0007");
  return uiText("survey.submit");
}

export const sanitizeAlphaNumericSpace = (value) =>
  value.replace(/[\t\r\n]+/g, " ").replace(/[^a-zA-Z0-9 ]+/g, "");

export const countAlphaNumericChars = (value) =>
  String(value || "").replace(/[^a-zA-Z0-9]+/g, "").length;

export const countAlphaNumericWords = (value) => {
  const normalized = String(value || "").trim().replace(/[^a-zA-Z0-9 ]+/g, " ");
  if (!normalized) return 0;
  return normalized.split(/\s+/).filter(Boolean).length;
};
