import React from "react";
import { uiText } from "../../utils/uiText.js";

export default function SurveyCommentsField({
  comments,
  setComments,
  commentsRef,
  showValidationErrors,
  minFeedbackLength,
  maxFeedbackLength,
  imageReady,
  copyPasteDisabled,
  preventCopyPaste,
  preventClipboardShortcuts,
  sanitizeAlphaNumericSpace,
}) {
  return (
    <div className="field feedback-field">
      <label>{uiText("survey.commentsLabel")} <span className="required" aria-label="required">*</span></label>
      <div className="textarea-wrap">
        <textarea
          ref={commentsRef}
          className={showValidationErrors && comments.length > 0 && (
            comments.length < minFeedbackLength ||
            comments.length > maxFeedbackLength
          ) ? "error-input" : ""}
          value={comments}
          onChange={(e) => {
            const value = sanitizeAlphaNumericSpace(e.target.value);
            if (value.length <= maxFeedbackLength) {
              setComments(value);
            }
          }}
          placeholder={uiText("survey.commentsPlaceholder")}
          disabled={!imageReady}
          maxLength={maxFeedbackLength}
          onCopy={copyPasteDisabled ? preventCopyPaste : undefined}
          onCut={copyPasteDisabled ? preventCopyPaste : undefined}
          onPaste={copyPasteDisabled ? preventCopyPaste : undefined}
          onContextMenu={copyPasteDisabled ? preventCopyPaste : undefined}
          onDrop={copyPasteDisabled ? preventCopyPaste : undefined}
          onDragOver={copyPasteDisabled ? preventCopyPaste : undefined}
          onKeyDown={copyPasteDisabled ? preventClipboardShortcuts : undefined}
        />
        <div className="textarea-counter">{uiText("survey.charsCount", { count: comments.length, max: maxFeedbackLength })}</div>
      </div>
      <div className="counts">
        <span className={showValidationErrors && comments.length < minFeedbackLength ? "warning" : ""}>
          {uiText("survey.feedbackMin", { count: comments.length })}
        </span>
        <span className="ok">{uiText("survey.feedbackMinimum")}</span>
      </div>
      <div className={`helper-text ${comments.length >= minFeedbackLength ? "ok" : "warning"}`}>
        {comments.length >= minFeedbackLength
          ? uiText("survey.feedbackGood")
          : uiText("survey.feedbackRemainingMin", { remaining: minFeedbackLength - comments.length })}
      </div>
    </div>
  );
}
