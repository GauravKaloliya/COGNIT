import { TOAST_VARIANTS } from "./ui";

export const PANEL_STATE_VARIANTS = {
  info: TOAST_VARIANTS.info,
  success: TOAST_VARIANTS.success,
  warning: TOAST_VARIANTS.warning,
  error: TOAST_VARIANTS.error,
};

export const PANEL_STATE_ICONS = {
  [PANEL_STATE_VARIANTS.info]: "i",
  [PANEL_STATE_VARIANTS.success]: "✓",
  [PANEL_STATE_VARIANTS.warning]: "!",
  [PANEL_STATE_VARIANTS.error]: "×",
  notFound: "404",
};

export const BUTTON_VARIANTS = {
  primary: "primary",
  ghost: "ghost",
};

export const CLASS_NAMES = {
  panelState: "panel-state",
  panelStateIcon: "panel-state-icon",
  panelStateActions: "panel-state-actions",
  wide: "wide",
  dense: "dense",
};
