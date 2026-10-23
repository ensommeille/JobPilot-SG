"""Finite interval schedules; no user-supplied cron expressions are executed."""

from datetime import UTC, datetime, timedelta

INTERVAL_HOURS = {"every:6h": 6, "every:24h": 24}


def normalize_schedule(value: str | None) -> str | None:
    normalized = value.strip() if value is not None else None
    if not normalized:
        return None
    if normalized != "manual" and normalized not in INTERVAL_HOURS:
        raise ValueError("schedule must be manual, every:6h or every:24h")
    return normalized


def utc_timestamp(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def next_attempt(schedule: str | None, *, enabled: bool, after: datetime) -> datetime | None:
    # Historical arbitrary cron strings stay readable and may be run manually.
    # Only the finite schedules accepted by today's API are ever made automatic.
    hours = INTERVAL_HOURS.get(schedule)
    return utc_timestamp(after) + timedelta(hours=hours) if enabled and hours is not None else None
