import React from "react";
import { APP_STAGE_ORDER } from "../config/appFlow";
import { uiText } from "../utils/uiText";

const STEP_LABELS = {
  "consent": "step.consent",
  "user-details": "step.details",
  "payment": "step.payment",
  "survey": "step.survey",
  "finished": "step.done",
};

export default function FlowStepper({ stage }) {
  const currentIndex = Math.max(0, APP_STAGE_ORDER.indexOf(stage));

  return (
    <div className="flow-stepper-wrap" aria-label="Progress">
      <div className="flow-stepper">
        {APP_STAGE_ORDER.map((key, index) => {
          const state = index < currentIndex ? "done" : index === currentIndex ? "active" : "upcoming";
          const labelKey = STEP_LABELS[key] || key;
          return (
            <div key={key} className={`flow-step ${state}`} aria-current={state === "active" ? "step" : undefined}>
              <div className="flow-step-index">{index + 1}</div>
              <div className="flow-step-label">{uiText(labelKey)}</div>
            </div>
          );
        })}
      </div>
      <div className="flow-stepper-hint">{uiText("step.scrollHint")}</div>
    </div>
  );
}
