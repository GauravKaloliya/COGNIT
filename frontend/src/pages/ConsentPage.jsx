import React from "react";
import PageSkeleton from "../components/PageSkeleton.jsx";
import PanelState from "../components/PanelState.jsx";
import { useConsentPage } from "../hooks/useConsentPage";
import { uiText } from "../utils/uiText.js";
import { CONSENT_CONTENT } from "../content/consentContent";

export default function ConsentPage({ 
  onConsentGiven, 
  systemReady 
}) {
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
      <h2 className="consent-title">{CONSENT_CONTENT.title}</h2>
      <p className="page-subtitle left no-bottom-margin">
        {CONSENT_CONTENT.subtitle}
      </p>
      
      <div className="welcome-info">
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
        </label>
      </div>
      
      <div className="page-actions sticky-mobile-actions">
        <button
          className="primary"
          onClick={handleSubmit}
          disabled={!systemReady || submitting || !consentChecked || !isOnline}
        >
          {submitting ? uiText("common.processing") : uiText("common.continue")}
        </button>
      </div>
    </div>
  );
}
