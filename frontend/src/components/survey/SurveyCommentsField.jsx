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

  return (
    <div className="field feedback-field">
      <label>{uiText("survey.commentsLabel")} <span className="required" aria-label={uiText("common.requiredAria")}>*</span></label>
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
      <div className="counts">
        <span className={showValidationErrors && commentsCharCount < minFeedbackLength ? "warning" : ""}>
          {uiText("survey.feedbackMin", { count: commentsCharCount, min: minFeedbackLength })}
        </span>
        <span className="ok">{uiText("survey.feedbackMinimum", { min: minFeedbackLength })}</span>
      </div>
      <div className={`helper-text ${commentsCharCount >= minFeedbackLength ? "ok" : "warning"}`}>
        {commentsCharCount >= minFeedbackLength
          ? uiText("survey.feedbackGood")
          : uiText("survey.feedbackRemainingMin", { remaining: minFeedbackLength - commentsCharCount })}
      </div>
    </div>
  );
}

export default React.memo(SurveyCommentsField);
