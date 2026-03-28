import React, { useState } from "react";
import PanelState from "../components/PanelState.jsx";
import { useConsentPage } from "../hooks/useConsentPage";
import { uiText } from "../utils/uiText.js";
import { CONSENT_CONTENT } from "../content/consentContent";
import DSButton from "../components/design/DSButton.jsx";
import PageStatusBanners from "../components/PageStatusBanners.jsx";
import PageActions from "../components/PageActions.jsx";

export default function ConsentPage({ 
  storageScope,
  sessionHydrated = false,
  consentGiven,
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
    handleSubmit,
    saveError,
  } = useConsentPage({
    storageScope,
    consentGiven,
    onConsentGiven,
    systemReady,
    sessionHydrated,
  });

  return (
    <div className="panel panel-with-corner-status consent-page-shell">
      <div className="page-top-actions stage-section" style={{ "--section-index": 0 }}>
        <div className="page-top-banners" />
      </div>
      <div className="stage-section" style={{ "--section-index": 1 }}>
        <PageStatusBanners
          saveError={saveError}
          compact
        />
      </div>
      <div className="stage-section consent-hero-block" style={{ "--section-index": 2 }}>
        <h2 className="consent-title">{CONSENT_CONTENT.title}</h2>
        <p className="page-subtitle left no-bottom-margin">
          {CONSENT_CONTENT.subtitle}
        </p>
      </div>
      
      <div className="welcome-info consent-content parallax-soft stage-section" style={{ "--section-index": 3 }}>
        <div className={`consent-body ${showFullConsent ? "expanded" : "collapsed"}`}>
          {CONSENT_CONTENT.sections.map((section) => (
            <React.Fragment key={section.heading}>
              <h3>{section.heading}</h3>
              {section.intro && <p>{section.intro}</p>}
              {section.paragraphs?.map((paragraph) => (
                <p key={paragraph}>
                  {paragraph.startsWith(uiText("consent.estimatedDurationPrefix"))
                    ? (
                      <>
                        <strong>{uiText("consent.estimatedDurationPrefix")}</strong>{" "}
                        {paragraph.replace(`${uiText("consent.estimatedDurationPrefix")} `, "")}
                      </>
                    )
                    : paragraph}
                </p>
              ))}
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
                <p><strong>{uiText("consent.emailLabel")}</strong> <a href={`mailto:${section.contactEmail}`}>{section.contactEmail}</a></p>
              ) : null}
              {section.outro && <p>{section.outro}</p>}
            </React.Fragment>
          ))}
          {!showFullConsent && <div className="consent-fade" aria-hidden="true" />}
        </div>
        <div className="consent-toggle">
          <button
            type="button"
            className="consent-toggle-text"
            onClick={() => setShowFullConsent((prev) => !prev)}
          >
            {showFullConsent ? uiText("consent.readLess") : uiText("consent.readMore")}
          </button>
        </div>
      </div>
      
      {error && (
        <div className="stage-section" style={{ "--section-index": 4 }}>
          <PanelState
            variant="warning"
            title={CONSENT_CONTENT.actionRequiredTitle}
            message={error}
            icon="!"
          />
        </div>
      )}
      
      <div className={`consent-checkbox parallax-soft stage-section ${error && !consentChecked ? 'error' : ''}`} style={{ "--section-index": 5 }}>
        <input
          type="checkbox"
          checked={consentChecked}
          onChange={(e) => {
            setConsentChecked(e.target.checked);
            if (error) setError(null);
          }}
          id="consent-check"
        />
        <label htmlFor="consent-check">
          <strong>{CONSENT_CONTENT.checkboxTitle}</strong>
          <p className="consent-note">
            {CONSENT_CONTENT.checkboxNote}
          </p>
          {!consentChecked && (
            <span className="helper-text warning">{uiText("consent.requiredHint")}</span>
          )}
        </label>
      </div>
      
      <div className="stage-section consent-actions" style={{ "--section-index": 6 }}>
        <PageActions
          sticky
          className={`survey-submit-actions survey-sticky-footer ${submitting ? "is-submitting" : ""}`}
        >
          <DSButton
            className={`primary survey-submit-button ${submitting ? "wiggle is-submitting" : ""}`}
            onClick={handleSubmit}
            disabled={!systemReady || submitting || !consentChecked}
          >
            {submitting ? (
              <>
                <span className="button-spinner" aria-hidden="true" />
                <span>{uiText("common.processing")}</span>
              </>
            ) : uiText("common.continue")}
          </DSButton>
        </PageActions>
      </div>
    </div>
  );
}
