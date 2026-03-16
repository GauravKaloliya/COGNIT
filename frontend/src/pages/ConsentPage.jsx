import React, { useState } from "react";
import PageSkeleton from "../components/PageSkeleton.jsx";
import PanelState from "../components/PanelState.jsx";
import { useConsentPage } from "../hooks/useConsentPage";
import { uiText } from "../utils/uiText.js";
import { CONSENT_CONTENT } from "../content/consentContent";
import DSButton from "../components/design/DSButton.jsx";

export default function ConsentPage({ 
  onConsentGiven, 
  systemReady 
}) {
  const [showFullConsent, setShowFullConsent] = useState(false);
  const {
    consentChecked,
    setConsentChecked,
    error,
    setError,
    submitting,
    isOnline,
    paymentAmountLabel,
    rewardAmountLabel,
    handleSubmit,
    draftRestored,
    lastSavedAt,
    isSaving,
    saveError,
    retryCountdown,
  } = useConsentPage({ onConsentGiven, systemReady });

  if (submitting) {
    return (
      <PageSkeleton
        title={uiText("consent.savingTitle")}
        subtitle={uiText("consent.savingSubtitle")}
        variant="consent"
      />
    );
  }

  return (
    <div className="panel">
      {!isOnline && (
        <div className="banner warning">
          <span>{uiText("consent.offlineBanner")}</span>
        </div>
      )}
      {draftRestored && (
        <div className="banner info">
          <span>{uiText("draft.restored")}</span>
        </div>
      )}
      {isSaving && (
        <div className="banner info">
          <span className="status-icon saving" aria-hidden="true" />
          <span>{uiText("autosave.saving")}</span>
        </div>
      )}
      {saveError && (
        <div className="banner warning">
          <span>{saveError}</span>
        </div>
      )}
      {!isSaving && lastSavedAt && (
        <div className="banner info">
          <span className="status-icon saved" aria-hidden="true" />
          <span>{uiText("autosave.savedAt", { time: new Date(lastSavedAt).toLocaleTimeString() })}</span>
        </div>
      )}
      <h2 className="consent-title">{CONSENT_CONTENT.title}</h2>
      <p className="page-subtitle left no-bottom-margin">
        {CONSENT_CONTENT.subtitle}
      </p>
      
      <div className={`welcome-info consent-content ${showFullConsent ? "expanded" : "collapsed"}`}>
        {CONSENT_CONTENT.sections.map((section) => (
          <React.Fragment key={section.heading}>
            <h3>{section.heading}</h3>
            {section.intro && <p>{section.intro}</p>}
            {section.paragraphs?.map((paragraph) => (
              <p key={paragraph}>
                {paragraph.startsWith("Estimated duration:") ? <><strong>Estimated duration:</strong> {paragraph.replace("Estimated duration: ", "")}</> : paragraph}
              </p>
            ))}
            {section.dynamicList ? (
              <ul>
                <li><strong>Entry fee:</strong> {paymentAmountLabel}</li>
                <li><strong>Reward draw:</strong> Randomly selected participants receive {rewardAmountLabel} via UPI (typically within 24-48 hours)</li>
              </ul>
            ) : null}
            {section.items?.length ? (
              <ul>
                {section.items.map((item) => <li key={item}>{item}</li>)}
              </ul>
            ) : null}
            {section.secondaryIntro && <p>{section.secondaryIntro}</p>}
            {section.secondaryItems?.length ? (
              <ul>
                {section.secondaryItems.map((item) => <li key={item}>{item}</li>)}
              </ul>
            ) : null}
            {section.contactEmail ? (
              <p><strong>Email:</strong> <a href={`mailto:${section.contactEmail}`}>{section.contactEmail}</a></p>
            ) : null}
            {section.outro && <p>{section.outro}</p>}
          </React.Fragment>
        ))}
        {!showFullConsent && <div className="consent-fade" aria-hidden="true" />}
      </div>
      <div className="consent-toggle">
        <DSButton
          variant="ghost"
          type="button"
          onClick={() => setShowFullConsent((prev) => !prev)}
        >
          {showFullConsent ? uiText("consent.readLess") : uiText("consent.readMore")}
        </DSButton>
      </div>
      
      {error && (
        <PanelState
          variant="warning"
          title={CONSENT_CONTENT.actionRequiredTitle}
          message={error}
          icon="!"
        />
      )}
      
      <div className={`consent-checkbox ${error && !consentChecked ? 'error' : ''}`}>
        <input
          type="checkbox"
          checked={consentChecked}
          onChange={(e) => {
            setConsentChecked(e.target.checked);
            if (error) setError(null);
          }}
          id="consent-check"
          disabled={!isOnline}
        />
        <label htmlFor="consent-check">
          <strong>{CONSENT_CONTENT.checkboxTitle}</strong>
          <p className="consent-note">
            {CONSENT_CONTENT.checkboxNote}
          </p>
          <span className="helper-text warning">{uiText("consent.requiredHint")}</span>
        </label>
      </div>
      
      <div className="page-actions sticky-mobile-actions">
        <DSButton
          className="primary"
          onClick={handleSubmit}
          disabled={!systemReady || submitting || !consentChecked || !isOnline}
        >
          {submitting ? uiText("common.processing") : uiText("common.continue")}
          {!isOnline && retryCountdown > 0 && (
            <span className="button-badge">
              <span className="button-spinner small" />
              {retryCountdown}s
            </span>
          )}
        </DSButton>
        {!isOnline && retryCountdown > 0 && (
          <div className="helper-text">{uiText("survey.retryIn", { seconds: retryCountdown })}</div>
        )}
      </div>
    </div>
  );
}
