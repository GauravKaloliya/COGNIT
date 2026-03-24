import React from "react";
import { APP_STAGE_ORDER } from "../config/appFlow";
import { uiText } from "../utils/uiText";

const STEP_LABELS = {
  consent: "step.consent",
  "user-details": "step.details",
  survey: "step.survey",
  finished: "step.done",
};

export default function FlowStepper({ stage }) {
  const currentIndex = Math.max(0, APP_STAGE_ORDER.indexOf(stage));
  const stepperRef = React.useRef(null);

  React.useEffect(() => {
    const el = stepperRef.current;
    if (!el) return;
    const active = el.querySelector('[aria-current="step"]');
    if (active && typeof active.scrollIntoView === "function") {
      active.scrollIntoView({ block: "nearest", inline: "start" });
    } else {
      el.scrollLeft = 0;
    }
  }, [stage]);

  return (
    <div className="flow-stepper-wrap" aria-label={uiText("common.progress")}>
      <div
        ref={stepperRef}
        className="flow-stepper"
        style={{ "--flow-step-count": APP_STAGE_ORDER.length }}
      >
        {APP_STAGE_ORDER.map((key, index) => {
          const state = index < currentIndex ? "done" : index === currentIndex ? "active" : "upcoming";
          const labelKey = STEP_LABELS[key] || key;
          return (
            <div key={key} className={`flow-step ${state}`} aria-current={state === "active" ? "step" : undefined}>
              <div className="flow-step-label">{uiText(labelKey)}</div>
            </div>
          );
        })}
      </div>
      <div className="flow-stepper-hint">{uiText("step.scrollHint")}</div>
    </div>
  );
}
