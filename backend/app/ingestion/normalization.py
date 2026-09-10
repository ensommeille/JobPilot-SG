"""Rule-first normalization and stable hash helpers."""

from __future__ import annotations

import hashlib
import re
import unicodedata
from datetime import date, datetime


def normalized_text(value: str | None) -> str:
    value = unicodedata.normalize("NFKC", value or "")
    return " ".join(value.casefold().split())


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def build_dedup_hash(source_id: str, title: str, company: str, city: str | None) -> str:
    payload = "\x1f".join(normalized_text(part) for part in (source_id, title, company, city))
    return sha256_text(payload)


def parse_salary(value: str | None) -> tuple[int | None, int | None, str | None, str | None]:
    if not value:
        return None, None, None, None
    numbers = [int(item.replace(",", "")) for item in re.findall(r"\d[\d,]*", value)]
    salary_min = numbers[0] if numbers else None
    salary_max = numbers[1] if len(numbers) > 1 else salary_min
    lowered = value.casefold()
    currency = "SGD" if "$" in value or "sgd" in lowered else None
    period = next(
        (
            candidate
            for candidate in ("hourly", "daily", "weekly", "monthly", "yearly")
            if candidate in lowered
        ),
        None,
    )
    return salary_min, salary_max, currency, period


def parse_listed_date(value: str | None) -> date | None:
    if not value:
        return None
    for pattern in ("%d %b %Y", "%d %B %Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(value, pattern).date()
        except ValueError:
            continue
    return None


def infer_city(location: str | None) -> str | None:
    if location and "singapore" in location.casefold():
        return "Singapore"
    return None


def normalize_job_types(value: str | None) -> list[str]:
    if not value:
        return []
    lowered = value.casefold()
    result: list[str] = []
    mappings = (
        ("intern", "internship"),
        ("ts", "temporary"),
        ("temp", "temporary"),
        ("full", "full-time"),
        ("perm", "permanent"),
        ("part", "part-time"),
        ("contract", "contract"),
    )
    for token, normalized in mappings:
        if token in lowered and normalized not in result:
            result.append(normalized)
    return result
