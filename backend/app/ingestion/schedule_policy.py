"""Small, bounded source schedule grammar for the opt-in single-worker runner."""

from __future__ import annotations

import re
from datetime import timedelta

INTERVAL_PATTERN = re.compile(r"every ([1-9][0-9]*)([hd])\Z")


def schedule_interval(value: str | None) -> timedelta | None:
    """Return an interval, or None for sources that must remain manual-only."""
    if value is None or value.strip().casefold() == "manual":
        return None
    normalized = value.strip().casefold()
    if normalized == "daily":
        return timedelta(days=1)
    match = INTERVAL_PATTERN.fullmatch(normalized)
    if match is None:
        raise ValueError("schedule must be manual, daily, or every Nh/Nd")
    count, unit = int(match.group(1)), match.group(2)
    if count > (168 if unit == "h" else 7):
        raise ValueError("schedule interval must be between 1 hour and 7 days")
    interval = timedelta(hours=count) if unit == "h" else timedelta(days=count)
    if not timedelta(hours=1) <= interval <= timedelta(days=7):
        raise ValueError("schedule interval must be between 1 hour and 7 days")
    return interval
