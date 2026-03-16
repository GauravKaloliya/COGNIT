import { runtimeConfig } from "../config/runtime";

const TELEMETRY_KEY = runtimeConfig.storageKeys.telemetry;

function nowMs() {
  return Date.now();
}

function defaultState() {
  const now = nowMs();
  return {
    session_started_at_ms: now,
    current_page: "unknown",
    current_page_entered_at_ms: now,
    page_views: 0,
    tab_switches: 0,
    page_close_attempts: 0,
    network_disconnects: 0,
    max_scroll_depth_pct: 0,
    clicks: 0,
    keypresses: 0,
    survey_page_views: 0,
    survey_tab_switches: 0,
    survey_page_close_attempts: 0,
    survey_network_disconnects: 0,
    survey_max_scroll_depth_pct: 0,
    survey_clicks: 0,
    survey_keypresses: 0,
    survey_time_spent_ms: 0,
    page_time_spent_ms_by_page: {},
  };
}

function loadState() {
  try {
    const raw = sessionStorage.getItem(TELEMETRY_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return defaultState();
    return { ...defaultState(), ...parsed };
  } catch {
    return defaultState();
  }
}

function saveState(state) {
  try {
    sessionStorage.setItem(TELEMETRY_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage write failures.
  }
}

let telemetryState = loadState();

function isSurveyPage(pageName) {
  const page = String(pageName || "").toLowerCase();
  return page === "survey" || page.startsWith("survey-");
}

function _rollCurrentPageDuration() {
  const now = nowMs();
  const page = String(telemetryState.current_page || "unknown");
  const entered = Number(telemetryState.current_page_entered_at_ms || now);
  const delta = Math.max(0, now - entered);
  const prev = Number(telemetryState.page_time_spent_ms_by_page?.[page] || 0);
  telemetryState.page_time_spent_ms_by_page = {
    ...(telemetryState.page_time_spent_ms_by_page || {}),
    [page]: prev + delta,
  };
  if (isSurveyPage(page)) {
    telemetryState.survey_time_spent_ms = Number(telemetryState.survey_time_spent_ms || 0) + delta;
  }
  telemetryState.current_page_entered_at_ms = now;
}

export function telemetryPageView(pageName) {
  const page = String(pageName || "unknown");
  _rollCurrentPageDuration();
  telemetryState.current_page = page;
  telemetryState.page_views = Number(telemetryState.page_views || 0) + 1;
  if (isSurveyPage(page)) {
    telemetryState.survey_page_views = Number(telemetryState.survey_page_views || 0) + 1;
  }
  saveState(telemetryState);
}

export function telemetryIncrement(counterName) {
  if (!counterName) return;
  const key = String(counterName);
  telemetryState[key] = Number(telemetryState[key] || 0) + 1;
  const page = String(telemetryState.current_page || "");
  if (isSurveyPage(page)) {
    if (key === "tab_switches") {
      telemetryState.survey_tab_switches = Number(telemetryState.survey_tab_switches || 0) + 1;
    } else if (key === "page_close_attempts") {
      telemetryState.survey_page_close_attempts = Number(telemetryState.survey_page_close_attempts || 0) + 1;
    } else if (key === "network_disconnects") {
      telemetryState.survey_network_disconnects = Number(telemetryState.survey_network_disconnects || 0) + 1;
    }
  }
  saveState(telemetryState);
}

export function telemetryInteraction(kind) {
  const page = String(telemetryState.current_page || "");
  if (kind === "click") {
    telemetryState.clicks = Number(telemetryState.clicks || 0) + 1;
    if (isSurveyPage(page)) {
      telemetryState.survey_clicks = Number(telemetryState.survey_clicks || 0) + 1;
    }
  } else if (kind === "keypress") {
    telemetryState.keypresses = Number(telemetryState.keypresses || 0) + 1;
    if (isSurveyPage(page)) {
      telemetryState.survey_keypresses = Number(telemetryState.survey_keypresses || 0) + 1;
    }
  }
  saveState(telemetryState);
}

export function telemetryUpdateScrollDepth() {
  const doc = document.documentElement;
  const scrollTop = Math.max(window.scrollY || 0, doc?.scrollTop || 0);
  const scrollHeight = Math.max(1, (doc?.scrollHeight || 1) - (window.innerHeight || 0));
  const pct = Math.max(0, Math.min(100, Math.round((scrollTop / scrollHeight) * 100)));
  telemetryState.max_scroll_depth_pct = Math.max(Number(telemetryState.max_scroll_depth_pct || 0), pct);
  if (isSurveyPage(telemetryState.current_page)) {
    telemetryState.survey_max_scroll_depth_pct = Math.max(
      Number(telemetryState.survey_max_scroll_depth_pct || 0),
      pct
    );
  }
  saveState(telemetryState);
}

export function getTelemetrySnapshot(pageNameOverride) {
  _rollCurrentPageDuration();
  const now = nowMs();
  const currentPage = String(pageNameOverride || telemetryState.current_page || "unknown");
  const totalSiteTime = Math.max(0, now - Number(telemetryState.session_started_at_ms || now));
  const perPage = telemetryState.page_time_spent_ms_by_page || {};
  const currentPageTime = Number(perPage[currentPage] || 0);

  return {
    current_page: currentPage,
    current_page_time_spent_ms: currentPageTime,
    total_site_time_spent_ms: totalSiteTime,
    total_page_views: Number(telemetryState.page_views || 0),
    total_tab_switches: Number(telemetryState.tab_switches || 0),
    total_page_close_attempts: Number(telemetryState.page_close_attempts || 0),
    total_network_disconnects: Number(telemetryState.network_disconnects || 0),
    max_scroll_depth_pct: Number(telemetryState.max_scroll_depth_pct || 0),
    total_clicks: Number(telemetryState.clicks || 0),
    total_keypresses: Number(telemetryState.keypresses || 0),
    survey_time_spent_ms: Number(telemetryState.survey_time_spent_ms || 0),
    survey_page_views: Number(telemetryState.survey_page_views || 0),
    survey_tab_switches: Number(telemetryState.survey_tab_switches || 0),
    survey_page_close_attempts: Number(telemetryState.survey_page_close_attempts || 0),
    survey_network_disconnects: Number(telemetryState.survey_network_disconnects || 0),
    survey_max_scroll_depth_pct: Number(telemetryState.survey_max_scroll_depth_pct || 0),
    survey_clicks: Number(telemetryState.survey_clicks || 0),
    survey_keypresses: Number(telemetryState.survey_keypresses || 0),
  };
}
