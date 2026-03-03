import React from "react";

const MIN_WORDS = parseInt(import.meta.env.VITE_MIN_WORDS || "60", 10);

export default function SurveyFeedPage({
  surveyCompleted = 0,
  setSurveyFeedbackReady,
  setStage,
  fetchNextSurvey,
}) {
  const handleSurveyContinue = async () => {
    setSurveyFeedbackReady(false);
    await fetchNextSurvey({ clearCurrent: true });
  };

  const handleSurveyFinish = () => {
    setSurveyFeedbackReady(false);
    setStage("finished");
  };

  return (
    <div className="panel survey-feed-panel">
      <div className="guidance">
        <div className="survey-feedback-icon">
          ✓
        </div>
        <h2 className="survey-feedback-title">Survey Complete!</h2>
        <p className="survey-feedback-text">
          Great job on your survey! You have completed {surveyCompleted} survey
          {surveyCompleted === 1 ? '' : 's'}. You can now choose to continue with more survey
          images or finish the study.
        </p>
        <div className="survey-feedback-tip">
          <p>
            <em>Tip: Aim to describe colors, textures, relationships, and any notable objects.
            Remember to write at least {MIN_WORDS} words per description.</em>
          </p>
        </div>
        <div className="survey-feedback-actions">
          <button
            className="primary"
            onClick={handleSurveyContinue}
          >
            Continue Survey
          </button>
          <button
            className="ghost survey-feedback-finish"
            onClick={handleSurveyFinish}
          >
            Finish
          </button>
        </div>
      </div>
    </div>
  );
}
