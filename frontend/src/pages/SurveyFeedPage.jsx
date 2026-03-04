import React from "react";
import PageSkeleton from "../components/PageSkeleton.jsx";
import PanelState from "../components/PanelState.jsx";

const MIN_WORDS = parseInt(import.meta.env.VITE_MIN_WORDS || "60", 10);

export default function SurveyFeedPage({
  surveyCompleted = 0,
  setSurveyFeedbackReady,
  setStage,
  fetchNextSurvey,
}) {
  const [loadingNext, setLoadingNext] = React.useState(false);
  const [continueError, setContinueError] = React.useState("");

  const handleSurveyContinue = async () => {
    if (loadingNext) return;
    setLoadingNext(true);
    setContinueError("");
    setSurveyFeedbackReady(false);
    const data = await fetchNextSurvey({ clearCurrent: true });
    if (!data?.image_id) {
      setSurveyFeedbackReady(true);
      setContinueError("Failed to load the next survey image. Please retry.");
    }
    setLoadingNext(false);
  };

  const handleSurveyFinish = () => {
    setSurveyFeedbackReady(false);
    setStage("finished");
  };

  if (loadingNext) {
    return (
      <PageSkeleton
        title="Loading next survey"
        subtitle="Selecting the next image and preparing your form"
        variant="survey"
      />
    );
  }

  return (
    <div className="panel survey-feed-panel">
      <div className="guidance">
        <PanelState
          variant="success"
          icon="✓"
          title="Survey Complete"
          message={`You have completed ${surveyCompleted} survey${surveyCompleted === 1 ? "" : "s"}. Continue for more or finish now.`}
        />
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
            disabled={loadingNext}
          >
            {loadingNext ? "Loading..." : "Continue Survey"}
          </button>
          <button
            className="ghost survey-feedback-finish"
            onClick={handleSurveyFinish}
            disabled={loadingNext}
          >
            Finish
          </button>
        </div>
        {continueError && (
          <PanelState
            variant="warning"
            title="Unable to load next survey"
            message={`${continueError} Check connection and tap retry.`}
            actionLabel="Retry"
            onAction={handleSurveyContinue}
            disabled={loadingNext}
          />
        )}
      </div>
    </div>
  );
}
