from __future__ import annotations

from app.ingestion.normalization import (
    build_dedup_hash,
    build_external_dedup_hash,
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
    assert normalize_job_types("Internal Auditor") == []
    assert normalize_job_types("Business Partnership") == []
    assert normalize_job_types("Full Stack Engineer") == []
    assert normalize_job_types("TS Developer") == []
    assert normalize_job_types("Software Engineer Intern") == ["internship"]


def test_external_identity_keeps_source_and_opaque_case_sensitive_post_id() -> None:
    first = build_external_dedup_hash("ashby-board-a", "Abc-123")
    assert first != build_external_dedup_hash("ashby-board-b", "Abc-123")
    assert first != build_external_dedup_hash("ashby-board-a", "abc-123")
    assert first != build_external_dedup_hash("ashby-board-a", "Abc-456")
    assert len(first) == 64
