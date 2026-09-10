from __future__ import annotations

from app.ingestion.normalization import (
    build_dedup_hash,
    normalize_job_types,
    parse_listed_date,
    parse_salary,
)


def test_salary_and_date_are_normalized_deterministically() -> None:
    assert parse_salary("$1,000 - 1,500 monthly") == (1000, 1500, "SGD", "monthly")
    assert parse_listed_date("24 Aug 2026").isoformat() == "2026-08-24"


def test_dedup_hash_is_stable_across_case_and_whitespace() -> None:
    first = build_dedup_hash("internsg", " Software Engineer ", "EXAMPLE PTE LTD", "Singapore")
    second = build_dedup_hash("INTERNSG", "software engineer", "Example Pte Ltd", " singapore ")
    assert first == second
    assert len(first) == 64


def test_job_type_mapping_is_stable_and_unique() -> None:
    assert normalize_job_types("Intern/TS") == ["internship", "temporary"]
    assert normalize_job_types("Full/Perm") == ["full-time", "permanent"]
