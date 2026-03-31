import React from "react";
import { uiText } from "../../utils/uiText.js";

function SurveyCommentsField({
  comments,
  setComments,
  commentsRef,
  showValidationErrors,
  minFeedbackLength,
  maxFeedbackLength,
  commentsCharCount,
  imageReady,
  disabled = false,
  copyPasteDisabled,
  preventCopyPaste,
  preventClipboardShortcuts,
  sanitizeAlphaNumericSpace,
  onBlur,
}) {
  React.useLayoutEffect(() => {
    const element = commentsRef?.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [comments, commentsRef]);

  const commentsProgressPct = Math.max(0, Math.min(100, Math.round((commentsCharCount / Math.max(1, minFeedbackLength)) * 100)));

  return (
    <div className="field feedback-field">
      <div className="field-header">
        <label>{uiText("survey.commentsLabel")} <span className="required" aria-label={uiText("common.requiredAria")}>*</span></label>
        <span className={`status-badge ${commentsCharCount >= minFeedbackLength ? "met" : "pending"}`}>
          {commentsCharCount >= minFeedbackLength ? uiText("survey.minimumMet") : uiText("survey.commentsBadge")}
        </span>
      </div>
      <div className="textarea-wrap">
        <textarea
          ref={commentsRef}
          className={showValidationErrors && comments.length > 0 && (
            commentsCharCount < minFeedbackLength ||
            commentsCharCount > maxFeedbackLength
          ) ? "error-input" : ""}
          value={comments}
          onChange={(e) => {
            const value = sanitizeAlphaNumericSpace(e.target.value);
            if (commentsCharCount === undefined || value.replace(/[^a-zA-Z0-9]+/g, "").length <= maxFeedbackLength) {
              setComments(value);
            }
          }}
          placeholder={uiText("survey.commentsPlaceholder")}
          disabled={disabled || !imageReady}
          onCopy={copyPasteDisabled ? preventCopyPaste : undefined}
          onCut={copyPasteDisabled ? preventCopyPaste : undefined}
          onPaste={copyPasteDisabled ? preventCopyPaste : undefined}
          onContextMenu={copyPasteDisabled ? preventCopyPaste : undefined}
          onDrop={copyPasteDisabled ? preventCopyPaste : undefined}
          onDragOver={copyPasteDisabled ? preventCopyPaste : undefined}
          onKeyDown={copyPasteDisabled ? preventClipboardShortcuts : undefined}
          onBlur={onBlur}
        />
      </div>
      <div className="helper-text">
        {uiText("survey.feedbackHelper", { min: minFeedbackLength })}
      </div>
      <div className={`field-progress ${commentsCharCount >= minFeedbackLength ? "met" : "pending"}`}>
        <div className="field-progress-track" aria-hidden="true">
          <span className="field-progress-fill" style={{ width: `${commentsProgressPct}%` }} />
        </div>
        <div className="field-progress-meta">
          <span className={showValidationErrors && commentsCharCount < minFeedbackLength ? "warning" : "ok"}>
            {uiText("survey.fieldProgress", { progress: commentsProgressPct })}
          </span>
          <span className={showValidationErrors && commentsCharCount < minFeedbackLength ? "warning" : "ok"}>
            {uiText("survey.feedbackMinimum", { min: minFeedbackLength })}
          </span>
        </div>
      </div>
      <div className={`helper-text ${commentsCharCount >= minFeedbackLength ? "ok" : "warning"}`}>
        {commentsCharCount >= minFeedbackLength
          ? uiText("survey.feedbackGood")
          : uiText("survey.feedbackRemainingMin", { remaining: minFeedbackLength - commentsCharCount })}
      </div>
      <div className="helper-text info field-note">
        <strong>{uiText("survey.commentsNoteTitle")}</strong> {uiText("survey.commentsNote")}
      </div>
    </div>
  );
}

export default React.memo(SurveyCommentsField);
