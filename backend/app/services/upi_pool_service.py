"""UPI pool allocation service with per-UPI limits and cooldown logic."""

from __future__ import annotations

import json
import random
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
from typing import Iterable

from sqlalchemy import text

from app.config import (
    UPI_PER_UPI_LIMIT,
    UPI_USER_LIMIT,
    UPI_COOLDOWN_SECONDS,
    UPI_FAILURE_DECAY_SECONDS,
    UPI_BURST_RESET_SECONDS,
    UPI_COOLDOWN_CAPACITY_FACTOR,
    UPI_TIE_SCORE_THRESHOLD,
    PAYMENT_SCREENSHOT_TIMEZONE,
)


STATUS_ACTIVE = "ACTIVE"
STATUS_COOLDOWN = "COOLDOWN"
STATUS_DISABLED = "DISABLED"

RESULT_STATUS_SUCCESS = "SUCCESS"
RESULT_STATUS_FAILURE = "FAILURE"
RESULT_REASON_LIMIT_REPORTED = "LIMIT_REPORTED"


QUERY_FETCH_ACTIVE_UPI_ACCOUNTS = text("""
    SELECT id, vpa, name, is_active
    FROM upi_accounts
    WHERE is_active = TRUE
    ORDER BY id ASC
""")


QUERY_INSERT_DAILY_STATS = text("""
    INSERT INTO upi_daily_stats (
        upi_id, stats_date, attempts_today, failures_today, recent_failures,
        consecutive_failures, last_failure_time, last_1min_attempts,
        last_burst_reset, cooldown_until, status
    ) VALUES (
        :upi_id, :stats_date, 0, 0, 0,
        0, NULL, 0,
        :now_ts, NULL, :status
    )
    ON CONFLICT (upi_id, stats_date) DO NOTHING
""")

QUERY_FETCH_DAILY_STATS = text("""
    SELECT s.upi_id, a.vpa, a.name, a.is_active, s.attempts_today, s.failures_today,
           s.recent_failures, s.consecutive_failures, s.last_failure_time,
           s.last_1min_attempts, s.last_burst_reset, s.cooldown_until, s.status
    FROM upi_daily_stats s
    JOIN upi_accounts a ON a.id = s.upi_id
    WHERE s.stats_date = :stats_date
      AND a.is_active = TRUE
    FOR UPDATE
""")

QUERY_FETCH_SINGLE_DAILY_STAT = text("""
    SELECT s.upi_id, s.attempts_today, s.failures_today, s.recent_failures,
           s.consecutive_failures, s.last_failure_time, s.last_1min_attempts,
           s.last_burst_reset, s.cooldown_until, s.status
    FROM upi_daily_stats s
    WHERE s.stats_date = :stats_date
      AND s.upi_id = :upi_id
    FOR UPDATE
""")

QUERY_INIT_GLOBAL_DAILY = text("""
    INSERT INTO upi_global_daily (stats_date, attempts_today)
    VALUES (:stats_date, 0)
    ON CONFLICT (stats_date) DO NOTHING
""")

QUERY_FETCH_GLOBAL_DAILY = text("""
    SELECT attempts_today
    FROM upi_global_daily
    WHERE stats_date = :stats_date
    FOR UPDATE
""")

QUERY_INIT_USER_DAILY = text("""
    INSERT INTO upi_user_daily_attempts (stats_date, user_key, attempts)
    VALUES (:stats_date, :user_key, 0)
    ON CONFLICT (stats_date, user_key) DO NOTHING
""")

QUERY_FETCH_USER_DAILY = text("""
    SELECT attempts
    FROM upi_user_daily_attempts
    WHERE stats_date = :stats_date AND user_key = :user_key
    FOR UPDATE
""")

QUERY_INIT_SESSION_DAILY = text("""
    INSERT INTO upi_session_daily_attempts (stats_date, session_id, attempts)
    VALUES (:stats_date, :session_id, 0)
    ON CONFLICT (stats_date, session_id) DO NOTHING
""")

QUERY_FETCH_SESSION_DAILY = text("""
    SELECT attempts
    FROM upi_session_daily_attempts
    WHERE stats_date = :stats_date AND session_id = :session_id
    FOR UPDATE
""")

QUERY_UPDATE_DAILY_STATS = text("""
    UPDATE upi_daily_stats
    SET attempts_today = :attempts_today,
        failures_today = :failures_today,
        recent_failures = :recent_failures,
        consecutive_failures = :consecutive_failures,
        last_failure_time = :last_failure_time,
        last_1min_attempts = :last_1min_attempts,
        last_burst_reset = :last_burst_reset,
        cooldown_until = :cooldown_until,
        status = :status
    WHERE upi_id = :upi_id AND stats_date = :stats_date
""")

QUERY_UPDATE_GLOBAL_DAILY = text("""
    UPDATE upi_global_daily
    SET attempts_today = :attempts_today
    WHERE stats_date = :stats_date
""")

QUERY_UPDATE_USER_DAILY = text("""
    UPDATE upi_user_daily_attempts
    SET attempts = :attempts
    WHERE stats_date = :stats_date AND user_key = :user_key
""")

QUERY_UPDATE_SESSION_DAILY = text("""
    UPDATE upi_session_daily_attempts
    SET attempts = :attempts
    WHERE stats_date = :stats_date AND session_id = :session_id
""")

QUERY_FETCH_USED_UPIS_FOR_PARTICIPANT = text("""
    SELECT DISTINCT p.upi_account_id
    FROM payments p
    WHERE p.participant_id = :pid
      AND p.upi_account_id IS NOT NULL
      AND p.created_at >= :day_start
      AND p.created_at < :day_end
""")

QUERY_FETCH_PAYMENT_UPI = text("""
    SELECT upi_account_id, created_at, metadata
    FROM payments
    WHERE id = :pid
    FOR UPDATE
""")

QUERY_UPDATE_PAYMENT_METADATA = text("""
    UPDATE payments
    SET metadata = COALESCE(metadata, '{}'::jsonb) || CAST(:patch AS jsonb)
    WHERE id = :pid
""")


def _local_day_bounds(now_utc: datetime):
    tz = ZoneInfo(PAYMENT_SCREENSHOT_TIMEZONE)
    local_now = now_utc.astimezone(tz)
    local_date = local_now.date()
    day_start = datetime.combine(local_date, datetime.min.time(), tzinfo=tz).astimezone(timezone.utc)
    day_end = day_start + timedelta(days=1)
    return local_date, day_start, day_end


def _ensure_upi_accounts(db):
    # DB-driven: add/remove UPI accounts by editing the `upi_accounts` table.
    rows = db.execute(QUERY_FETCH_ACTIVE_UPI_ACCOUNTS).fetchall()
    return [
        {
            "id": int(row[0]),
            "vpa": str(row[1]),
            "name": str(row[2]),
            "is_active": bool(row[3]),
        }
        for row in rows
        if row
    ]


def fetch_used_upis_for_participant(db, *, participant_id: int, now_utc: datetime):
    _local_date, day_start, day_end = _local_day_bounds(now_utc)
    rows = db.execute(QUERY_FETCH_USED_UPIS_FOR_PARTICIPANT, {
        "pid": int(participant_id),
        "day_start": day_start,
        "day_end": day_end,
    }).fetchall()
    return {int(row[0]) for row in rows if row and row[0] is not None}


def select_upi_for_payment(
    db,
    *,
    user_key: str,
    session_id: str,
    used_upis: Iterable[int] | None = None,
    allow_used_fallback: bool = True,
):
    now = datetime.now(timezone.utc)
    local_date, _day_start, _day_end = _local_day_bounds(now)

    accounts = _ensure_upi_accounts(db)
    if not accounts:
        return {"status": "MAINTENANCE"}

    db.execute(QUERY_INIT_GLOBAL_DAILY, {"stats_date": local_date})
    if user_key:
        db.execute(QUERY_INIT_USER_DAILY, {"stats_date": local_date, "user_key": user_key})
    if session_id:
        db.execute(QUERY_INIT_SESSION_DAILY, {"stats_date": local_date, "session_id": session_id})

    for account in accounts:
        db.execute(QUERY_INSERT_DAILY_STATS, {
            "upi_id": account["id"],
            "stats_date": local_date,
            "now_ts": now,
            "status": STATUS_ACTIVE,
        })

    global_row = db.execute(QUERY_FETCH_GLOBAL_DAILY, {"stats_date": local_date}).fetchone()
    user_row = db.execute(QUERY_FETCH_USER_DAILY, {"stats_date": local_date, "user_key": user_key}).fetchone() if user_key else None
    session_row = db.execute(QUERY_FETCH_SESSION_DAILY, {"stats_date": local_date, "session_id": session_id}).fetchone() if session_id else None

    global_attempts_today = int(global_row[0]) if global_row else 0
    user_attempts_today = int(user_row[0]) if user_row else 0
    session_attempts_today = int(session_row[0]) if session_row else 0

    used_upi_set = set(used_upis or [])

    stats_rows = db.execute(QUERY_FETCH_DAILY_STATS, {"stats_date": local_date}).fetchall()
    if not stats_rows:
        return {"status": "MAINTENANCE"}

    dynamic_limit = 0.0
    stats = []
    for row in stats_rows:
        s = {
            "upi_id": int(row[0]),
            "vpa": str(row[1]),
            "name": str(row[2]),
            "is_active": bool(row[3]),
            "attempts_today": int(row[4] or 0),
            "failures_today": int(row[5] or 0),
            "recent_failures": int(row[6] or 0),
            "consecutive_failures": int(row[7] or 0),
            "last_failure_time": row[8],
            "last_1min_attempts": int(row[9] or 0),
            "last_burst_reset": row[10],
            "cooldown_until": row[11],
            "status": str(row[12]) if row[12] else STATUS_ACTIVE,
            "touched": False,
        }

        if s["status"] == STATUS_ACTIVE:
            dynamic_limit += UPI_PER_UPI_LIMIT
        elif s["status"] == STATUS_COOLDOWN:
            if s["cooldown_until"] and now >= s["cooldown_until"]:
                dynamic_limit += UPI_PER_UPI_LIMIT
            else:
                dynamic_limit += UPI_PER_UPI_LIMIT * float(UPI_COOLDOWN_CAPACITY_FACTOR)
        stats.append(s)

    max_capacity = len(stats) * UPI_PER_UPI_LIMIT
    dynamic_limit = min(dynamic_limit, float(max_capacity))

    if global_attempts_today >= dynamic_limit:
        return {"status": "MAINTENANCE"}
    if user_key and user_attempts_today >= UPI_USER_LIMIT:
        return {"status": "USER_LIMIT_EXCEEDED"}
    if session_id and session_attempts_today >= UPI_USER_LIMIT:
        return {"status": "SESSION_LIMIT_EXCEEDED"}

    eligible = []
    fallback_used = False

    for s in stats:
        if s["last_burst_reset"] is None or (now - s["last_burst_reset"]).total_seconds() > UPI_BURST_RESET_SECONDS:
            s["last_1min_attempts"] = 0
            s["last_burst_reset"] = now
            s["touched"] = True

        if s["status"] == STATUS_COOLDOWN and s["cooldown_until"] and now >= s["cooldown_until"]:
            s["status"] = STATUS_ACTIVE
            s["touched"] = True

        if s["status"] == STATUS_DISABLED:
            continue
        if s["attempts_today"] >= UPI_PER_UPI_LIMIT:
            continue
        if s["status"] == STATUS_COOLDOWN and s["cooldown_until"] and now < s["cooldown_until"]:
            continue
        if s["upi_id"] in used_upi_set:
            continue

        if s["last_failure_time"] and (now - s["last_failure_time"]).total_seconds() > UPI_FAILURE_DECAY_SECONDS:
            s["recent_failures"] = 0
            s["consecutive_failures"] = 0
            s["touched"] = True

        eligible.append(s)

    if not eligible and allow_used_fallback:
        fallback_used = True
        for s in stats:
            if s["status"] == STATUS_ACTIVE and s["attempts_today"] < UPI_PER_UPI_LIMIT:
                eligible.append(s)

    if not eligible and not allow_used_fallback:
        return {"status": "NO_ALTERNATE_UPI"}

    if not eligible:
        return {"status": "MAINTENANCE"}

    best_score = None
    candidates = []
    for s in eligible:
        normalized_load = s["attempts_today"] / float(UPI_PER_UPI_LIMIT)
        failure_penalty = s["recent_failures"] * 3
        burst_penalty = s["last_1min_attempts"] * 2
        predictive_penalty = normalized_load * 5
        score = s["attempts_today"] + failure_penalty + burst_penalty + predictive_penalty

        if best_score is None or score < best_score:
            best_score = score
            candidates = [s]
        elif abs(score - best_score) <= UPI_TIE_SCORE_THRESHOLD:
            candidates.append(s)

    selected = random.choice(candidates) if len(candidates) > 1 else candidates[0]

    selected["attempts_today"] += 1
    selected["last_1min_attempts"] += 1
    selected["touched"] = True

    global_attempts_today += 1
    user_attempts_today += 1
    session_attempts_today += 1

    for s in stats:
        if s["touched"]:
            db.execute(QUERY_UPDATE_DAILY_STATS, {
                "upi_id": s["upi_id"],
                "stats_date": local_date,
                "attempts_today": s["attempts_today"],
                "failures_today": s["failures_today"],
                "recent_failures": s["recent_failures"],
                "consecutive_failures": s["consecutive_failures"],
                "last_failure_time": s["last_failure_time"],
                "last_1min_attempts": s["last_1min_attempts"],
                "last_burst_reset": s["last_burst_reset"],
                "cooldown_until": s["cooldown_until"],
                "status": s["status"],
            })

    db.execute(QUERY_UPDATE_GLOBAL_DAILY, {"stats_date": local_date, "attempts_today": global_attempts_today})
    if user_key:
        db.execute(QUERY_UPDATE_USER_DAILY, {
            "stats_date": local_date,
            "user_key": user_key,
            "attempts": user_attempts_today,
        })
    if session_id:
        db.execute(QUERY_UPDATE_SESSION_DAILY, {
            "stats_date": local_date,
            "session_id": session_id,
            "attempts": session_attempts_today,
        })

    return {
        "status": "OK",
        "upi_account_id": selected["upi_id"],
        "upi_vpa": selected["vpa"],
        "upi_name": selected["name"],
        "fallback_used": fallback_used,
    }


def record_upi_result(db, *, payment_id: int, result_status: str, result_reason: str | None = None):
    now = datetime.now(timezone.utc)
    payment_row = db.execute(QUERY_FETCH_PAYMENT_UPI, {"pid": int(payment_id)}).fetchone()
    if not payment_row:
        return
    upi_account_id, created_at, metadata = payment_row
    if not upi_account_id or not created_at:
        return

    meta = metadata or {}
    if isinstance(meta, str):
        try:
            meta = json.loads(meta)
        except Exception:
            meta = {}

    reason_key = str(result_reason or "").strip().upper()
    marker_key = "upi_result_recorded"
    if reason_key == RESULT_REASON_LIMIT_REPORTED:
        marker_key = "upi_limit_reported"

    if meta.get(marker_key):
        return

    local_date, _day_start, _day_end = _local_day_bounds(created_at if created_at.tzinfo else created_at.replace(tzinfo=timezone.utc))

    db.execute(QUERY_INSERT_DAILY_STATS, {
        "upi_id": int(upi_account_id),
        "stats_date": local_date,
        "now_ts": now,
        "status": STATUS_ACTIVE,
    })
    row = db.execute(QUERY_FETCH_SINGLE_DAILY_STAT, {
        "stats_date": local_date,
        "upi_id": int(upi_account_id),
    }).fetchone()
    stat = None
    if row:
        stat = {
            "upi_id": int(row[0]),
            "attempts_today": int(row[1] or 0),
            "failures_today": int(row[2] or 0),
            "recent_failures": int(row[3] or 0),
            "consecutive_failures": int(row[4] or 0),
            "last_failure_time": row[5],
            "last_1min_attempts": int(row[6] or 0),
            "last_burst_reset": row[7],
            "cooldown_until": row[8],
            "status": str(row[9]) if row[9] else STATUS_ACTIVE,
        }
    if not stat:
        return

    if result_status == RESULT_STATUS_FAILURE:
        is_limit_reported = reason_key == RESULT_REASON_LIMIT_REPORTED
        stat["failures_today"] += 1
        stat["recent_failures"] += 2 if is_limit_reported else 1
        stat["consecutive_failures"] += 1
        stat["last_failure_time"] = now
        if stat["consecutive_failures"] >= 2:
            stat["status"] = STATUS_DISABLED
        elif stat["recent_failures"] >= 1:
            stat["status"] = STATUS_COOLDOWN
            stat["cooldown_until"] = now + timedelta(seconds=UPI_COOLDOWN_SECONDS)
            stat["recent_failures"] = 0
    else:
        stat["recent_failures"] = 0
        stat["consecutive_failures"] = 0
        if stat["status"] == STATUS_COOLDOWN:
            stat["status"] = STATUS_ACTIVE

    db.execute(QUERY_UPDATE_DAILY_STATS, {
        "upi_id": stat["upi_id"],
        "stats_date": local_date,
        "attempts_today": stat["attempts_today"],
        "failures_today": stat["failures_today"],
        "recent_failures": stat["recent_failures"],
        "consecutive_failures": stat["consecutive_failures"],
        "last_failure_time": stat["last_failure_time"],
        "last_1min_attempts": stat["last_1min_attempts"],
        "last_burst_reset": stat["last_burst_reset"],
        "cooldown_until": stat["cooldown_until"],
        "status": stat["status"],
    })

    db.execute(QUERY_UPDATE_PAYMENT_METADATA, {
        "pid": int(payment_id),
        "patch": json.dumps({
            marker_key: True,
            "upi_result_status": str(result_status or "").upper(),
            "upi_result_reason": reason_key or None,
        }),
    })
