import React from "react";
import { uiText } from "../utils/uiText";

const DISPLAY_STEPS = [
  { key: "consent", labelKey: "step.consent" },
  { key: "user-details", labelKey: "step.details" },
  { key: "survey-1", labelKey: "step.survey1" },
  { key: "survey-2", labelKey: "step.survey2" },
  { key: "post-survey", labelKey: "step.done" },
];

function getActiveStepKey(stage, surveyCompleted) {
  if (stage === "survey") {
    return Number(surveyCompleted) >= 1 ? "survey-2" : "survey-1";
  }
  return stage || "consent";
}

export default function FlowStepper({ stage, surveyCompleted = 0 }) {
  const activeStepKey = getActiveStepKey(stage, surveyCompleted);
  const currentIndex = Math.max(0, DISPLAY_STEPS.findIndex((step) => step.key === activeStepKey));
  const stepperRef = React.useRef(null);

  React.useEffect(() => {
    const el = stepperRef.current;
    if (!el) return;
    const active = el.querySelector('[aria-current="step"]');
    if (active && typeof active.scrollIntoView === "function") {
      active.scrollIntoView({ block: "nearest", inline: "center" });
    } else {
      el.scrollLeft = 0;
    }
  }, [activeStepKey]);

  return (
    <div className="flow-stepper-wrap" aria-label={uiText("common.progress")}>
      <div
        ref={stepperRef}
        className="flow-stepper"
        style={{ "--flow-step-count": DISPLAY_STEPS.length }}
      >
        {DISPLAY_STEPS.map(({ key, labelKey }, index) => {
          const state = index < currentIndex ? "done" : index === currentIndex ? "active" : "upcoming";
          return (
            <div
              key={key}
              className={`flow-step ${state}`}
              style={{ "--flow-step-index": index }}
              aria-current={state === "active" ? "step" : undefined}
            >
              <div className="flow-step-label">{uiText(labelKey)}</div>
            </div>
          );
        })}
      </div>
      <div className="flow-stepper-hint">{uiText("step.scrollHint")}</div>
    </div>
  );
}
