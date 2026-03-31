import React from "react";
import { uiText } from "../../utils/uiText.js";

function SurveyDescriptionField({
  description,
  setDescription,
  descriptionRef,
  showValidationErrors,
  minDescriptionLength,
  maxDescriptionLength,
  minWords,
  wordCount,
  charCount,
  imageReady,
  disabled = false,
  copyPasteDisabled,
  preventCopyPaste,
  preventClipboardShortcuts,
  sanitizeSurveyDescription,
  onBlur,
}) {
  React.useLayoutEffect(() => {
    const element = descriptionRef?.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [description, descriptionRef]);

  const wordProgressPct = Math.max(0, Math.min(100, Math.round((wordCount / Math.max(1, minWords)) * 100)));

  return (
    <div className="field">
      <div className="field-header">
        <label>{uiText("survey.descriptionLabel")} <span className="required" aria-label={uiText("common.requiredAria")}>*</span></label>
        <span className={`status-badge ${wordCount >= minWords ? "met" : "pending"}`}>
          {wordCount >= minWords ? uiText("survey.minimumMet") : uiText("survey.descriptionBadge")}
        </span>
      </div>
      <div className="textarea-wrap">
        <textarea
          ref={descriptionRef}
          className={showValidationErrors && description.length > 0 && (
            charCount < minDescriptionLength ||
            charCount > maxDescriptionLength
          ) ? "error-input" : ""}
          value={description}
          onChange={(e) => {
            const value = sanitizeSurveyDescription(e.target.value);
            if (value.trim().length <= maxDescriptionLength) {
              setDescription(value);
            }
          }}
          placeholder={uiText("survey.descriptionPlaceholder")}
          spellCheck
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
        {uiText("survey.wordsHelper", { min: minWords })}
      </div>
      <div className={`field-progress ${wordCount >= minWords ? "met" : "pending"}`}>
        <div className="field-progress-track" aria-hidden="true">
          <span className="field-progress-fill" style={{ width: `${wordProgressPct}%` }} />
        </div>
        <div className="field-progress-meta">
          <span className={showValidationErrors && wordCount < minWords ? "warning" : "ok"}>
            {uiText("survey.fieldProgress", { progress: wordProgressPct })}
          </span>
          <span className={showValidationErrors && wordCount < minWords ? "warning" : "ok"}>
          {uiText("survey.minimumWords", { min: minWords })}
          </span>
        </div>
      </div>
      <div className={`helper-text ${wordCount >= minWords ? "ok" : "warning"}`}>
        {wordCount >= minWords
          ? uiText("survey.wordsGood")
          : uiText("survey.wordsRemaining", { remaining: minWords - wordCount })}
      </div>
      <div className="helper-text info field-note">
        <strong>{uiText("survey.descriptionNoteTitle")}</strong> {uiText("survey.descriptionNote")}
      </div>
    </div>
  );
}

export default React.memo(SurveyDescriptionField);
