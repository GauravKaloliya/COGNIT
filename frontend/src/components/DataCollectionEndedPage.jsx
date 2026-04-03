import React from "react";
import ThemeToggleIcon from "./ThemeToggleIcon.jsx";
import DSButton from "./design/DSButton.jsx";
import TypewriterSubtitle from "./TypewriterSubtitle.jsx";
import { useIsMobile } from "../hooks/useIsMobile.js";
import { uiText } from "../utils/uiText.js";

export default function DataCollectionEndedPage({
  darkMode = false,
  onToggleDarkMode,
  endedAtLabel = "",
}) {
  const isMobile = useIsMobile();
  const closureDetails = React.useMemo(() => ([
    {
      title: uiText("collectionEnded.summaryCard1Title"),
      description: uiText("collectionEnded.summaryCard1Description"),
    },
    {
      title: uiText("collectionEnded.summaryCard2Title"),
      description: uiText("collectionEnded.summaryCard2Description"),
    },
    {
      title: uiText("collectionEnded.summaryCard3Title"),
      description: uiText("collectionEnded.summaryCard3Description"),
    },
  ]), []);
  const nextSteps = React.useMemo(() => ([
    {
      title: uiText("collectionEnded.item1Title"),
      description: uiText("collectionEnded.item1Description"),
    },
    {
      title: uiText("collectionEnded.item2Title"),
      description: uiText("collectionEnded.item2Description"),
    },
    {
      title: uiText("collectionEnded.item3Title"),
      description: uiText("collectionEnded.item3Description"),
    },
    {
      title: uiText("collectionEnded.item4Title"),
      description: uiText("collectionEnded.item4Description"),
    },
  ]), []);
  const researchNotes = React.useMemo(() => ([
    uiText("collectionEnded.researchItem1"),
    uiText("collectionEnded.researchItem2"),
    uiText("collectionEnded.researchItem3"),
    uiText("collectionEnded.researchItem4"),
  ]), []);

  React.useEffect(() => {
    document.title = uiText("collectionEnded.documentTitle");
  }, []);

  return (
    <div className="app error-page-centered">
      <header className="header">
        <div className="brand">
          <h1>{uiText("app.brand")}</h1>
          {!isMobile && <TypewriterSubtitle text={uiText("collectionEnded.subtitle")} />}
        </div>
        <div className="header-actions">
          <DSButton
            variant="ghost"
            className="dark-mode-toggle"
            onClick={onToggleDarkMode}
            title={darkMode ? uiText("app.darkModeLight") : uiText("app.darkModeDark")}
          >
            <ThemeToggleIcon darkMode={darkMode} />
          </DSButton>
        </div>
      </header>

      <div className="panel finish-panel collection-ended-panel">
        <div className="finish-wrapper guidance collection-ended-shell">
          <section className="page-hero collection-ended-hero" aria-labelledby="collection-ended-title">
            <div className="collection-ended-hero-glow" aria-hidden="true" />
            <div className="collection-ended-hero-copy">
              <span className="status-badge warning collection-ended-badge">
                {uiText("collectionEnded.badge")}
              </span>
              <p className="collection-ended-kicker">{uiText("collectionEnded.kicker")}</p>
              <h2 id="collection-ended-title">{uiText("collectionEnded.title")}</h2>
              <p className="page-subtitle collection-ended-subtitle">
                {uiText("collectionEnded.heroIntro")}
              </p>
              <div className="collection-ended-meta" role="list" aria-label={uiText("collectionEnded.metaAriaLabel")}>
                <span role="listitem">
                  {uiText("collectionEnded.endedAt", {
                    endedAt: endedAtLabel || uiText("collectionEnded.defaultEndedAt"),
                  })}
                </span>
                <span role="listitem">{uiText("collectionEnded.metaStatus")}</span>
                <span role="listitem">{uiText("collectionEnded.metaStudy")}</span>
              </div>
            </div>
          </section>

          <section className="collection-ended-summary-grid" aria-label={uiText("collectionEnded.summaryAriaLabel")}>
            {closureDetails.map((item, index) => (
              <article key={item.title} className="collection-ended-summary-card">
                <span className="collection-ended-summary-index" aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div className="collection-ended-summary-body">
                  <strong>{item.title}</strong>
                  <p>{item.description}</p>
                </div>
              </article>
            ))}
          </section>

          <section className="report-explainer collection-ended-report" aria-labelledby="collection-ended-next-steps">
            <div className="report-explainer-masthead">
              <div className="report-explainer-kicker">{uiText("collectionEnded.whatNowKicker")}</div>
              <div className="report-explainer-meta">
                <span>{uiText("collectionEnded.whatNowMeta1")}</span>
                <span>{uiText("collectionEnded.whatNowMeta2")}</span>
                <span>{uiText("collectionEnded.whatNowMeta3")}</span>
              </div>
            </div>
            <div className="report-explainer-header">
              <div>
                <span className="status-badge met">{uiText("collectionEnded.whatNowBadge")}</span>
                <h3 id="collection-ended-next-steps">{uiText("collectionEnded.whatNowTitle")}</h3>
              </div>
              <p className="report-explainer-intro">{uiText("collectionEnded.whatNowIntro")}</p>
            </div>
            <ol className="report-explainer-list">
              {nextSteps.map((item, index) => (
                <li key={item.title} className="report-explainer-item">
                  <div className="report-explainer-index" aria-hidden="true">
                    {String(index + 1).padStart(2, "0")}
                  </div>
                  <div className="report-explainer-body">
                    <strong>{item.title}</strong>
                    <span>{item.description}</span>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section className="privacy-explainer collection-ended-privacy" aria-labelledby="collection-ended-research">
            <div className="privacy-explainer-header">
              <span className="status-badge met">{uiText("collectionEnded.researchBadge")}</span>
              <h3 id="collection-ended-research">{uiText("collectionEnded.researchTitle")}</h3>
            </div>
            <p className="privacy-explainer-intro">{uiText("collectionEnded.researchIntro")}</p>
            <ul className="privacy-explainer-list">
              {researchNotes.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>

          <p className="debrief collection-ended-note">{uiText("collectionEnded.thanks")}</p>
        </div>
      </div>

      <div className="branding-footer">{uiText("app.footerCredit")}</div>
    </div>
  );
}
