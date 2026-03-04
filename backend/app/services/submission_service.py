from typing import Dict, Any


def safe_non_negative_int(value, default: int = 0) -> int:
    try:
        parsed = int(value)
        return parsed if parsed >= 0 else default
    except Exception:
        return default


def clamp_time_spent_seconds(value) -> float:
    if value is None:
        return 0.0
    try:
        parsed = float(value)
        return parsed if parsed >= 0 else 0.0
    except Exception:
        return 0.0


def normalize_engagement_counts(payload: Dict[str, Any], fallback: Dict[str, Any] = None) -> Dict[str, int]:
    fallback = fallback or {}
    tab_switch_count = safe_non_negative_int(payload.get("tab_switch_count"), 0)
    page_close_attempts = safe_non_negative_int(payload.get("page_close_attempts"), 0)
    network_disconnects = safe_non_negative_int(payload.get("network_disconnects"), 0)

    if tab_switch_count == 0 and page_close_attempts == 0 and network_disconnects == 0:
        tab_switch_count = safe_non_negative_int(fallback.get("tab_switches"), 0)
        page_close_attempts = safe_non_negative_int(fallback.get("page_close_attempts"), 0)
        network_disconnects = safe_non_negative_int(fallback.get("network_disconnects"), 0)

    return {
        "tab_switch_count": tab_switch_count,
        "page_close_attempts": page_close_attempts,
        "network_disconnects": network_disconnects,
    }


def dynamic_too_fast_threshold(base_threshold: float, word_count: int) -> float:
    return max(float(base_threshold), min(90.0, max(8.0, int(word_count) * 0.35)))
