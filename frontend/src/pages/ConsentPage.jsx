import React, { useState } from "react";
import PageSkeleton from "../components/PageSkeleton.jsx";
import PanelState from "../components/PanelState.jsx";
import { useConsentPage } from "../hooks/useConsentPage";
import { uiText } from "../utils/uiText.js";
import { CONSENT_CONTENT } from "../content/consentContent";
import DSButton from "../components/design/DSButton.jsx";
import PageStatusBanners from "../components/PageStatusBanners.jsx";
import ButtonRetryBadge from "../components/ButtonRetryBadge.jsx";
import PageActions from "../components/PageActions.jsx";

export default function ConsentPage({ 
  publicId,
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
    isOnline,
    handleSubmit,
    draftRestored,
    saveError,
    retryCountdown,
  } = useConsentPage({ publicId, consentGiven, onConsentGiven, systemReady });

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
    <div className="panel panel-with-corner-status">
      <div className="page-top-actions">
        <div className="page-top-banners" />
      </div>
      <PageStatusBanners
        isOnline={isOnline}
        offlineMessage={uiText("consent.offlineBanner")}
        draftRestored={draftRestored}
        saveError={saveError}
        compact
      />
      <h2 className="consent-title">{CONSENT_CONTENT.title}</h2>
      <p className="page-subtitle left no-bottom-margin">
        {CONSENT_CONTENT.subtitle}
      </p>
      
      <div className="welcome-info consent-content">
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
          {!consentChecked && (
            <span className="helper-text warning">{uiText("consent.requiredHint")}</span>
          )}
        </label>
      </div>
      
      <PageActions sticky>
        <DSButton
          className="primary"
          onClick={handleSubmit}
          disabled={!systemReady || submitting || !consentChecked || !isOnline}
        >
          {submitting
            ? uiText("common.processing")
            : !isOnline && retryCountdown > 0
              ? uiText("common.tryAgainIn", { seconds: retryCountdown })
              : !isOnline
                ? uiText("consent.offlineSubmit")
                : uiText("common.continue")}
          {!isOnline && <ButtonRetryBadge seconds={retryCountdown} />}
        </DSButton>
        {!isOnline && (
          <div className="helper-text">
            {retryCountdown > 0
              ? uiText("common.tryAgainIn", { seconds: retryCountdown })
              : uiText("consent.offlineBanner")}
          </div>
        )}
      </PageActions>
    </div>
  );
}
