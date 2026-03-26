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
  sanitizeAlphaNumericSpace,
  onBlur,
}) {
  return (
    <div className="field">
      <label>{uiText("survey.descriptionLabel")} <span className="required" aria-label="required">*</span></label>
      <div className="textarea-wrap">
        <textarea
          ref={descriptionRef}
          className={showValidationErrors && description.length > 0 && (
            description.length < minDescriptionLength ||
            description.length > maxDescriptionLength
          ) ? "error-input" : ""}
          value={description}
          onChange={(e) => {
            const value = sanitizeAlphaNumericSpace(e.target.value);
            if (value.length <= maxDescriptionLength) {
              setDescription(value);
            }
          }}
          placeholder={uiText("survey.descriptionPlaceholder")}
          spellCheck
          disabled={disabled || !imageReady}
          maxLength={maxDescriptionLength}
          onCopy={copyPasteDisabled ? preventCopyPaste : undefined}
          onCut={copyPasteDisabled ? preventCopyPaste : undefined}
          onPaste={copyPasteDisabled ? preventCopyPaste : undefined}
          onContextMenu={copyPasteDisabled ? preventCopyPaste : undefined}
          onDrop={copyPasteDisabled ? preventCopyPaste : undefined}
          onDragOver={copyPasteDisabled ? preventCopyPaste : undefined}
          onKeyDown={copyPasteDisabled ? preventClipboardShortcuts : undefined}
          onBlur={onBlur}
        />
        <div className="textarea-counter">
          {uiText("survey.wordsChars", { words: wordCount, chars: charCount, max: maxDescriptionLength })}
        </div>
      </div>
      <div className="counts">
        <span>{uiText("survey.wordsMin", { words: wordCount, min: minWords })}</span>
        <span className={showValidationErrors && wordCount < minWords ? "warning" : "ok"}>
          {uiText("survey.minimumWords", { min: minWords })}
        </span>
      </div>
      <div className={`helper-text ${wordCount >= minWords ? "ok" : "warning"}`}>
        {wordCount >= minWords
          ? uiText("survey.wordsGood")
          : uiText("survey.wordsRemaining", { remaining: minWords - wordCount })}
      </div>
    </div>
  );
}

export default React.memo(SurveyDescriptionField);
